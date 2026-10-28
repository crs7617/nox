import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export type StdioUpstreamConfiguration = {
  transport: "stdio";
  command: string;
  args: string[];
};

export type HttpUpstreamConfiguration = {
  transport: "http";
  url: string;
};

export type UpstreamConfiguration =
  | StdioUpstreamConfiguration
  | HttpUpstreamConfiguration;

export class UpstreamConfigurationError extends Error {}

export const DEFAULT_UPSTREAM_CONFIGURATION: Readonly<StdioUpstreamConfiguration> = {
  transport: "stdio",
  command: "npx",
  args: ["tsx", "src/demo-server.ts"],
};

function parseArguments(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((argument) => typeof argument !== "string")) {
    throw new UpstreamConfigurationError("Upstream args must be an array of strings");
  }
  return [...value];
}

function parseHttpUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new UpstreamConfigurationError("HTTP upstream url must be a non-empty string");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UpstreamConfigurationError("HTTP upstream url is invalid");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new UpstreamConfigurationError(
      "HTTP upstream url must use HTTPS; plain HTTP is allowed only for loopback hosts",
    );
  }
  return url.toString();
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function parseUpstreamConfiguration(value: unknown): UpstreamConfiguration {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UpstreamConfigurationError("Upstream configuration must be a JSON object");
  }

  const record = value as Record<string, unknown>;
  const transport = record.transport ?? "stdio";
  if (transport === "stdio") {
    const unknownKeys = Object.keys(record).filter(
      (key) => !["transport", "command", "args"].includes(key),
    );
    if (unknownKeys.length > 0) {
      throw new UpstreamConfigurationError(
        `Unknown upstream field(s): ${unknownKeys.join(", ")}`,
      );
    }
    if (typeof record.command !== "string" || record.command.trim() === "") {
      throw new UpstreamConfigurationError("Upstream command must be a non-empty string");
    }
    return {
      transport: "stdio",
      command: record.command.trim(),
      args: record.args === undefined ? [] : parseArguments(record.args),
    };
  }

  if (transport === "http") {
    const unknownKeys = Object.keys(record).filter(
      (key) => !["transport", "url"].includes(key),
    );
    if (unknownKeys.length > 0) {
      throw new UpstreamConfigurationError(
        `Unknown upstream field(s): ${unknownKeys.join(", ")}`,
      );
    }
    return { transport: "http", url: parseHttpUrl(record.url) };
  }

  throw new UpstreamConfigurationError("Upstream transport must be \"stdio\" or \"http\"");
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

  const transport = process.env.NOX_UPSTREAM_TRANSPORT ?? "stdio";
  if (transport === "http") {
    return parseUpstreamConfiguration({
      transport,
      url: process.env.NOX_UPSTREAM_URL,
    });
  }
  if (transport !== "stdio") {
    throw new UpstreamConfigurationError("NOX_UPSTREAM_TRANSPORT must be \"stdio\" or \"http\"");
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
    return parseUpstreamConfiguration({ transport: "stdio", command, args: parsedArgs });
  }

  return {
    transport: DEFAULT_UPSTREAM_CONFIGURATION.transport,
    command: DEFAULT_UPSTREAM_CONFIGURATION.command,
    args: [...DEFAULT_UPSTREAM_CONFIGURATION.args],
  };
}

export function createUpstreamTransport(
  configuration: UpstreamConfiguration,
): Transport {
  if (configuration.transport === "stdio") {
    return new StdioClientTransport({
      command: configuration.command,
      args: configuration.args,
    });
  }
  return new StreamableHTTPClientTransport(new URL(configuration.url), {
    reconnectionOptions: {
      maxRetries: 0,
      initialReconnectionDelay: 0,
      maxReconnectionDelay: 0,
      reconnectionDelayGrowFactor: 1,
    },
  });
}
