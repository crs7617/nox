import { createToken } from "../auth/index.js";
import { request } from "node:http";
import { describe, expect, it } from "vitest";
import { startManagementServer } from "./index.js";

async function get(url: string, token?: string, method = "GET"): Promise<{ status: number; body: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const response = request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => (body += chunk));
        incoming.on("end", () =>
          resolve({ status: incoming.statusCode ?? 0, body: JSON.parse(body) as Record<string, unknown> }),
        );
      },
    );
    response.on("error", reject);
    response.end();
  });
}

describe("management API", () => {
  const token = createToken();
  const options = {
    port: 0,
    tokenPath: "unused",
    policy: {
      allow: ["safe-tool"],
      deny: [],
      approval: [],
      approvalTimeoutMs: 1000,
      upstreamTimeoutMs: 2000,
    },
    status: {
      state: "ready" as const,
      process: "nox" as const,
      upstream: "connected" as const,
      downstreamTransport: "stdio" as const,
      discoveredToolCount: 1,
    },
    loadTokens: async () => ({ tokens: [token.record] }),
  };

  it("requires authentication and authorizes the read-only endpoints", async () => {
    const server = await startManagementServer(options);
    try {
      const unauthenticated = await get(`http://127.0.0.1:${server.port}/health`);
      expect(unauthenticated.status).toBe(401);
      const wrongToken = await get(`http://127.0.0.1:${server.port}/health`, "wrong");
      expect(wrongToken.status).toBe(401);
      const health = await get(`http://127.0.0.1:${server.port}/health`, token.plaintext);
      expect(health.status).toBe(200);
      expect(health.body).toMatchObject({ state: "ready", discoveredToolCount: 1 });
    } finally {
      await server.close();
    }
  });

  it("returns only sanitized policy data", async () => {
    const server = await startManagementServer(options);
    try {
      const response = await get(`http://127.0.0.1:${server.port}/policy`, token.plaintext);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(options.policy);
      expect(JSON.stringify(response.body)).not.toContain("hash");
      expect(JSON.stringify(response.body)).not.toContain("secret");
    } finally {
      await server.close();
    }
  });

  it("rejects malformed, unsupported, and unavailable requests safely", async () => {
    const server = await startManagementServer(options);
    try {
      const malformed = await get(`http://127.0.0.1:${server.port}/health?unexpected=1`, token.plaintext);
      expect(malformed.status).toBe(400);
      const unsupported = await get(`http://127.0.0.1:${server.port}/health`, token.plaintext, "POST");
      expect(unsupported.status).toBe(405);
      const unavailable = await get(`http://127.0.0.1:${server.port}/missing`, token.plaintext);
      expect(unavailable.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("reports authentication resource failures without leaking details", async () => {
    const server = await startManagementServer({
      ...options,
      loadTokens: async () => {
        throw new Error("token file secret");
      },
    });
    try {
      const response = await get(`http://127.0.0.1:${server.port}/health`, token.plaintext);
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: "Authentication unavailable" });
    } finally {
      await server.close();
    }
  });
});
