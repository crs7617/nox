
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  createUpstreamTransport,
  loadUpstreamConfiguration,
  UpstreamConfigurationError,
} from "./upstream/index.js";
import {
  authenticateToken,
  bearerToken,
  loadTokenFile,
  type TokenFile,
} from "./auth/index.js";

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
  let upstreamTransport: Transport | undefined;
  let downstreamTransport: StdioServerTransport | StreamableHTTPServerTransport | undefined;
  let httpServer: HttpServer | undefined;
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

    const downstreamMode = process.env.NOX_DOWNSTREAM_TRANSPORT ?? "stdio";
    if (downstreamMode !== "stdio" && downstreamMode !== "http") {
      throw new UpstreamConfigurationError(
        "NOX_DOWNSTREAM_TRANSPORT must be \"stdio\" or \"http\"",
      );
    }

    if (downstreamMode === "stdio") {
      downstreamTransport = new StdioServerTransport();
    } else {
      const tokenPath = process.env.NOX_AUTH_TOKEN_FILE;
      if (tokenPath === undefined || tokenPath.trim() === "") {
        throw new UpstreamConfigurationError(
          "NOX_AUTH_TOKEN_FILE is required for HTTP downstream transport",
        );
      }
      const tokenFile: TokenFile = await loadTokenFile(tokenPath);
      if (tokenFile.tokens.length === 0) {
        throw new UpstreamConfigurationError("HTTP downstream token store is empty");
      }
      const port = Number(process.env.NOX_DOWNSTREAM_PORT ?? "3000");
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new UpstreamConfigurationError("NOX_DOWNSTREAM_PORT must be a valid TCP port");
      }
      const host = process.env.NOX_DOWNSTREAM_HOST ?? "127.0.0.1";
      const httpTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      downstreamTransport = httpTransport;
      httpServer = createServer((request, response) => {
        void loadTokenFile(tokenPath)
          .then((currentTokenFile) => {
            if (!authenticateToken(currentTokenFile, bearerToken(request.headers.authorization))) {
              response.writeHead(401, {
                "content-type": "application/json",
                "www-authenticate": "Bearer",
              });
              response.end(JSON.stringify({ error: "Unauthorized" }));
              return;
            }
            return httpTransport.handleRequest(request, response);
          })
          .catch(() => {
            response.writeHead(503, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: "Authentication unavailable" }));
          });
      });
      await new Promise<void>((resolve, reject) => {
        httpServer?.once("error", reject);
        httpServer?.listen(port, host, resolve);
      });
    }
    if (downstreamTransport === undefined) {
      throw new Error("Downstream transport was not initialized");
    }
    await nox.connect(downstreamTransport);

    console.error("[NOX] Gateway ready");

    if (downstreamMode === "stdio") {
      await new Promise<void>((resolve, reject) => {
        process.stdin.once("end", resolve);
        process.stdin.once("error", reject);
      });
    } else {
      await new Promise<void>((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
    }

  } catch (error) {
    if (error instanceof UpstreamConfigurationError) {
      console.error(`[NOX] Startup failed: ${error.message}`);
    } else {
      console.error("[NOX] Startup failed: upstream unavailable");
    }
    process.exitCode = 1;
  } finally {
    if (httpServer !== undefined) {
      await closeResource("HTTP listener", () =>
        new Promise<void>((resolve, reject) =>
          httpServer?.close((closeError) =>
            closeError === undefined ? resolve() : reject(closeError),
          ),
        ),
      );
    }
    await closeResource("downstream", () => nox.close());
    await closeResource("upstream client", () => upstream.close());
    if (upstreamTransport !== undefined) {
      const transport = upstreamTransport;
      await closeResource("upstream transport", () => transport.close());
    }
  }
}

main();
