import { describe, expect, it } from "vitest";
import { discoverTools } from "./index.js";

describe("tool discovery", () => {
  it("returns a validated upstream tool list", async () => {
    const tools = await discoverTools({
      listTools: async () => ({
        tools: [
          { name: "one", inputSchema: { type: "object" } },
          { name: "two", inputSchema: { type: "object" } },
        ],
      }),
    });

    expect(tools.map((tool) => tool.name)).toEqual(["one", "two"]);
  });

  it("fails on an unavailable or invalid tool list", async () => {
    await expect(
      discoverTools({ listTools: async () => ({ tools: [] }) }),
    ).rejects.toThrow("no tools");
    await expect(
      discoverTools({
        listTools: async () => ({
          tools: [
            { name: "duplicate", inputSchema: { type: "object" } },
            { name: "duplicate", inputSchema: { type: "object" } },
          ],
        }),
      }),
    ).rejects.toThrow("invalid tool list");
    await expect(
      discoverTools({
        listTools: async () => {
          throw new Error("discovery failed");
        },
      }),
    ).rejects.toThrow("discovery failed");
  });
});
