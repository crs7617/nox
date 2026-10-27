
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({
  name: "nox-demo-client",
  version: "1.0.0",
});

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/index.ts"],
  env: {
    NOX_DENY_TOOLS: process.env.NOX_DENY_TOOLS ?? "",
    NOX_AUDIT_FILE: process.env.NOX_AUDIT_FILE ?? "nox-audit.jsonl",
    ...(process.env.NOX_APPROVAL_INPUT_FILE === undefined
      ? {}
      : { NOX_APPROVAL_INPUT_FILE: process.env.NOX_APPROVAL_INPUT_FILE }),
    ...(process.env.NOX_POLICY_FILE === undefined
      ? {}
      : { NOX_POLICY_FILE: process.env.NOX_POLICY_FILE }),
  },
});

async function main() {
  try {
    await client.connect(transport);

    const tools = await client.listTools();

    console.log("Available tools:");
    console.log(tools.tools.map((tool) => tool.name));

    const result = await client.callTool({
      name: "greet",
      arguments: {
        name: "Sairam",
      },
    });

    console.log("\nTool result:");
    console.log(result);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error("Demo client failed:", error);
  throw error;
});
