
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "nox-demo-server",
  version: "1.0.0",
});

server.registerTool(
  "greet",
  {
    description: "Greet a person by name.",
    inputSchema: {
      name: z.string().min(1).describe("The person's name"),
    },
  },
  async ({ name }) => {
    console.error("[NOX-DEMO] greet handler executed");
    return {
      content: [
        {
          type: "text",
          text: `Hello, ${name}! Greetings from Nox.`,
        },
      ],
    };
  },
);

server.registerTool(
  "farewell",
  {
    description: "Say farewell to a person.",
    inputSchema: {
      name: z.string().min(1).describe("The person's name"),
    },
  },
  async ({ name }) => {
    console.error("[NOX-DEMO] farewell handler executed");
    return {
      content: [
        {
          type: "text",
          text: `Goodbye, ${name}!`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();

await server.connect(transport);
