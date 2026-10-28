import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export async function discoverTools(client: Pick<Client, "listTools">): Promise<Tool[]> {
  const response = await client.listTools();
  if (!Array.isArray(response.tools) || response.tools.length === 0) {
    throw new Error("Upstream advertised no tools");
  }

  const names = new Set<string>();
  for (const tool of response.tools) {
    if (
      typeof tool.name !== "string" ||
      tool.name.length === 0 ||
      names.has(tool.name) ||
      typeof tool.inputSchema !== "object" ||
      tool.inputSchema === null ||
      Array.isArray(tool.inputSchema) ||
      (tool.description !== undefined && typeof tool.description !== "string")
    ) {
      throw new Error("Upstream returned an invalid tool list");
    }
    names.add(tool.name);
  }

  return response.tools;
}
