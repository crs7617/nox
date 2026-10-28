import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";

export type TokenRecord = {
  id: string;
  hash: string;
  expiresAt?: string;
  revokedAt?: string;
};

export type TokenFile = {
  tokens: TokenRecord[];
};

export class AuthenticationConfigurationError extends Error {}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function matchesHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function validateRecord(record: unknown): TokenRecord {
  if (typeof record !== "object" || record === null) {
    throw new AuthenticationConfigurationError("Token store contains an invalid token");
  }
  const value = record as Record<string, unknown>;
  if (
    typeof value.id !== "string" ||
    typeof value.hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.hash)
  ) {
    throw new AuthenticationConfigurationError("Token store contains an invalid token");
  }
  if (
    value.expiresAt !== undefined &&
    (typeof value.expiresAt !== "string" || Number.isNaN(Date.parse(value.expiresAt)))
  ) {
    throw new AuthenticationConfigurationError("Token expiration is invalid");
  }
  if (
    value.revokedAt !== undefined &&
    (typeof value.revokedAt !== "string" || Number.isNaN(Date.parse(value.revokedAt)))
  ) {
    throw new AuthenticationConfigurationError("Token revocation is invalid");
  }
  return {
    id: value.id,
    hash: value.hash,
    ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt }),
    ...(value.revokedAt === undefined ? {} : { revokedAt: value.revokedAt }),
  };
}

export async function loadTokenFile(path: string): Promise<TokenFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { tokens?: unknown }).tokens)) {
      throw new AuthenticationConfigurationError("Token store must contain a tokens array");
    }
    return { tokens: (parsed as { tokens: unknown[] }).tokens.map(validateRecord) };
  } catch (error) {
    if (error instanceof AuthenticationConfigurationError) {
      throw error;
    }
    throw new AuthenticationConfigurationError("Unable to load token store");
  }
}

export async function saveTokenFile(path: string, tokenFile: TokenFile): Promise<void> {
  await writeFile(path, `${JSON.stringify(tokenFile, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

export function createToken(expiresAt?: string): { plaintext: string; record: TokenRecord } {
  if (expiresAt !== undefined && Number.isNaN(Date.parse(expiresAt))) {
    throw new AuthenticationConfigurationError("Token expiration is invalid");
  }
  const plaintext = randomBytes(32).toString("base64url");
  return {
    plaintext,
    record: {
      id: randomBytes(16).toString("hex"),
      hash: hashToken(plaintext),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    },
  };
}

export function authenticateToken(tokenFile: TokenFile, token: string | undefined): boolean {
  if (token === undefined || token.length === 0) {
    return false;
  }
  const now = Date.now();
  return tokenFile.tokens.some((record) => {
    if (record.revokedAt !== undefined || (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= now)) {
      return false;
    }
    return matchesHash(record.hash, hashToken(token));
  });
}

export function bearerToken(authorization: string | undefined): string | undefined {
  if (authorization === undefined) {
    return undefined;
  }
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
  return match?.[1];
}
