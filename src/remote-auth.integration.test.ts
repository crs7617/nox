import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { describe, expect, it } from "vitest";
import { createToken, saveTokenFile, type TokenFile } from "./auth/index.js";

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function stopProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) {
    return;
  }
  process.kill("SIGTERM");
  await new Promise<void>((resolve) => process.once("exit", () => resolve()));
}

async function startNox(tokenPath: string, port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/index.ts"], {
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      NOX_DOWNSTREAM_TRANSPORT: "http",
      NOX_DOWNSTREAM_HOST: "127.0.0.1",
      NOX_DOWNSTREAM_PORT: String(port),
      NOX_AUTH_TOKEN_FILE: tokenPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    diagnostics += chunk.toString();
  });
  try {
    await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Nox did not start: ${diagnostics}`)), 30000);
    child.stderr?.on("data", () => {
      if (diagnostics.includes("[NOX] Gateway ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Nox exited during startup"));
    });
    });
  } catch (error) {
    await stopProcess(child);
    throw error;
  }
  return child;
}

describe("Nox remote client authentication", () => {
  it("accepts valid tokens and rejects missing, invalid, and revoked tokens", async () => {
    const tokenPath = join(tmpdir(), `nox-auth-${Date.now()}.json`);
    const created = createToken();
    const tokenFile: TokenFile = { tokens: [created.record] };
    await saveTokenFile(tokenPath, tokenFile);
    const port = await unusedPort();
    const nox = await startNox(tokenPath, port);
    const url = `http://127.0.0.1:${port}/mcp`;

    try {
      const missing = await fetch(url, { method: "POST", body: "{}" });
      expect(missing.status).toBe(401);
      const invalid = await fetch(url, {
        method: "POST",
        headers: { authorization: "Bearer invalid" },
        body: "{}",
      });
      expect(invalid.status).toBe(401);

      const client = new Client({ name: "remote-auth-test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { authorization: `Bearer ${created.plaintext}` } },
      });
      await client.connect(transport);
      await expect(client.listTools()).resolves.toMatchObject({
        tools: expect.arrayContaining([expect.objectContaining({ name: "greet" })]),
      });
      await client.close();

      const revokedFile = {
        tokens: [{ ...created.record, revokedAt: new Date().toISOString() }],
      };
      await writeFile(tokenPath, `${JSON.stringify(revokedFile)}\n`, "utf8");
      const revoked = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${created.plaintext}` },
        body: "{}",
      });
      expect(revoked.status).toBe(401);
      expect((await readFile(tokenPath, "utf8"))).not.toContain(created.plaintext);
    } finally {
      await stopProcess(nox);
      await rm(tokenPath, { force: true });
    }
  }, 30000);
});
