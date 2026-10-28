import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_UPSTREAM_CONFIGURATION,
  UpstreamConfigurationError,
  createUpstreamTransport,
  loadUpstreamConfiguration,
  parseUpstreamConfiguration,
} from "./index.js";

describe("upstream configuration", () => {
  it("uses the demo server when no configuration is supplied", () => {
    vi.stubEnv("NOX_UPSTREAM_FILE", undefined);
    vi.stubEnv("NOX_UPSTREAM_TRANSPORT", undefined);
    vi.stubEnv("NOX_UPSTREAM_COMMAND", undefined);
    vi.stubEnv("NOX_UPSTREAM_ARGS", undefined);

    expect(loadUpstreamConfiguration()).toEqual(DEFAULT_UPSTREAM_CONFIGURATION);
  });

  it("validates the executable and arguments", () => {
    expect(() => parseUpstreamConfiguration({ command: "" })).toThrow(
      UpstreamConfigurationError,
    );
    expect(() => parseUpstreamConfiguration({ command: "server", args: ["--ok", 1] })).toThrow(
      /args/,
    );
    expect(() => parseUpstreamConfiguration({ command: "server", extra: true })).toThrow(
      /Unknown upstream field/,
    );
    expect(() => parseUpstreamConfiguration({ transport: "http", url: "http://remote.test" })).toThrow(
      /HTTPS/,
    );
    expect(() => parseUpstreamConfiguration({ transport: "http", url: "not a url" })).toThrow(
      /invalid/,
    );
  });

  it("preserves the executable and argument boundaries", () => {
    const configuration = parseUpstreamConfiguration({
      command: "server executable",
      args: ["--name", "value with spaces"],
    });
    const transport = createUpstreamTransport(configuration);

    expect(transport).toBeInstanceOf(Object);
    expect(configuration).toEqual({
      transport: "stdio",
      command: "server executable",
      args: ["--name", "value with spaces"],
    });
  });

  it("loads command and JSON arguments from the environment", () => {
    vi.stubEnv("NOX_UPSTREAM_FILE", undefined);
    vi.stubEnv("NOX_UPSTREAM_TRANSPORT", "stdio");
    vi.stubEnv("NOX_UPSTREAM_COMMAND", "node");
    vi.stubEnv("NOX_UPSTREAM_ARGS", '["--version"]');

    expect(loadUpstreamConfiguration()).toEqual({
      transport: "stdio",
      command: "node",
      args: ["--version"],
    });
  });

  it("loads and creates a loopback HTTP upstream transport", () => {
    const configuration = parseUpstreamConfiguration({
      transport: "http",
      url: "http://127.0.0.1:3210/mcp",
    });

    expect(configuration).toEqual({
      transport: "http",
      url: "http://127.0.0.1:3210/mcp",
    });
    expect(createUpstreamTransport(configuration)).toBeInstanceOf(Object);
  });
});
