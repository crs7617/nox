import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { bearerToken, authenticateToken, loadTokenFile, type TokenFile } from "../auth/index.js";
import {
  parsePolicyConfiguration,
  persistPolicyConfiguration,
  sanitizePolicyConfiguration,
  validatePolicyToolNames,
  type PolicyConfig,
  type SanitizedPolicyConfig,
} from "../policy/index.js";

export type ManagementStatus = {
  state: "ready";
  process: "nox";
  upstream: "connected";
  downstreamTransport: "stdio" | "http";
  discoveredToolCount: number;
};

export type ManagementServerOptions = {
  host?: string;
  port: number;
  tokenPath: string;
  policy: PolicyConfig;
  policyPath?: string;
  toolNames?: ReadonlySet<string>;
  applyPolicy?: (policy: PolicyConfig) => void;
  persistPolicy?: (path: string, policy: PolicyConfig) => Promise<void>;
  status: ManagementStatus;
  discoveredTools?: readonly Tool[];
  loadTokens?: (path: string) => Promise<TokenFile>;
};

export type RunningManagementServer = {
  server: Server;
  host: string;
  port: number;
  close: () => Promise<void>;
};

type JsonValue = Record<string, unknown>;

function sendJson(response: ServerResponse, status: number, body: JsonValue, headers = {}): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function safeError(
  response: ServerResponse,
  status: number,
  error:
    | "bad_request"
    | "not_found"
    | "method_not_allowed"
    | "persistence_failed"
    | "upstream_unavailable",
): void {
  const messages = {
    bad_request: "Bad request",
    not_found: "Not found",
    method_not_allowed: "Method not allowed",
    persistence_failed: "Unable to persist policy",
    upstream_unavailable: "Tool inventory unavailable",
  };
  sendJson(
    response,
    status,
    { error, message: messages[error] },
    error === "method_not_allowed" ? { allow: "GET, PUT, POST" } : {},
  );
}

function sanitizeTool(tool: Tool): Record<string, unknown> {
  return {
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema,
  };
}

function requestPath(request: IncomingMessage): string | undefined {
  if (typeof request.url !== "string") {
    return undefined;
  }
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.search !== "" || url.hash !== "") {
      return undefined;
    }
    return url.pathname;
  } catch {
    return undefined;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1024 * 1024) {
      throw new Error("request too large");
    }
    chunks.push(buffer);
  }
  if (length === 0) {
    throw new Error("empty request");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function createRequestHandler(options: ManagementServerOptions) {
  const loadTokens = options.loadTokens ?? loadTokenFile;
  let policy: SanitizedPolicyConfig = sanitizePolicyConfiguration(options.policy);
  const persistPolicy = options.persistPolicy ?? persistPolicyConfiguration;

  return (request: IncomingMessage, response: ServerResponse): void => {
    void loadTokens(options.tokenPath)
      .then((tokenFile) => {
        if (!authenticateToken(tokenFile, bearerToken(request.headers.authorization))) {
          sendJson(response, 401, { error: "Unauthorized" }, { "www-authenticate": "Bearer" });
          return;
        }
        const path = requestPath(request);
        if (path === undefined) {
          safeError(response, 400, "bad_request");
          return;
        }
        if (
          (path === "/health" && request.method !== "GET") ||
          (path === "/tools" && request.method !== "GET") ||
          (path === "/policy" && request.method !== "GET" && request.method !== "PUT") ||
          (path === "/policy/validate" && request.method !== "POST") ||
          (path !== "/health" && path !== "/tools" && path !== "/policy" && path !== "/policy/validate")
        ) {
          if (path === "/health" || path === "/tools" || path === "/policy" || path === "/policy/validate") {
            safeError(response, 405, "method_not_allowed");
          } else {
            safeError(response, 404, "not_found");
          }
          return;
        }
        if (request.method === "GET" && path === "/health") {
          sendJson(response, 200, options.status);
          return;
        }
        if (request.method === "GET" && path === "/tools") {
          if (options.discoveredTools === undefined) {
            safeError(response, 503, "upstream_unavailable");
            return;
          }
          const tools = options.discoveredTools.map(sanitizeTool);
          sendJson(response, 200, { count: tools.length, tools });
          return;
        }
        if (request.method === "GET" && path === "/policy") {
          sendJson(response, 200, policy);
          return;
        }
        if (path !== "/policy" && path !== "/policy/validate") {
          safeError(response, 404, "not_found");
          return;
        }
        void readJsonBody(request)
          .then((body) => {
            const proposed = parsePolicyConfiguration(body);
            if (options.toolNames !== undefined) {
              validatePolicyToolNames(proposed, options.toolNames);
            }
            const sanitized = sanitizePolicyConfiguration(proposed);
            if (request.method === "POST") {
              sendJson(response, 200, { valid: true, policy: sanitized });
              return;
            }
            if (options.policyPath === undefined || options.applyPolicy === undefined) {
              safeError(response, 503, "persistence_failed");
              return;
            }
            return persistPolicy(options.policyPath, proposed)
              .then(() => {
                options.applyPolicy?.(proposed);
                policy = sanitized;
                sendJson(response, 200, policy);
              })
              .catch(() => {
                if (!response.headersSent) {
                  safeError(response, 503, "persistence_failed");
                }
              });
          })
          .catch((error) => {
            if (!response.headersSent) {
              sendJson(response, 400, {
                error: "invalid_policy",
                message: "Invalid policy",
              });
            }
          });
        return;
      })
      .catch(() => {
        if (!response.headersSent) {
          sendJson(response, 503, { error: "Authentication unavailable" });
        }
      });
  };
}

export async function startManagementServer(options: ManagementServerOptions): Promise<RunningManagementServer> {
  const host = options.host ?? "127.0.0.1";
  const server = createServer(createRequestHandler(options));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Management API did not expose a TCP address");
  }
  return {
    server,
    host,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      ),
  };
}
