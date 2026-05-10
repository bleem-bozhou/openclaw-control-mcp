import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/gateway/store.js";
import type { KeychainBackend } from "../src/gateway/keychain.js";
import { resolveKeychainBackend, maybeKeychainBackend } from "../src/gateway/keychain.js";

class InMemoryKeychain implements KeychainBackend {
  readonly id = "in-memory-test";
  readonly entries = new Map<string, string>();
  async isAvailable() {
    return true;
  }
  async get(key: string) {
    return this.entries.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.entries.set(key, value);
  }
  async delete(key: string) {
    this.entries.delete(key);
  }
}

describe("maybeKeychainBackend env-gating (default ON since 0.5.0)", () => {
  const original = process.env.OPENCLAW_USE_KEYCHAIN;
  afterEach(() => {
    if (original === undefined) delete process.env.OPENCLAW_USE_KEYCHAIN;
    else process.env.OPENCLAW_USE_KEYCHAIN = original;
  });

  it("returns null when explicitly opted out via '0'", async () => {
    process.env.OPENCLAW_USE_KEYCHAIN = "0";
    expect(await maybeKeychainBackend()).toBeNull();
  });

  it("returns null when explicitly opted out via 'false'", async () => {
    process.env.OPENCLAW_USE_KEYCHAIN = "false";
    expect(await maybeKeychainBackend()).toBeNull();
  });

  it("when unset, returns the active backend (or null on hosts with no keychain CLI)", async () => {
    delete process.env.OPENCLAW_USE_KEYCHAIN;
    const backend = await maybeKeychainBackend();
    // On macOS CI we expect macos-security; on Linux without secret-tool we expect null.
    // Either way a Noop must NOT be returned (hidden by maybeKeychainBackend).
    if (backend) expect(backend.id).not.toBe("noop");
  });
});

describe("resolveKeychainBackend always returns something", () => {
  it("returns a backend (real or noop) without throwing", async () => {
    const b = await resolveKeychainBackend();
    expect(b).toBeTruthy();
    expect(typeof b.id).toBe("string");
  });

  it("noop fallback never throws on get/delete", async () => {
    const b = await resolveKeychainBackend();
    if (b.id !== "noop") return; // skip when a real backend is present (CI on a Mac)
    expect(await b.get("anything")).toBeNull();
    await expect(b.delete("anything")).resolves.toBeUndefined();
  });
});

describe("Store + InMemoryKeychain — secret splitting (bundle since 0.6.1)", () => {
  let dir: string;
  let kc: InMemoryKeychain;
  let store: Store;

  // Helper: parse the single secrets-bundle item that holds every secret.
  type Bundle = {
    version: 1;
    device?: { privateKey: string };
    tokens?: Record<string, string>;
    configs?: Record<string, { gatewayToken?: string; gatewayPassword?: string }>;
  };
  const bundle = (): Bundle | null => {
    const raw = kc.entries.get("secrets-bundle");
    return raw ? (JSON.parse(raw) as Bundle) : null;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "openclaw-store-test-"));
    kc = new InMemoryKeychain();
    store = new Store(dir, "store.json", { keychain: kc });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("strips secrets from store.json on save and pushes them to the bundle", async () => {
    await store.saveDevice({
      deviceId: "deadbeef",
      publicKey: "PUBKEY",
      privateKey: "SECRET-PRIVATE-KEY",
      createdAtMs: 1_700_000_000_000,
    });

    const json = JSON.parse(readFileSync(join(dir, "store.json"), "utf8")) as {
      device?: { privateKey: string; publicKey: string };
    };
    expect(json.device?.publicKey).toBe("PUBKEY"); // public stays in JSON
    expect(json.device?.privateKey).toBe(""); // secret blanked in JSON
    expect(bundle()?.device?.privateKey).toBe("SECRET-PRIVATE-KEY");
    // The legacy individual item must NOT be created any more.
    expect(kc.entries.has("device-private-key")).toBe(false);
  });

  it("hydrates secrets from the bundle on load", async () => {
    await store.saveDevice({
      deviceId: "deadbeef",
      publicKey: "PUBKEY",
      privateKey: "SECRET-PRIVATE-KEY",
      createdAtMs: 1_700_000_000_000,
    });

    // Fresh store instance pointing at the same dir + same keychain
    const fresh = new Store(dir, "store.json", { keychain: kc });
    const device = await fresh.loadDevice();
    expect(device?.privateKey).toBe("SECRET-PRIVATE-KEY"); // re-hydrated
    expect(device?.publicKey).toBe("PUBKEY");
  });

  it("packs every per-gateway token into the bundle", async () => {
    await store.saveToken("gw-aaa", { token: "TOKEN-AAA", role: "operator", scopes: [], savedAtMs: 1 });
    await store.saveToken("gw-bbb", { token: "TOKEN-BBB", role: "operator", scopes: [], savedAtMs: 2 });

    expect(bundle()?.tokens?.["gw-aaa"]).toBe("TOKEN-AAA");
    expect(bundle()?.tokens?.["gw-bbb"]).toBe("TOKEN-BBB");
    // No per-token legacy items.
    expect(kc.entries.has("device-token:gw-aaa")).toBe(false);
    expect(kc.entries.has("device-token:gw-bbb")).toBe(false);

    const json = JSON.parse(readFileSync(join(dir, "store.json"), "utf8")) as {
      tokens: Record<string, { token: string }>;
    };
    expect(json.tokens["gw-aaa"].token).toBe("");
    expect(json.tokens["gw-bbb"].token).toBe("");
  });

  it("clearToken removes the token from both the JSON and the bundle", async () => {
    await store.saveToken("gw-zzz", { token: "TOKEN-ZZZ", role: "operator", scopes: [], savedAtMs: 1 });
    expect(bundle()?.tokens?.["gw-zzz"]).toBe("TOKEN-ZZZ");

    await store.clearToken("gw-zzz");
    expect(bundle()?.tokens?.["gw-zzz"]).toBeUndefined();
  });

  it("packs config secrets (gatewayToken, gatewayPassword) into the bundle", async () => {
    await store.saveConfig({
      gatewayUrl: "wss://x",
      gatewayToken: "TOKEN-CFG",
      gatewayPassword: "PWD-CFG",
    });
    expect(bundle()?.configs?.default.gatewayToken).toBe("TOKEN-CFG");
    expect(bundle()?.configs?.default.gatewayPassword).toBe("PWD-CFG");
    // No per-instance legacy items.
    expect(kc.entries.has("gateway-token:default")).toBe(false);
    expect(kc.entries.has("gateway-password:default")).toBe(false);

    const json = JSON.parse(readFileSync(join(dir, "store.json"), "utf8")) as {
      configs: Record<string, { gatewayUrl: string; gatewayToken: string; gatewayPassword: string }>;
    };
    expect(json.configs.default.gatewayUrl).toBe("wss://x"); // non-secret stays
    expect(json.configs.default.gatewayToken).toBe("");
    expect(json.configs.default.gatewayPassword).toBe("");
  });

  it("clearConfig wipes both the JSON config and the bundle slot", async () => {
    await store.saveConfig({ gatewayUrl: "wss://x", gatewayToken: "T", gatewayPassword: "P" });
    expect(bundle()?.configs?.default.gatewayToken).toBe("T");
    await store.clearConfig();
    expect(bundle()?.configs?.default).toBeUndefined();
  });

  it("does NOT blank privateKey when keychain.set throws (lossy NoopBackend scenario)", async () => {
    // Build a keychain that ACCEPTS get but throws on set — the failure mode
    // that caused the empty-private-key bug pre-fix.
    const lossy: KeychainBackend = {
      id: "lossy-test",
      isAvailable: async () => true,
      get: async () => null,
      set: async () => {
        throw new Error("nope (simulated keychain failure)");
      },
      delete: async () => {},
    };
    const lossyDir = mkdtempSync(join(tmpdir(), "openclaw-store-lossy-"));
    const lossyStore = new Store(lossyDir, "store.json", { keychain: lossy });
    try {
      await lossyStore.saveDevice({
        deviceId: "abc",
        publicKey: "PK",
        privateKey: "SK-MUST-SURVIVE",
        createdAtMs: 1,
      });
      const json = JSON.parse(readFileSync(join(lossyDir, "store.json"), "utf8")) as {
        device: { privateKey: string };
      };
      expect(json.device.privateKey).toBe("SK-MUST-SURVIVE"); // not blanked
    } finally {
      rmSync(lossyDir, { recursive: true, force: true });
    }
  });
});

describe("Store.deviceIntegrity + repairDevice", () => {
  let dir: string;
  let kc: InMemoryKeychain;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "openclaw-repair-"));
    kc = new InMemoryKeychain();
    store = new Store(dir, "store.json", { keychain: kc });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports `no-device` on a fresh store", async () => {
    expect(await store.deviceIntegrity()).toBe("no-device");
  });

  it("reports `ok` after a successful save", async () => {
    await store.saveDevice({ deviceId: "x", publicKey: "PK", privateKey: "SK", createdAtMs: 1 });
    expect(await store.deviceIntegrity()).toBe("ok");
  });

  it("reports `missing-private-key` when privateKey is empty post-load", async () => {
    // Simulate the broken state directly on disk (keychain has no entry).
    const broken = {
      version: 2,
      device: { deviceId: "x", publicKey: "PK", privateKey: "", createdAtMs: 1 },
    };
    const fs = await import("node:fs/promises");
    await fs.writeFile(join(dir, "store.json"), JSON.stringify(broken), "utf8");
    expect(await store.deviceIntegrity()).toBe("missing-private-key");
  });

  it("repairDevice wipes device + tokens, backs up store.json, drops keychain entries", async () => {
    type Bundle = {
      device?: { privateKey: string };
      tokens?: Record<string, string>;
    };
    const bundle = (): Bundle | null => {
      const raw = kc.entries.get("secrets-bundle");
      return raw ? (JSON.parse(raw) as Bundle) : null;
    };

    await store.saveDevice({ deviceId: "x", publicKey: "PK", privateKey: "SK", createdAtMs: 1 });
    await store.saveToken("gw-1", { token: "T1", role: "operator", scopes: [], savedAtMs: 1 });
    await store.saveToken("gw-2", { token: "T2", role: "operator", scopes: [], savedAtMs: 2 });
    expect(bundle()?.device?.privateKey).toBe("SK");
    expect(bundle()?.tokens?.["gw-1"]).toBe("T1");

    const result = await store.repairDevice();
    expect(result.wiped.device).toBe(true);
    expect(result.wiped.tokenCount).toBe(2);
    expect(result.backupPath).toBeTruthy();

    // Backup actually exists.
    expect(readFileSync(result.backupPath as string, "utf8")).toContain("PK");

    // Device + tokens removed from disk + bundle.
    expect(await store.loadDevice()).toBeUndefined();
    expect(bundle()?.device).toBeUndefined();
    expect(bundle()?.tokens).toBeUndefined();
    // Legacy individual items also wiped (defensive — repairDevice still nukes them in case of leftovers).
    expect(kc.entries.has("device-private-key")).toBe(false);
    expect(kc.entries.has("device-token:gw-1")).toBe(false);
    expect(kc.entries.has("device-token:gw-2")).toBe(false);
  });

  it("repairDevice preserves gateway configs (URL + token stay)", async () => {
    await store.saveConfig({ gatewayUrl: "wss://x", gatewayToken: "GT" });
    await store.saveDevice({ deviceId: "x", publicKey: "PK", privateKey: "SK", createdAtMs: 1 });
    await store.repairDevice();
    const cfg = await store.loadConfig();
    expect(cfg.gatewayUrl).toBe("wss://x");
    expect(cfg.gatewayToken).toBe("GT");
  });

  it("repairDevice on a fresh store returns no backup", async () => {
    const result = await store.repairDevice();
    expect(result.backupPath).toBeNull();
    expect(result.wiped.device).toBe(false);
    expect(result.wiped.tokenCount).toBe(0);
  });

  it("secretsLocation reflects the active backend", async () => {
    expect(await store.secretsLocation()).toBe("in-memory-test + store.json");
  });
});

describe("Store without keychain (legacy 0.3.x behaviour)", () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "openclaw-store-test-no-kc-"));
    store = new Store(dir, "store.json", { keychain: null });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps secrets in store.json when no keychain is configured", async () => {
    await store.saveDevice({
      deviceId: "abc",
      publicKey: "PK",
      privateKey: "SK",
      createdAtMs: 1,
    });

    const json = JSON.parse(readFileSync(join(dir, "store.json"), "utf8")) as {
      device: { privateKey: string };
    };
    expect(json.device.privateKey).toBe("SK"); // legacy: secret stays in JSON
  });

  it("secretsLocation reports plain JSON", async () => {
    expect(await store.secretsLocation()).toBe("store.json");
  });

  it("creates the file at the expected path", async () => {
    await store.saveConfig({ gatewayUrl: "wss://x" });
    expect(existsSync(join(dir, "store.json"))).toBe(true);
  });
});

describe("Store + InMemoryKeychain — bundle migration from legacy 0.6.0 items", () => {
  let dir: string;
  let kc: InMemoryKeychain;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "openclaw-store-migrate-"));
    kc = new InMemoryKeychain();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Mimics the on-keychain layout from 0.4.0 → 0.6.0: per-secret items, no bundle.
  function seedLegacyItems(opts: {
    devicePrivateKey?: string;
    deviceTokens?: Record<string, string>;
    gatewayToken?: string;
    gatewayPassword?: string;
  }): void {
    if (opts.devicePrivateKey) kc.entries.set("device-private-key", opts.devicePrivateKey);
    if (opts.deviceTokens) {
      for (const [id, t] of Object.entries(opts.deviceTokens)) kc.entries.set(`device-token:${id}`, t);
    }
    if (opts.gatewayToken) kc.entries.set("gateway-token:default", opts.gatewayToken);
    if (opts.gatewayPassword) kc.entries.set("gateway-password:default", opts.gatewayPassword);
  }

  it("falls back to legacy items when no bundle is present", async () => {
    seedLegacyItems({
      devicePrivateKey: "LEGACY-SK",
      deviceTokens: { "gw-1": "LEGACY-DEV-TOKEN" },
      gatewayToken: "LEGACY-GW-TOKEN",
    });
    // Mirror the on-disk shape that would coexist with the legacy keychain
    // items: secrets blanked, structure intact.
    const fs = await import("node:fs/promises");
    await fs.writeFile(
      join(dir, "store.json"),
      JSON.stringify({
        version: 2,
        device: { deviceId: "x", publicKey: "PK", privateKey: "", createdAtMs: 1 },
        tokens: { "gw-1": { token: "", role: "operator", scopes: [], savedAtMs: 1 } },
        configs: { default: { gatewayUrl: "wss://x", gatewayToken: "" } },
        defaultInstance: "default",
      }),
      "utf8",
    );

    const store = new Store(dir, "store.json", { keychain: kc });
    const device = await store.loadDevice();
    expect(device?.privateKey).toBe("LEGACY-SK");
    const token = await store.loadToken("gw-1");
    expect(token?.token).toBe("LEGACY-DEV-TOKEN");
    const cfg = await store.loadConfig();
    expect(cfg.gatewayToken).toBe("LEGACY-GW-TOKEN");
  });

  it("first save() after migration writes the bundle and deletes the legacy items", async () => {
    seedLegacyItems({
      devicePrivateKey: "LEGACY-SK",
      deviceTokens: { "gw-1": "LEGACY-DEV-TOKEN" },
      gatewayToken: "LEGACY-GW-TOKEN",
      gatewayPassword: "LEGACY-PWD",
    });
    const fs = await import("node:fs/promises");
    await fs.writeFile(
      join(dir, "store.json"),
      JSON.stringify({
        version: 2,
        device: { deviceId: "x", publicKey: "PK", privateKey: "", createdAtMs: 1 },
        tokens: { "gw-1": { token: "", role: "operator", scopes: [], savedAtMs: 1 } },
        configs: { default: { gatewayUrl: "wss://x", gatewayToken: "", gatewayPassword: "" } },
        defaultInstance: "default",
      }),
      "utf8",
    );

    const store = new Store(dir, "store.json", { keychain: kc });
    // Trigger a save — any setDefaultInstance / saveConfig call would do; we
    // use saveConfig with the same URL since it's idempotent semantically.
    await store.saveConfig({ gatewayUrl: "wss://x" });

    // Bundle now contains every secret …
    const raw = kc.entries.get("secrets-bundle");
    expect(raw).toBeTruthy();
    const bundle = JSON.parse(raw as string) as {
      device: { privateKey: string };
      tokens: Record<string, string>;
      configs: Record<string, { gatewayToken?: string; gatewayPassword?: string }>;
    };
    expect(bundle.device.privateKey).toBe("LEGACY-SK");
    expect(bundle.tokens["gw-1"]).toBe("LEGACY-DEV-TOKEN");
    expect(bundle.configs.default.gatewayToken).toBe("LEGACY-GW-TOKEN");
    expect(bundle.configs.default.gatewayPassword).toBe("LEGACY-PWD");

    // … and the legacy items are gone.
    expect(kc.entries.has("device-private-key")).toBe(false);
    expect(kc.entries.has("device-token:gw-1")).toBe(false);
    expect(kc.entries.has("gateway-token:default")).toBe(false);
    expect(kc.entries.has("gateway-password:default")).toBe(false);
  });

  it("falls back to legacy items when the bundle is corrupt JSON", async () => {
    kc.entries.set("secrets-bundle", "{not valid json");
    seedLegacyItems({ devicePrivateKey: "FALLBACK-SK" });
    const fs = await import("node:fs/promises");
    await fs.writeFile(
      join(dir, "store.json"),
      JSON.stringify({
        version: 2,
        device: { deviceId: "x", publicKey: "PK", privateKey: "", createdAtMs: 1 },
      }),
      "utf8",
    );
    const store = new Store(dir, "store.json", { keychain: kc });
    const device = await store.loadDevice();
    expect(device?.privateKey).toBe("FALLBACK-SK");
  });
});
