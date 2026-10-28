
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
import { UpstreamTimeoutError, withUpstreamTimeout } from "./resilience/index.js";
import {
  createUpstreamTransport,
  loadUpstreamConfiguration,
  UpstreamConfigurationError,
} from "./upstream/index.js";

const nox = new Server({
  name: "nox",
  version: "0.1.0",
}, {
  capabilities: { tools: {} },
});

async function closeResource(name: string, close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } catch {
    console.error(`[NOX] ${name} cleanup failed`);
  }
}

async function main() {
  const upstream = new Client({
    name: "nox-upstream-client",
    version: "1.0.0",
  });
  let upstreamTransport: StdioClientTransport | undefined;
  try {
    const upstreamConfiguration = loadUpstreamConfiguration();
    upstreamTransport = createUpstreamTransport(upstreamConfiguration);
    const policyConfig = loadPolicyConfiguration();
    const policy = createPolicyEngine(policyConfig, parseEnvironmentDeniedTools());
    const approval = new ApprovalManager(
      new Set(policyConfig.approval),
      policyConfig.approvalTimeoutMs,
    );
    const upstreamTimeoutMs = policyConfig.upstreamTimeoutMs;
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
          const result = await withUpstreamTimeout(
            upstream.callTool(
              {
                name: toolName,
                arguments: request.params.arguments,
              },
              CallToolResultSchema,
            ),
            upstreamTimeoutMs,
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
            ...(result.isError ? { reason: "Upstream tool returned an error" } : {}),
          });
          if (result.isError) {
            return {
              content: [{ type: "text", text: "Upstream tool returned an error" }],
              isError: true,
            };
          }
          return result as CallToolResult;
      } catch (error) {
          const timedOut = error instanceof UpstreamTimeoutError;
          await audit.write({
            timestamp: new Date().toISOString(),
            tool: toolName,
            decision: "allowed",
            ...(approvalDecision === undefined ? {} : { approval: approvalDecision }),
            outcome: "error",
            reason: timedOut ? "Upstream call timed out" : "Upstream call failed",
          });
          return {
            content: [
              {
                type: "text",
                text: timedOut
                  ? "Upstream tool call timed out"
                  : "Upstream tool call failed",
              },
            ],
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

  } catch (error) {
    if (error instanceof UpstreamConfigurationError) {
      console.error(`[NOX] Startup failed: ${error.message}`);
    } else {
      console.error("[NOX] Startup failed: upstream unavailable");
    }
    process.exitCode = 1;
  } finally {
    await closeResource("downstream", () => nox.close());
    await closeResource("upstream client", () => upstream.close());
    if (upstreamTransport !== undefined) {
      const transport = upstreamTransport;
      await closeResource("upstream transport", () => transport.close());
    }
  }
}

main();
