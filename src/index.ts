
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createPolicyEngine,
  loadPolicyConfiguration,
  parseEnvironmentDeniedTools,
} from "./policy/index.js";
import { AuditLogger } from "./audit/index.js";
import { ApprovalManager, type ApprovalResult } from "./approval/index.js";
import { discoverTools } from "./discovery/index.js";

const upstream = new Client({
  name: "nox-upstream-client",
  version: "1.0.0",
});

const upstreamTransport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/demo-server.ts"],
});

const nox = new Server({
  name: "nox",
  version: "0.1.0",
}, {
  capabilities: { tools: {} },
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

    const discoveredTools = await discoverTools(upstream);
    const tools = new Map(discoveredTools.map((tool) => [tool.name, tool]));

    nox.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: discoveredTools,
    }));

    nox.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const tool = tools.get(toolName);
      if (tool === undefined) {
        await audit.write({
          timestamp: new Date().toISOString(),
          tool: toolName,
          decision: "denied",
          outcome: "error",
          reason: "Unknown upstream tool",
        });
        return {
          content: [{ type: "text", text: "Unknown tool" }],
          isError: true,
        };
      }

      const decision = policy.evaluate(toolName);
      if (!decision.allowed) {
          console.error(`[NOX] DENIED tool=${toolName} reason=${decision.reason}`);
          await audit.write({
            timestamp: new Date().toISOString(),
            tool: toolName,
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
      if (approval.required(toolName)) {
        approvalDecision = await approval.request(toolName);
        if (approvalDecision !== "approved") {
            const reason =
              approvalDecision === "timed_out"
                ? "Approval timed out"
                : approvalDecision === "unavailable"
                  ? "Approval unavailable"
                  : "Approval rejected";
            console.error(`[NOX] DENIED tool=${toolName} reason=${reason}`);
            await audit.write({
              timestamp: new Date().toISOString(),
              tool: toolName,
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

      console.error(`[NOX] ALLOWED tool=${toolName} reason=${decision.reason}`);

      try {
          const result = await upstream.callTool(
            {
              name: toolName,
              arguments: request.params.arguments,
            },
            CallToolResultSchema,
          );

          if (!("content" in result)) {
            throw new Error("invalid upstream result");
          }

          await audit.write({
            timestamp: new Date().toISOString(),
            tool: toolName,
            decision: "allowed",
            ...(approvalDecision === undefined ? {} : { approval: approvalDecision }),
            outcome: result.isError ? "error" : "success",
          });
          return result as CallToolResult;
      } catch {
          await audit.write({
            timestamp: new Date().toISOString(),
            tool: toolName,
            decision: "allowed",
            ...(approvalDecision === undefined ? {} : { approval: approvalDecision }),
            outcome: "error",
            reason: "Upstream call failed",
          });
          return {
            content: [{ type: "text", text: "Upstream tool call failed" }],
            isError: true,
          };
        }
    });

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
