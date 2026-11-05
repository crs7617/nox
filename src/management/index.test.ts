import { createToken } from "../auth/index.js";
import { request } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { startManagementServer } from "./index.js";
import { ApprovalManager } from "../approval/index.js";

async function requestJson(
  url: string,
  token?: string,
  method = "GET",
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const response = request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(payload === undefined
            ? {}
            : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
        },
      },
      (incoming) => {
        let responseBody = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => (responseBody += chunk));
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            body: JSON.parse(responseBody) as Record<string, unknown>,
          }),
        );
      },
    );
    response.on("error", reject);
    response.end(payload);
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
      expect((await requestJson(`http://127.0.0.1:${server.port}/health`)).status).toBe(401);
      expect((await requestJson(`http://127.0.0.1:${server.port}/health`, "wrong")).status).toBe(401);
      const health = await requestJson(`http://127.0.0.1:${server.port}/health`, token.plaintext);
      expect(health.status).toBe(200);
      expect(health.body).toMatchObject({ state: "ready", discoveredToolCount: 1 });
    } finally {
      await server.close();
    }
  });

  it("returns the startup-discovered tool inventory without internal metadata", async () => {
    const server = await startManagementServer({
      ...options,
      discoveredTools: [
        {
          name: "safe-tool",
          description: "An upstream description.",
          inputSchema: { type: "object", properties: { value: { type: "string" } } },
          outputSchema: { type: "object" },
          annotations: { destructiveHint: true },
          _meta: { token: "must not be exposed" },
        },
      ],
    });
    try {
      expect((await requestJson(`http://127.0.0.1:${server.port}/tools`)).status).toBe(401);
      const response = await requestJson(`http://127.0.0.1:${server.port}/tools`, token.plaintext);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        count: 1,
        tools: [
          {
            name: "safe-tool",
            description: "An upstream description.",
            inputSchema: { type: "object", properties: { value: { type: "string" } } },
          },
        ],
      });
      expect(JSON.stringify(response.body)).not.toContain("token");
      expect(JSON.stringify(response.body)).not.toContain("destructiveHint");
    } finally {
      await server.close();
    }
  });

  it("returns an empty inventory accurately", async () => {
    const server = await startManagementServer({ ...options, discoveredTools: [] });
    try {
      const response = await requestJson(`http://127.0.0.1:${server.port}/tools`, token.plaintext);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 0, tools: [] });
    } finally {
      await server.close();
    }
  });

  it("reports an unavailable inventory without leaking upstream details", async () => {
    const server = await startManagementServer({ ...options });
    try {
      const response = await requestJson(`http://127.0.0.1:${server.port}/tools`, token.plaintext);
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        error: "upstream_unavailable",
        message: "Tool inventory unavailable",
      });
    } finally {
      await server.close();
    }
  });

  it("returns only sanitized policy data", async () => {
    const server = await startManagementServer(options);
    try {
      const response = await requestJson(`http://127.0.0.1:${server.port}/policy`, token.plaintext);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(options.policy);
      expect(JSON.stringify(response.body)).not.toContain("hash");
      expect(JSON.stringify(response.body)).not.toContain("secret");
    } finally {
      await server.close();
    }
  });

  it("validates and updates a complete policy", async () => {
    const applied = vi.fn();
    const persist = vi.fn(async () => undefined);
    const server = await startManagementServer({
      ...options,
      policyPath: "nox-policy.json",
      toolNames: new Set(["safe-tool", "sensitive-tool"]),
      applyPolicy: applied,
      persistPolicy: persist,
    });
    const proposed = {
      allow: ["safe-tool"],
      deny: [],
      approval: ["sensitive-tool"],
      approvalTimeoutMs: 500,
      upstreamTimeoutMs: 750,
    };
    try {
      const validation = await requestJson(
        `http://127.0.0.1:${server.port}/policy/validate`,
        token.plaintext,
        "POST",
        proposed,
      );
      expect(validation.status).toBe(200);
      expect(validation.body).toEqual({ valid: true, policy: proposed });

      const update = await requestJson(
        `http://127.0.0.1:${server.port}/policy`,
        token.plaintext,
        "PUT",
        proposed,
      );
      expect(update.status).toBe(200);
      expect(update.body).toEqual(proposed);
      expect(persist).toHaveBeenCalledWith("nox-policy.json", proposed);
      expect(applied).toHaveBeenCalledWith(proposed);
    } finally {
      await server.close();
    }
  });

  it("rejects malformed, unsupported, and unavailable requests safely", async () => {
    const server = await startManagementServer(options);
    try {
      expect(
        (await requestJson(`http://127.0.0.1:${server.port}/health?unexpected=1`, token.plaintext)).status,
      ).toBe(400);
      expect(
        (await requestJson(`http://127.0.0.1:${server.port}/health`, token.plaintext, "POST")).status,
      ).toBe(405);
      expect((await requestJson(`http://127.0.0.1:${server.port}/missing`, token.plaintext)).status).toBe(404);
      const malformed = await requestJson(
        `http://127.0.0.1:${server.port}/policy/validate`,
        token.plaintext,
        "POST",
        "not-json",
      );
      expect(malformed.status).toBe(400);
      const unsupported = await requestJson(
        `http://127.0.0.1:${server.port}/policy/validate`,
        token.plaintext,
        "POST",
        { unsupported: true },
      );
      expect(unsupported.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it("leaves the live policy unchanged when persistence fails", async () => {
    const applied = vi.fn();
    const persist = vi.fn(async () => {
      throw new Error("disk unavailable");
    });
    const server = await startManagementServer({
      ...options,
      policyPath: "nox-policy.json",
      toolNames: new Set(["safe-tool"]),
      applyPolicy: applied,
      persistPolicy: persist,
    });
    try {
      const failed = await requestJson(
        `http://127.0.0.1:${server.port}/policy`,
        token.plaintext,
        "PUT",
        { allow: ["safe-tool"] },
      );
      expect(failed.status).toBe(503);
      expect(applied).not.toHaveBeenCalled();
      expect((await requestJson(`http://127.0.0.1:${server.port}/policy`, token.plaintext)).body).toEqual(
        options.policy,
      );
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
      const response = await requestJson(`http://127.0.0.1:${server.port}/policy/validate`, token.plaintext, "POST", {});
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: "Authentication unavailable" });
    } finally {
      await server.close();
    }
  });

  it("lists and resolves pending approvals without exposing arguments", async () => {
    const approval = new ApprovalManager(
      new Set(["sensitive"]),
      1000,
      () => undefined,
      vi.fn(),
      { managementEnabled: true },
    );
    const waiting = approval.request("sensitive");
    await vi.waitFor(() => expect(approval.list()).toHaveLength(1));
    const server = await startManagementServer({ ...options, approval });
    try {
      const listed = await requestJson(`http://127.0.0.1:${server.port}/approvals`, token.plaintext);
      expect(listed.status).toBe(200);
      expect(listed.body.approvals).toMatchObject([{ toolName: "sensitive", status: "pending" }]);
      expect(JSON.stringify(listed.body)).not.toContain("arguments");
      const id = (listed.body.approvals as Array<{ id: string }>)[0]?.id;
      const resolved = await requestJson(`http://127.0.0.1:${server.port}/approvals/${id}/approve`, token.plaintext, "POST");
      expect(resolved.status).toBe(200);
      expect(await waiting).toBe("approved");
    } finally {
      await server.close();
    }
  });

  it("persists upstream changes as restart-required and never returns secrets", async () => {
    const persist = vi.fn(async () => undefined);
    const server = await startManagementServer({
      ...options,
      upstream: { transport: "http", url: "https://example.test/mcp" },
      upstreamPath: "nox-upstream.json",
      persistUpstream: persist,
    });
    try {
      const response = await requestJson(
        `http://127.0.0.1:${server.port}/upstreams`,
        token.plaintext,
        "POST",
        { transport: "http", url: "https://example.test/new" },
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ restartRequired: true, transport: "http" });
      expect(persist).toHaveBeenCalledWith("nox-upstream.json", {
        transport: "http",
        url: "https://example.test/new",
      });
      expect(JSON.stringify(response.body)).not.toContain("token");
    } finally {
      await server.close();
    }
  });
});
