import { describe, expect, it } from "vitest";
import {
  authenticateToken,
  bearerToken,
  createToken,
  hashToken,
  loadTokenFile,
  saveTokenFile,
} from "./index.js";
import { writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("PAT authentication", () => {
  it("creates hash-only tokens and authenticates them", () => {
    const created = createToken();
    expect(created.plaintext).not.toBe(created.record.hash);
    expect(created.record.hash).toBe(hashToken(created.plaintext));
    expect(authenticateToken({ tokens: [created.record] }, created.plaintext)).toBe(true);
    expect(authenticateToken({ tokens: [created.record] }, "invalid")).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "writes token files without group or world permissions",
    async () => {
    const path = join(tmpdir(), `nox-token-mode-${Date.now()}.json`);
    const created = createToken();
    await saveTokenFile(path, { tokens: [created.record] });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await rm(path, { force: true });
    },
  );

  it("rejects revoked and expired tokens", () => {
    const revoked = createToken();
    const expired = createToken(new Date(Date.now() - 1000).toISOString());
    expect(authenticateToken({ tokens: [{ ...revoked.record, revokedAt: new Date().toISOString() }] }, revoked.plaintext)).toBe(false);
    expect(authenticateToken({ tokens: [expired.record] }, expired.plaintext)).toBe(false);
  });

  it("rejects malformed token timestamps instead of treating them as valid", async () => {
    const path = join(tmpdir(), `nox-malformed-token-${Date.now()}.json`);
    await writeFile(
      path,
      JSON.stringify({
        tokens: [{ id: "token", hash: "a".repeat(64), expiresAt: "not-a-date" }],
      }),
    );
    await expect(loadTokenFile(path)).rejects.toThrow(/expiration/);
    await rm(path, { force: true });
  });

  it("parses only bearer credentials", () => {
    expect(bearerToken("Bearer abc_123")).toBe("abc_123");
    expect(bearerToken("Basic abc")).toBeUndefined();
    expect(bearerToken(undefined)).toBeUndefined();
  });
});
