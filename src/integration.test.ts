import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Nox integration", () => {
  it("allows greet and audits the successful call", async () => {
    const auditFile = join(tmpdir(), `nox-allowed-${Date.now()}.jsonl`);
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env: { NOX_AUDIT_FILE: auditFile },
    });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(["greet", "farewell"]);
      expect(tools.tools[1]?.description).toBe("Say farewell to a person.");
      expect(tools.tools[1]?.inputSchema).toMatchObject({ type: "object" });
      const result = await client.callTool({
        name: "greet",
        arguments: { name: "Test" },
      });

      expect(result.isError).not.toBe(true);
      const event = JSON.parse((await readFile(auditFile, "utf8")).trim());
      expect(event).toMatchObject({
        tool: "greet",
        decision: "allowed",
        outcome: "success",
      });
      expect(event).not.toHaveProperty("arguments");
      expect(event).not.toHaveProperty("result");
    } finally {
      await client.close();
      await rm(auditFile, { force: true });
    }
  }, 15000);

  it("returns an MCP error without executing the upstream handler", async () => {
    const auditFile = join(tmpdir(), `nox-denied-${Date.now()}.jsonl`);
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env: {
        NOX_DENY_TOOLS: "greet",
        NOX_AUDIT_FILE: auditFile,
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "greet",
        arguments: { name: "Test" },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "Blocked by Nox policy: Denied by NOX_DENY_TOOLS" },
      ]);
      expect(stderr).not.toContain("[NOX-DEMO] greet handler executed");
      const event = JSON.parse((await readFile(auditFile, "utf8")).trim());
      expect(event).toMatchObject({
        tool: "greet",
        decision: "denied",
        outcome: "error",
        reason: "Denied by NOX_DENY_TOOLS",
      });
    } finally {
      await client.close();
      await rm(auditFile, { force: true });
    }
  }, 15000);

  it("does not execute a sensitive tool when approval is unavailable", async () => {
    const auditFile = join(tmpdir(), `nox-approval-${Date.now()}.jsonl`);
    const policyFile = join(tmpdir(), `nox-policy-${Date.now()}.json`);
    await writeFile(
      policyFile,
      JSON.stringify({ approval: ["greet"], approvalTimeoutMs: 20 }),
    );
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env: {
        NOX_POLICY_FILE: policyFile,
        NOX_AUDIT_FILE: auditFile,
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "greet",
        arguments: { name: "Test" },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "Blocked by Nox approval: Approval unavailable" },
      ]);
      expect(stderr).not.toContain("[NOX-DEMO] greet handler executed");
      const event = JSON.parse((await readFile(auditFile, "utf8")).trim());
      expect(event).toMatchObject({
        decision: "allowed",
        approval: "unavailable",
        outcome: "error",
      });
    } finally {
      await client.close();
      await rm(auditFile, { force: true });
      await rm(policyFile, { force: true });
    }
  }, 15000);

  it("keeps policy denial ahead of approval", async () => {
    const auditFile = join(tmpdir(), `nox-policy-denied-${Date.now()}.jsonl`);
    const policyFile = join(tmpdir(), `nox-policy-denied-${Date.now()}.json`);
    await writeFile(
      policyFile,
      JSON.stringify({ deny: ["greet"], approval: ["greet"] }),
    );
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env: { NOX_POLICY_FILE: policyFile, NOX_AUDIT_FILE: auditFile },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "greet",
        arguments: { name: "Test" },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "Blocked by Nox policy: Denied by policy file" },
      ]);
      expect(stderr).not.toContain("Approve tool");
      expect(stderr).not.toContain("[NOX-DEMO] greet handler executed");
    } finally {
      await client.close();
      await rm(auditFile, { force: true });
      await rm(policyFile, { force: true });
    }
  }, 15000);

  it("executes a sensitive tool only after approval", async () => {
    const auditFile = join(tmpdir(), `nox-approved-${Date.now()}.jsonl`);
    const policyFile = join(tmpdir(), `nox-approved-policy-${Date.now()}.json`);
    const approvalFile = join(tmpdir(), `nox-approved-input-${Date.now()}.txt`);
    await writeFile(policyFile, JSON.stringify({ approval: ["greet"] }));
    await writeFile(approvalFile, "yes\n");
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env: {
        NOX_POLICY_FILE: policyFile,
        NOX_AUDIT_FILE: auditFile,
        NOX_APPROVAL_INPUT_FILE: approvalFile,
      },
      stderr: "pipe",
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "greet",
        arguments: { name: "Test" },
      });
      expect(result.isError).not.toBe(true);
      const event = JSON.parse((await readFile(auditFile, "utf8")).trim());
      expect(event).toMatchObject({
        decision: "allowed",
        approval: "approved",
        outcome: "success",
      });
    } finally {
      await client.close();
      await rm(auditFile, { force: true });
      await rm(policyFile, { force: true });
      await rm(approvalFile, { force: true });
    }
  }, 15000);

  it("does not execute a sensitive tool after rejection", async () => {
    const auditFile = join(tmpdir(), `nox-rejected-${Date.now()}.jsonl`);
    const policyFile = join(tmpdir(), `nox-rejected-policy-${Date.now()}.json`);
    const approvalFile = join(tmpdir(), `nox-rejected-input-${Date.now()}.txt`);
    await writeFile(policyFile, JSON.stringify({ approval: ["greet"] }));
    await writeFile(approvalFile, "no\n");
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env: {
        NOX_POLICY_FILE: policyFile,
        NOX_AUDIT_FILE: auditFile,
        NOX_APPROVAL_INPUT_FILE: approvalFile,
      },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "greet",
        arguments: { name: "Test" },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "Blocked by Nox approval: Approval rejected" },
      ]);
      expect(stderr).not.toContain("[NOX-DEMO] greet handler executed");
      const event = JSON.parse((await readFile(auditFile, "utf8")).trim());
      expect(event).toMatchObject({
        decision: "allowed",
        approval: "rejected",
        outcome: "error",
      });
    } finally {
      await client.close();
      await rm(auditFile, { force: true });
      await rm(policyFile, { force: true });
      await rm(approvalFile, { force: true });
    }
  }, 15000);

  it("forwards a discovered tool by name", async () => {
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "farewell",
        arguments: { name: "Test" },
      });
      expect(result).toMatchObject({
        content: [{ type: "text", text: "Goodbye, Test!" }],
      });
    } finally {
      await client.close();
    }
  }, 15000);

  it("returns an MCP error for an unknown tool", async () => {
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "missing",
        arguments: {},
      });
      expect(result).toMatchObject({
        isError: true,
        content: [{ type: "text", text: "Unknown tool" }],
      });
    } finally {
      await client.close();
    }
  }, 15000);

  it("denies a discovered tool before upstream execution", async () => {
    const auditFile = join(tmpdir(), `nox-discovered-denied-${Date.now()}.jsonl`);
    const policyFile = join(tmpdir(), `nox-discovered-policy-${Date.now()}.json`);
    await writeFile(policyFile, JSON.stringify({ deny: ["farewell"] }));
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env: { NOX_POLICY_FILE: policyFile, NOX_AUDIT_FILE: auditFile },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "farewell",
        arguments: { name: "Test" },
      });
      expect(result.isError).toBe(true);
      expect(stderr).not.toContain("[NOX-DEMO] farewell handler executed");
    } finally {
      await client.close();
      await rm(auditFile, { force: true });
      await rm(policyFile, { force: true });
    }
  }, 15000);

  it("requires approval for a discovered sensitive tool", async () => {
    const auditFile = join(tmpdir(), `nox-discovered-approval-${Date.now()}.jsonl`);
    const policyFile = join(tmpdir(), `nox-discovered-approval-policy-${Date.now()}.json`);
    await writeFile(
      policyFile,
      JSON.stringify({ approval: ["farewell"], approvalTimeoutMs: 20 }),
    );
    const client = new Client({ name: "nox-integration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/index.ts"],
      env: { NOX_POLICY_FILE: policyFile, NOX_AUDIT_FILE: auditFile },
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "farewell",
        arguments: { name: "Test" },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "Blocked by Nox approval: Approval unavailable" },
      ]);
      expect(stderr).not.toContain("[NOX-DEMO] farewell handler executed");
    } finally {
      await client.close();
      await rm(auditFile, { force: true });
      await rm(policyFile, { force: true });
    }
  }, 15000);
});
