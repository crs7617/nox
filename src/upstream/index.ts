import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type UpstreamConfiguration = {
  command: string;
  args: string[];
};

export class UpstreamConfigurationError extends Error {}

export const DEFAULT_UPSTREAM_CONFIGURATION: Readonly<UpstreamConfiguration> = {
  command: "npx",
  args: ["tsx", "src/demo-server.ts"],
};

function parseArguments(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((argument) => typeof argument !== "string")) {
    throw new UpstreamConfigurationError("Upstream args must be an array of strings");
  }
  return [...value];
}

export function parseUpstreamConfiguration(value: unknown): UpstreamConfiguration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UpstreamConfigurationError("Upstream configuration must be a JSON object");
  }

  const record = value as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !["command", "args"].includes(key));
  if (unknownKeys.length > 0) {
    throw new UpstreamConfigurationError(
      `Unknown upstream field(s): ${unknownKeys.join(", ")}`,
    );
  }
  if (typeof record.command !== "string" || record.command.trim() === "") {
    throw new UpstreamConfigurationError("Upstream command must be a non-empty string");
  }

  return {
    command: record.command.trim(),
    args: record.args === undefined ? [] : parseArguments(record.args),
  };
}

function loadUpstreamFile(path: string): UpstreamConfiguration {
  try {
    return parseUpstreamConfiguration(JSON.parse(readFileSync(resolve(path), "utf8")) as unknown);
  } catch (error) {
    if (error instanceof UpstreamConfigurationError) {
      throw error;
    }
    throw new UpstreamConfigurationError("Unable to load upstream configuration");
  }
}

export function loadUpstreamConfiguration(
  upstreamPath = process.env.NOX_UPSTREAM_FILE,
): UpstreamConfiguration {
  if (upstreamPath !== undefined) {
    return loadUpstreamFile(upstreamPath);
  }

  const command = process.env.NOX_UPSTREAM_COMMAND;
  const args = process.env.NOX_UPSTREAM_ARGS;
  if (command !== undefined || args !== undefined) {
    if (command === undefined) {
      throw new UpstreamConfigurationError(
        "NOX_UPSTREAM_COMMAND is required when configuring an upstream with environment variables",
      );
    }
    let parsedArgs: unknown = [];
    if (args !== undefined) {
      try {
        parsedArgs = JSON.parse(args) as unknown;
      } catch {
        throw new UpstreamConfigurationError("NOX_UPSTREAM_ARGS must be a JSON array");
      }
    }
    return parseUpstreamConfiguration({ command, args: parsedArgs });
  }

  return {
    command: DEFAULT_UPSTREAM_CONFIGURATION.command,
    args: [...DEFAULT_UPSTREAM_CONFIGURATION.args],
  };
}

export function createUpstreamTransport(
  configuration: UpstreamConfiguration,
): StdioClientTransport {
  return new StdioClientTransport({
    command: configuration.command,
    args: configuration.args,
  });
}
