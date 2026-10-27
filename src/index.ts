
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolResultSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

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

// Comma-separated tool names to deny, e.g. NOX_DENY_TOOLS=greet
const deniedTools = new Set(
  (process.env.NOX_DENY_TOOLS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);

async function main() {
  try {
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
        // Enforce policy BEFORE forwarding the tool call.
        if (deniedTools.has("greet")) {
          console.error("[NOX] DENIED tool=greet");
          return {
            content: [
              { type: "text", text: "Blocked by Nox policy: greet" },
            ],
            isError: true,
          };
        }

        console.error("[NOX] ALLOWED tool=greet");

        const result = await upstream.callTool(
          {
            name: "greet",
            arguments: { name },
          },
          CallToolResultSchema,
        );

        if (!("content" in result)) {
          throw new Error("Upstream returned a task result instead of a tool result");
        }

        return result as CallToolResult;
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
    console.error("[NOX] Startup failed:", error);
    await upstream.close().catch(() => {});
    process.exitCode = 1;
  }
}

main();
