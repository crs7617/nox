import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "nox-local-integration-server",
  version: "1.0.0",
});

server.registerTool(
  "add",
  {
    description: "Add two numbers.",
    inputSchema: {
      left: z.number(),
      right: z.number(),
    },
  },
  async ({ left, right }) => {
    console.error("[NOX-LOCAL-TEST] add handler executed");
    return {
      content: [{ type: "text", text: String(left + right) }],
    };
  },
);

server.registerTool(
  "blocked-operation",
  {
    description: "A tool used to verify policy denial.",
    inputSchema: {},
  },
  async () => {
    console.error("[NOX-LOCAL-TEST] blocked-operation handler executed");
    return {
      content: [{ type: "text", text: "should not execute" }],
    };
  },
);

await server.connect(new StdioServerTransport());
