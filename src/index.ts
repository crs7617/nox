
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolResultSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createPolicyEngine,
  loadPolicyConfiguration,
  parseEnvironmentDeniedTools,
} from "./policy/index.js";
import { AuditLogger } from "./audit/index.js";
import { ApprovalManager, type ApprovalResult } from "./approval/index.js";

const upstream = new Client({
  name: "nox-upstream-client",
  version: "1.0.0",
});

const upstreamTransport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/demo-server.ts"],
});

const nox = new McpServer({
  name: "nox",
  version: "0.1.0",
});

async function main() {
  try {
    const policyConfig = loadPolicyConfiguration();
    const policy = createPolicyEngine(policyConfig, parseEnvironmentDeniedTools());
    const approval = new ApprovalManager(
      new Set(policyConfig.approval),
      policyConfig.approvalTimeoutMs,
    );
    const audit = new AuditLogger();

    // Nox acts as an MCP client to the upstream server.
    await upstream.connect(upstreamTransport);

    // Nox also acts as an MCP server to its own downstream client.
    nox.registerTool(
      "greet",
      {
        description: "Greet a person through the Nox security gateway.",
        inputSchema: {
          name: z.string().min(1).describe("The person's name"),
        },
      },
      async ({ name }: { name: string }) => {
        const decision = policy.evaluate("greet");
        if (!decision.allowed) {
          console.error(`[NOX] DENIED tool=greet reason=${decision.reason}`);
          await audit.write({
            timestamp: new Date().toISOString(),
            tool: "greet",
            decision: "denied",
            outcome: "error",
            reason: decision.reason,
          });
          return {
            content: [
              { type: "text", text: `Blocked by Nox policy: ${decision.reason}` },
            ],
            isError: true,
          };
        }

        let approvalDecision: ApprovalResult | undefined;
        if (approval.required("greet")) {
          approvalDecision = await approval.request("greet");
          if (approvalDecision !== "approved") {
            const reason =
              approvalDecision === "timed_out"
                ? "Approval timed out"
                : approvalDecision === "unavailable"
                  ? "Approval unavailable"
                  : "Approval rejected";
            console.error(`[NOX] DENIED tool=greet reason=${reason}`);
            await audit.write({
              timestamp: new Date().toISOString(),
              tool: "greet",
              decision: "allowed",
              approval: approvalDecision,
              outcome: "error",
              reason,
            });
            return {
              content: [{ type: "text", text: `Blocked by Nox approval: ${reason}` }],
              isError: true,
            };
          }
        }

        console.error(`[NOX] ALLOWED tool=greet reason=${decision.reason}`);

        try {
          const result = await upstream.callTool(
            {
              name: "greet",
              arguments: { name },
            },
            CallToolResultSchema,
          );

          if (!("content" in result)) {
            throw new Error("invalid upstream result");
          }

          await audit.write({
            timestamp: new Date().toISOString(),
            tool: "greet",
            decision: "allowed",
            ...(approvalDecision === undefined ? {} : { approval: approvalDecision }),
            outcome: result.isError ? "error" : "success",
          });
          return result as CallToolResult;
        } catch {
          await audit.write({
            timestamp: new Date().toISOString(),
            tool: "greet",
            decision: "allowed",
            outcome: "error",
            reason: "Upstream call failed",
          });
          throw new Error("Upstream tool call failed");
        }
      },
    );

    const downstreamTransport = new StdioServerTransport();
    await nox.connect(downstreamTransport);

    console.error("[NOX] Gateway ready");

    await new Promise<void>((resolve, reject) => {
      process.stdin.once("end", resolve);
      process.stdin.once("error", reject);
    });

    await upstream.close();
    await nox.close();
  } catch (error) {
    console.error(
      "[NOX] Startup failed:",
      error instanceof Error ? error.message.slice(0, 200) : "Unknown startup error",
    );
    await upstream.close().catch(() => {});
    process.exitCode = 1;
  }
}

main();
