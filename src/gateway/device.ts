import * as ed from "@noble/ed25519";
import { createHash } from "node:crypto";

export type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKey: string;
};

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const norm = s.replaceAll("-", "+").replaceAll("_", "/");
  const pad = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  return new Uint8Array(Buffer.from(pad, "base64"));
}

export async function generateDevice(): Promise<DeviceIdentity> {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  const deviceId = createHash("sha256").update(publicKey).digest("hex");
  return {
    deviceId,
    publicKey: toBase64Url(publicKey),
    privateKey: toBase64Url(privateKey),
  };
}

export async function verifyDeviceId(d: DeviceIdentity): Promise<DeviceIdentity> {
  const expected = createHash("sha256").update(fromBase64Url(d.publicKey)).digest("hex");
  if (expected === d.deviceId) return d;
  return { ...d, deviceId: expected };
}

type SignConnectInput = {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
};

export function buildSigningString(input: SignConnectInput): string {
  return [
    "v2",
    input.deviceId,
    input.clientId,
    input.clientMode,
    input.role,
    input.scopes.join(","),
    String(input.signedAtMs),
    input.token ?? "",
    input.nonce,
  ].join("|");
}

export class DevicePrivateKeyMissingError extends Error {
  constructor(actualLen: number) {
    super(
      `device private key is empty or malformed (got ${actualLen} bytes, expected 32). ` +
        `Run openclaw_device_repair to wipe the broken device + tokens and re-pair, ` +
        `or manually wipe the device entry in ~/.config/openclaw-control-mcp/store.json. ` +
        `See docs/troubleshooting/empty-private-key.md.`,
    );
    this.name = "DevicePrivateKeyMissingError";
  }
}

export async function signConnect(input: SignConnectInput, privateKey: string): Promise<string> {
  const message = new TextEncoder().encode(buildSigningString(input));
  const sk = fromBase64Url(privateKey);
  if (sk.length !== 32) {
    throw new DevicePrivateKeyMissingError(sk.length);
  }
  const sig = await ed.signAsync(message, sk);
  return toBase64Url(sig);
}
