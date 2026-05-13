// ADR-001 — Multi-instance Store with keychain-backed secrets. See docs/adr/001-multi-instance-store-with-keychain-backed-secrets.md.
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import * as ed from "@noble/ed25519";
import { type DeviceIdentity, fromBase64Url, toBase64Url } from "./device.js";
import { type KeychainBackend, maybeKeychainBackend } from "./keychain.js";

const DEFAULT_DEVICE_SCOPES = ["operator.admin", "operator.read", "operator.write"];

/**
 * Read a runtime-injected device identity from env vars. Only
 * OPENCLAW_DEVICE_PRIVATE_KEY is required — publicKey + deviceId are derived
 * from it so callers can rotate a single secret. Enables stateless CI / service
 * accounts where there's no on-disk store to persist a paired device. Returns
 * undefined when the env var is absent so the regular store-based flow runs.
 */
export async function loadDeviceFromEnv(): Promise<
  (DeviceIdentity & { createdAtMs: number }) | undefined
> {
  const priv = process.env.OPENCLAW_DEVICE_PRIVATE_KEY?.trim();
  if (!priv) return undefined;
  const privBytes = fromBase64Url(priv);
  if (privBytes.length !== 32) {
    throw new Error(
      `OPENCLAW_DEVICE_PRIVATE_KEY must be a base64url-encoded 32-byte Ed25519 seed (got ${privBytes.length} bytes after decoding)`,
    );
  }
  const pubBytes = await ed.getPublicKeyAsync(privBytes);
  const publicKey = toBase64Url(pubBytes);
  const deviceId = createHash("sha256").update(pubBytes).digest("hex");
  return { deviceId, publicKey, privateKey: priv, createdAtMs: Date.now() };
}

/**
 * Read a runtime-injected device token from env vars. Pairs with
 * loadDeviceFromEnv for stateless CI: the operator pre-pairs a device and
 * stores the resulting privateKey + token as secrets. OPENCLAW_DEVICE_TOKEN is
 * the only required field; role + scopes fall back to operator defaults.
 */
export function loadTokenFromEnv(): DeviceTokenEntry | undefined {
  const token = process.env.OPENCLAW_DEVICE_TOKEN?.trim();
  if (!token) return undefined;
  const role = process.env.OPENCLAW_DEVICE_ROLE?.trim() || "operator";
  const rawScopes = process.env.OPENCLAW_DEVICE_SCOPES?.trim();
  const scopes = rawScopes
    ? rawScopes.split(",").map((s) => s.trim()).filter(Boolean)
    : [...DEFAULT_DEVICE_SCOPES];
  return { token, role, scopes, savedAtMs: Date.now() };
}

export type DeviceTokenEntry = {
  token: string;
  role: string;
  scopes: string[];
  savedAtMs: number;
};

type GatewayConfigShape = {
  gatewayUrl?: string;
  gatewayToken?: string;
  gatewayPassword?: string;
  timeoutMs?: number;
  savedAtMs?: number;
};

/** v2 of the on-disk shape — supports multi-instance gateway configs. */
type StoreShape = {
  version: 1 | 2;
  device?: DeviceIdentity & { createdAtMs: number };
  tokens?: Record<string, DeviceTokenEntry>; // keyed by gatewayId (sha256(url)) — already multi-instance
  // v1 only (legacy single-instance) — auto-migrated to `configs.default` on load.
  config?: GatewayConfigShape;
  // v2: named configs. Used keys are arbitrary ('default', 'work', 'perso', …).
  configs?: Record<string, GatewayConfigShape>;
  // v2: which named instance is the active default for tools that don't pass an `instance` param.
  defaultInstance?: string;
};

export const DEFAULT_INSTANCE = "default";

/**
 * Single keychain item that holds every secret as one JSON blob, so the OS
 * keychain only prompts once per process lifetime instead of N times (one per
 * legacy item: device-private-key, device-token:*, gateway-token:*,
 * gateway-password:*). On macOS this collapses 3-5 prompts into 1; same gain
 * on Linux libsecret.
 *
 * Migration is lazy: when the bundle is absent, we fall back to reading the
 * legacy individual items, then the next save() writes the bundle and deletes
 * the legacy items best-effort.
 */
const BUNDLE_KEY = "secrets-bundle";

type SecretsBundleV1 = {
  version: 1;
  device?: { privateKey: string };
  tokens?: Record<string, string>; // gatewayId -> token
  configs?: Record<string, { gatewayToken?: string; gatewayPassword?: string }>;
};

const XDG_BASE = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
const LEGACY_DIR = join(XDG_BASE, "openclaw-claw-mcp");
const DEFAULT_DIR =
  process.env.OPENCLAW_CONTROL_HOME ??
  process.env.OPENCLAW_CLAW_HOME ?? // backward-compat for early adopters
  join(XDG_BASE, "openclaw-control-mcp");

export class Store {
  private path: string;
  // undefined = not yet probed, null = checked and unavailable, KeychainBackend = active.
  private keychain: KeychainBackend | null | undefined = undefined;

  constructor(
    dir: string = DEFAULT_DIR,
    fileName: string = "store.json",
    options: { keychain?: KeychainBackend | null } = {},
  ) {
    this.path = join(dir, fileName);
    // Allow callers (tests) to inject or disable the keychain. `undefined`
    // keeps the default lazy probe behaviour.
    if (options.keychain !== undefined) this.keychain = options.keychain;
  }

  static gatewayId(url: string): string {
    return createHash("sha256").update(url.trim()).digest("hex").slice(0, 16);
  }

  private async getKeychain(): Promise<KeychainBackend | null> {
    if (this.keychain !== undefined) return this.keychain;
    this.keychain = await maybeKeychainBackend();
    return this.keychain;
  }

  /**
   * Returns a label describing where secrets are persisted, useful for
   * `openclaw_setup_show` / `--health` output. "store.json" means everything
   * lives in the JSON file (mode 0600). "<backend-id> + store.json" means
   * secrets are split out into the OS keychain.
   */
  async secretsLocation(): Promise<string> {
    const kc = await this.getKeychain();
    return kc ? `${kc.id} + store.json` : "store.json";
  }

  async load(): Promise<StoreShape> {
    const primary = await this.readShape(this.path);
    const legacy =
      LEGACY_DIR !== dirname(this.path) ? await this.readShape(join(LEGACY_DIR, "store.json")) : null;
    let state: StoreShape;
    if (!primary && !legacy) state = { version: 2 };
    else if (primary && !legacy) state = primary;
    else if (!primary && legacy) state = legacy;
    else {
      // merge: primary fields win, legacy fills in missing pieces (device + tokens are typically only in legacy
      // during migration; config is the new piece written to primary)
      state = { version: 2 };
      state.device = primary?.device ?? legacy?.device;
      state.tokens = { ...(legacy?.tokens ?? {}), ...(primary?.tokens ?? {}) };
      if (Object.keys(state.tokens).length === 0) delete state.tokens;
      // For configs: prefer primary's v2 `configs` if present, else migrate from primary.config or legacy.config
      state.configs = primary?.configs ?? legacy?.configs;
      state.defaultInstance = primary?.defaultInstance ?? legacy?.defaultInstance;
      const legacySingle = primary?.config ?? legacy?.config;
      if (legacySingle && !state.configs) {
        state.configs = { [DEFAULT_INSTANCE]: legacySingle };
        state.defaultInstance = DEFAULT_INSTANCE;
      }
    }

    // v1 -> v2 migration: lift `state.config` into `state.configs.default` and drop the singular field.
    if (state.config && !state.configs) {
      state.configs = { [DEFAULT_INSTANCE]: state.config };
      state.defaultInstance = state.defaultInstance ?? DEFAULT_INSTANCE;
    }
    if (state.config) delete state.config;
    state.version = 2;

    const kc = await this.getKeychain();
    if (kc) await this.hydrateSecretsFromKeychain(state, kc);
    return state;
  }

  private async readShape(path: string): Promise<StoreShape | null> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as StoreShape;
      // Accept any known version. v1 (legacy single-config) is migrated by load().
      return parsed?.version === 1 || parsed?.version === 2 ? parsed : null;
    } catch {
      return null;
    }
  }

  async save(state: StoreShape): Promise<void> {
    const kc = await this.getKeychain();
    const onDisk: StoreShape = kc ? await this.stripSecretsToKeychain(state, kc) : state;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(onDisk, null, 2), "utf8");
    try {
      await chmod(this.path, 0o600);
    } catch {
      // best-effort on non-POSIX
    }
  }

  /**
   * Pull secrets out of `state` and into the keychain backend. Returns a deep
   * clone of the state with secret fields blanked **only when the keychain
   * write succeeded** — otherwise the secret is preserved in the on-disk JSON
   * (mode 0600), matching pre-keychain 0.3.x behaviour. Avoids the failure
   * mode where a backend silently no-ops the write and the only copy of the
   * secret gets discarded (see docs/troubleshooting/empty-private-key.md).
   *
   * Since 0.6.1 every secret is collapsed into a single `secrets-bundle`
   * keychain item — see BUNDLE_KEY — to slash the OS prompt count from N to 1.
   * Legacy individual items are deleted best-effort after a successful bundle
   * write, so first-save-after-upgrade migrates transparently.
   */
  private async stripSecretsToKeychain(state: StoreShape, kc: KeychainBackend): Promise<StoreShape> {
    const cleaned: StoreShape = JSON.parse(JSON.stringify(state));
    const bundle: SecretsBundleV1 = { version: 1 };

    if (cleaned.device?.privateKey) {
      bundle.device = { privateKey: cleaned.device.privateKey };
    }
    if (cleaned.tokens) {
      const tokens: Record<string, string> = {};
      for (const [gatewayId, entry] of Object.entries(cleaned.tokens)) {
        if (entry?.token) tokens[gatewayId] = entry.token;
      }
      if (Object.keys(tokens).length > 0) bundle.tokens = tokens;
    }
    if (cleaned.configs) {
      const cfgs: Record<string, { gatewayToken?: string; gatewayPassword?: string }> = {};
      for (const [instance, cfg] of Object.entries(cleaned.configs)) {
        const slot: { gatewayToken?: string; gatewayPassword?: string } = {};
        if (cfg.gatewayToken) slot.gatewayToken = cfg.gatewayToken;
        if (cfg.gatewayPassword) slot.gatewayPassword = cfg.gatewayPassword;
        if (slot.gatewayToken || slot.gatewayPassword) cfgs[instance] = slot;
      }
      if (Object.keys(cfgs).length > 0) bundle.configs = cfgs;
    }

    // Empty bundle — nothing left to persist. Drop the keychain item so a
    // previously-written bundle doesn't keep stale secrets after a clear /
    // repair operation.
    const hasSecrets =
      bundle.device !== undefined ||
      (bundle.tokens && Object.keys(bundle.tokens).length > 0) ||
      (bundle.configs && Object.keys(bundle.configs).length > 0);
    if (!hasSecrets) {
      await kc.delete(BUNDLE_KEY).catch(() => {
        /* missing-item is fine */
      });
      return cleaned;
    }

    const ok = await safeSet(kc, BUNDLE_KEY, JSON.stringify(bundle));
    if (!ok) {
      // Keychain refused — preserve secrets in store.json (mode 0600). Same
      // safety net as pre-bundle behaviour: never discard the only copy.
      return cleaned;
    }

    // Bundle write succeeded — blank in-memory secrets so they don't leak to
    // store.json on disk.
    if (cleaned.device?.privateKey) cleaned.device = { ...cleaned.device, privateKey: "" };
    if (cleaned.tokens) {
      for (const [gatewayId, entry] of Object.entries(cleaned.tokens)) {
        if (entry?.token) cleaned.tokens[gatewayId] = { ...entry, token: "" };
      }
    }
    if (cleaned.configs) {
      for (const [instance, cfg] of Object.entries(cleaned.configs)) {
        cleaned.configs[instance] = { ...cfg, gatewayToken: "", gatewayPassword: "" };
      }
    }

    // Best-effort migration cleanup: drop the legacy individual items so the
    // keychain stops prompting for them on the next process. Errors here are
    // non-fatal (the legacy items become dead weight, not a correctness bug).
    await this.deleteLegacyItems(kc, cleaned);
    return cleaned;
  }

  /**
   * Wipe every legacy individual keychain item that the bundle now supersedes.
   * Best-effort — backends ignore errors on missing items, so calling this on
   * a fresh keychain is harmless.
   */
  private async deleteLegacyItems(kc: KeychainBackend, state: StoreShape): Promise<void> {
    const keys = new Set<string>(["device-private-key", "gateway-token", "gateway-password"]);
    if (state.tokens) {
      for (const gatewayId of Object.keys(state.tokens)) keys.add(`device-token:${gatewayId}`);
    }
    if (state.configs) {
      for (const instance of Object.keys(state.configs)) {
        keys.add(`gateway-token:${instance}`);
        keys.add(`gateway-password:${instance}`);
      }
    }
    await Promise.all(
      [...keys].map((k) =>
        kc.delete(k).catch(() => {
          /* missing-item is fine */
        }),
      ),
    );
  }

  /**
   * Inverse of stripSecretsToKeychain — fills in the secret fields read from
   * the keychain into the in-memory state. A field already populated wins
   * over the keychain (defensive: lets the user override via env or the
   * legacy store.json without surprise).
   *
   * Since 0.6.1 reads the single `secrets-bundle` item first (1 OS prompt at
   * most). When that item is absent (fresh install, opted out, or pre-0.6.1
   * data), falls back to the legacy per-item reads (N prompts) — the next
   * save() will then write the bundle and migrate transparently.
   */
  private async hydrateSecretsFromKeychain(state: StoreShape, kc: KeychainBackend): Promise<void> {
    const bundle = await this.readBundle(kc);
    if (bundle) {
      this.applyBundleToState(state, bundle);
      return;
    }
    await this.hydrateFromLegacyItems(state, kc);
  }

  private async readBundle(kc: KeychainBackend): Promise<SecretsBundleV1 | null> {
    const raw = await kc.get(BUNDLE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as SecretsBundleV1;
      if (parsed?.version === 1) return parsed;
      return null;
    } catch {
      // Corrupt bundle — treat as absent so the legacy fallback can save the
      // session, and the next save() rewrites a clean bundle.
      return null;
    }
  }

  private applyBundleToState(state: StoreShape, bundle: SecretsBundleV1): void {
    if (state.device && !state.device.privateKey && bundle.device?.privateKey) {
      state.device.privateKey = bundle.device.privateKey;
    }
    if (state.tokens && bundle.tokens) {
      for (const [gatewayId, entry] of Object.entries(state.tokens)) {
        if (entry && !entry.token && bundle.tokens[gatewayId]) {
          entry.token = bundle.tokens[gatewayId];
        }
      }
    }
    if (state.configs && bundle.configs) {
      for (const [instance, cfg] of Object.entries(state.configs)) {
        const slot = bundle.configs[instance];
        if (!slot) continue;
        if (!cfg.gatewayToken && slot.gatewayToken) cfg.gatewayToken = slot.gatewayToken;
        if (!cfg.gatewayPassword && slot.gatewayPassword) cfg.gatewayPassword = slot.gatewayPassword;
      }
    }
  }

  private async hydrateFromLegacyItems(state: StoreShape, kc: KeychainBackend): Promise<void> {
    if (state.device && !state.device.privateKey) {
      const v = await kc.get("device-private-key");
      if (v) state.device.privateKey = v;
    }
    if (state.tokens) {
      for (const [gatewayId, entry] of Object.entries(state.tokens)) {
        if (entry && !entry.token) {
          const v = await kc.get(`device-token:${gatewayId}`);
          if (v) entry.token = v;
        }
      }
    }
    if (state.configs) {
      for (const [instance, cfg] of Object.entries(state.configs)) {
        const isDefault = instance === DEFAULT_INSTANCE;
        if (!cfg.gatewayToken) {
          const v = await this.readWithLegacyFallback(kc, `gateway-token:${instance}`, "gateway-token", isDefault);
          if (v) cfg.gatewayToken = v;
        }
        if (!cfg.gatewayPassword) {
          const v = await this.readWithLegacyFallback(kc, `gateway-password:${instance}`, "gateway-password", isDefault);
          if (v) cfg.gatewayPassword = v;
        }
      }
    }
  }

  // Pre-0.4.0 keychain entries used un-namespaced keys; for the default
  // instance we still consult the legacy key when the namespaced one is empty.
  private async readWithLegacyFallback(
    kc: KeychainBackend,
    primaryKey: string,
    legacyKey: string,
    isDefaultInstance: boolean,
  ): Promise<string | null> {
    const v = await kc.get(primaryKey);
    if (v) return v;
    if (isDefaultInstance) {
      const legacy = await kc.get(legacyKey);
      if (legacy) return legacy;
    }
    return null;
  }

  async loadDevice(): Promise<(DeviceIdentity & { createdAtMs: number }) | undefined> {
    const fromEnv = await loadDeviceFromEnv();
    if (fromEnv) return fromEnv;
    const s = await this.load();
    return s.device;
  }

  async saveDevice(device: DeviceIdentity & { createdAtMs: number }): Promise<void> {
    const s = await this.load();
    s.device = device;
    await this.save(s);
  }

  async loadToken(gatewayId: string): Promise<DeviceTokenEntry | undefined> {
    const fromEnv = loadTokenFromEnv();
    if (fromEnv) return fromEnv;
    const s = await this.load();
    return s.tokens?.[gatewayId];
  }

  async saveToken(gatewayId: string, entry: DeviceTokenEntry): Promise<void> {
    const s = await this.load();
    s.tokens = s.tokens ?? {};
    s.tokens[gatewayId] = entry;
    await this.save(s);
  }

  async clearToken(gatewayId: string): Promise<void> {
    const s = await this.load();
    if (s.tokens?.[gatewayId]) {
      delete s.tokens[gatewayId];
      await this.save(s);
    }
    const kc = await this.getKeychain();
    if (kc) await kc.delete(`device-token:${gatewayId}`);
    // save() above already rewrote the bundle without this gatewayId, so
    // there's no separate bundle update needed.
  }

  /**
   * Returns the full multi-instance config map, keyed by instance name. Useful
   * for setup tools that need to enumerate everything (`openclaw_setup_list`).
   */
  async loadConfigs(): Promise<{
    configs: Record<string, GatewayConfigShape>;
    defaultInstance: string;
  }> {
    const s = await this.load();
    return {
      configs: s.configs ?? {},
      defaultInstance: s.defaultInstance ?? DEFAULT_INSTANCE,
    };
  }

  /**
   * Read one named instance's config. If `instance` is omitted, reads the
   * current default. Returns `{}` if the requested instance doesn't exist.
   */
  async loadConfig(instance?: string): Promise<GatewayConfigShape> {
    const s = await this.load();
    const name = instance ?? s.defaultInstance ?? DEFAULT_INSTANCE;
    return s.configs?.[name] ?? {};
  }

  /**
   * Write / merge a config into a named instance. Default instance name is
   * "default" (matches the v1 → v2 migration), so legacy callers that don't
   * pass `instance` keep working.
   */
  async saveConfig(cfg: GatewayConfigShape, instance: string = DEFAULT_INSTANCE): Promise<void> {
    const s = await this.load();
    s.configs = s.configs ?? {};
    s.configs[instance] = { ...(s.configs[instance] ?? {}), ...cfg, savedAtMs: Date.now() };
    if (!s.defaultInstance) s.defaultInstance = instance;
    await this.save(s);
  }

  /**
   * Clear one specific instance, or all of them if `instance` is omitted. Also
   * clears the matching keychain secrets when keychain is active. If the
   * cleared instance was the default and other instances still exist, picks an
   * arbitrary remaining one as the new default.
   */
  async clearConfig(instance?: string): Promise<void> {
    const s = await this.load();
    // Capture instance names BEFORE we mutate state, so we know which keychain entries to wipe.
    const knownInstances = Object.keys(s.configs ?? {});
    let touched = false;
    if (instance == null) {
      // Clear everything.
      if (s.configs) {
        delete s.configs;
        delete s.defaultInstance;
        touched = true;
      }
    } else if (s.configs?.[instance]) {
      delete s.configs[instance];
      if (s.defaultInstance === instance) {
        const remaining = Object.keys(s.configs);
        s.defaultInstance = remaining[0];
      }
      if (Object.keys(s.configs).length === 0) {
        delete s.configs;
        delete s.defaultInstance;
      }
      touched = true;
    }
    if (touched) await this.save(s);

    const kc = await this.getKeychain();
    if (!kc) return;
    if (instance == null) {
      // Bundle was rewritten by save() (or the configs are gone, so the
      // bundle would only hold device + tokens now). Wipe every legacy
      // namespaced + un-namespaced individual item for safety; the bundle
      // itself is already up-to-date.
      const keysToDelete = new Set<string>(["gateway-token", "gateway-password"]);
      for (const inst of knownInstances) {
        keysToDelete.add(`gateway-token:${inst}`);
        keysToDelete.add(`gateway-password:${inst}`);
      }
      for (const k of keysToDelete) await kc.delete(k);
    } else {
      await kc.delete(`gateway-token:${instance}`);
      await kc.delete(`gateway-password:${instance}`);
      if (instance === DEFAULT_INSTANCE) {
        // Also wipe any legacy un-namespaced entries, just in case.
        await kc.delete("gateway-token");
        await kc.delete("gateway-password");
      }
    }
  }

  async setDefaultInstance(instance: string): Promise<void> {
    const s = await this.load();
    if (!s.configs?.[instance]) {
      throw new Error(`unknown instance '${instance}' — use openclaw_setup to create it first`);
    }
    s.defaultInstance = instance;
    await this.save(s);
  }

  pathInfo(): string {
    return this.path;
  }

  /**
   * Check whether the persisted device identity is usable. Returns:
   *   - "ok"                 — device exists and privateKey is non-empty
   *   - "no-device"          — no device at all (fresh install)
   *   - "missing-private-key" — device.publicKey set but privateKey lost
   *                             (the bug from docs/troubleshooting/empty-private-key.md)
   */
  async deviceIntegrity(): Promise<"ok" | "no-device" | "missing-private-key"> {
    const s = await this.load();
    if (!s.device) return "no-device";
    if (!s.device.privateKey || s.device.privateKey.length === 0) return "missing-private-key";
    return "ok";
  }

  /**
   * Wipe the broken device + cached gateway tokens. Backs up the current
   * `store.json` to `store.json.bak.<ts>` so the user can recover if needed.
   * Also drops the matching keychain entries (`device-private-key`, all
   * `device-token:*`). Configs (gatewayUrl, gatewayToken, gatewayPassword)
   * are preserved — the user re-uses them on the next setup.
   *
   * After this, the next `connect()` regenerates a fresh keypair and
   * surfaces a new pendingPairing.requestId. The orphaned approved device on
   * the gateway side becomes harmless (its token is never used) but the user
   * should revoke it from the Control panel for cleanliness.
   */
  async repairDevice(): Promise<{ backupPath: string | null; wiped: { device: boolean; tokenCount: number } }> {
    const beforeState = await this.load();
    const hadDevice = !!beforeState.device;
    const tokenIds = Object.keys(beforeState.tokens ?? {});

    // Backup the on-disk JSON (best-effort — no backup if file doesn't exist).
    let backupPath: string | null = `${this.path}.bak.${Date.now()}`;
    try {
      const raw = await readFile(this.path, "utf8");
      await writeFile(backupPath, raw, "utf8");
      try {
        await chmod(backupPath, 0o600);
      } catch {
        /* best-effort on non-POSIX */
      }
    } catch {
      backupPath = null;
    }

    // Drop device + tokens from in-memory state and write back.
    delete beforeState.device;
    beforeState.tokens = {};
    await this.save(beforeState);

    // Wipe the matching keychain entries (device key + per-gateway tokens
    // that were present before the wipe). The save() above already rewrote
    // the bundle without device/tokens, so the bundle is in sync — but we
    // also nuke the legacy individual items for cleanliness.
    const kc = await this.getKeychain();
    if (kc) {
      await kc.delete("device-private-key");
      for (const gatewayId of tokenIds) {
        await kc.delete(`device-token:${gatewayId}`);
      }
    }

    return { backupPath, wiped: { device: hadDevice, tokenCount: tokenIds.length } };
  }
}

/**
 * Per-field credential merge. Env wins when set; store fills in the rest.
 * Empty strings in the store (e.g. post-wipe state where `gatewayToken: ""`)
 * are treated as missing so a freshly-set env var still does what users
 * expect. Pure function — no I/O — so it's trivially testable.
 *
 * Used by `ensureClient` in `src/index.ts` to fix the pre-0.6.2 surprise
 * where setting only `OPENCLAW_GATEWAY_TOKEN` (without `OPENCLAW_GATEWAY_URL`)
 * silently kept the empty store token and sent `auth: {}` to the gateway.
 */
export function mergeCreds(
  env: { token?: string; password?: string },
  storeCfg: { gatewayToken?: string; gatewayPassword?: string },
): { token: string | undefined; password: string | undefined } {
  return {
    token: env.token ?? (storeCfg.gatewayToken || undefined),
    password: env.password ?? (storeCfg.gatewayPassword || undefined),
  };
}

/**
 * Attempt a keychain write and report whether it succeeded. Backends like
 * NoopBackend throw — we treat that as failure (caller keeps the secret in
 * the on-disk JSON instead of discarding it). Real backends (macOS, libsecret)
 * also throw on CLI errors; same behaviour. The helper is at module scope so
 * tests can mock it independently of the Store instance.
 */
async function safeSet(kc: KeychainBackend, key: string, value: string): Promise<boolean> {
  try {
    await kc.set(key, value);
    return true;
  } catch {
    return false;
  }
}
