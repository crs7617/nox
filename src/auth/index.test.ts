import { describe, expect, it } from "vitest";
import { authenticateToken, bearerToken, createToken, hashToken } from "./index.js";

describe("PAT authentication", () => {
  it("creates hash-only tokens and authenticates them", () => {
    const created = createToken();
    expect(created.plaintext).not.toBe(created.record.hash);
    expect(created.record.hash).toBe(hashToken(created.plaintext));
    expect(authenticateToken({ tokens: [created.record] }, created.plaintext)).toBe(true);
    expect(authenticateToken({ tokens: [created.record] }, "invalid")).toBe(false);
  });

  it("rejects revoked and expired tokens", () => {
    const revoked = createToken();
    const expired = createToken(new Date(Date.now() - 1000).toISOString());
    expect(authenticateToken({ tokens: [{ ...revoked.record, revokedAt: new Date().toISOString() }] }, revoked.plaintext)).toBe(false);
    expect(authenticateToken({ tokens: [expired.record] }, expired.plaintext)).toBe(false);
  });

  it("parses only bearer credentials", () => {
    expect(bearerToken("Bearer abc_123")).toBe("abc_123");
    expect(bearerToken("Basic abc")).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});
