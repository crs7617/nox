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
import {
  loadUpstreamConfiguration,
  parseUpstreamConfiguration,
  persistUpstreamConfiguration,
  type UpstreamConfiguration,
} from "../upstream/index.js";
import type { ApprovalManager, PendingApproval } from "../approval/index.js";

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
  approval?: ApprovalManager;
  upstream?: UpstreamConfiguration;
  upstreamPath?: string;
  persistUpstream?: (path: string, configuration: UpstreamConfiguration) => Promise<void>;
  testUpstream?: (configuration: UpstreamConfiguration) => Promise<{ connected: boolean; toolCount: number }>;
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
    | "upstream_unavailable"
    | "approval_unavailable"
    | "upstream_persistence_failed",
): void {
  const messages = {
    bad_request: "Bad request",
    not_found: "Not found",
    method_not_allowed: "Method not allowed",
    persistence_failed: "Unable to persist policy",
    upstream_unavailable: "Tool inventory unavailable",
    approval_unavailable: "Approval service unavailable",
    upstream_persistence_failed: "Unable to persist upstream configuration",
  };
  sendJson(
    response,
    status,
    { error, message: messages[error] },
    error === "method_not_allowed" ? { allow: "GET, PUT, POST" } : {},
  );
}

function safeUpstream(configuration: UpstreamConfiguration): Record<string, unknown> {
  return configuration.transport === "stdio"
    ? { transport: "stdio", command: configuration.command, args: configuration.args }
    : { transport: "http", url: configuration.url };
}

function safeApproval(approval: PendingApproval): PendingApproval {
  return { ...approval };
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
  let upstream = options.upstream;
  let upstreamRuntimeStatus: string = options.status.upstream;
  const persistUpstream = options.persistUpstream ?? persistUpstreamConfiguration;

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
        const approvalPath = path?.match(/^\/approvals(?:\/([^/]+)(?:\/(approve|reject))?)?$/u);
        const upstreamPath = path?.match(/^\/upstreams(?:\/([^/]+))?$/u);
        const allowed = [
          "/health", "/tools", "/policy", "/policy/validate", "/approvals",
          "/upstreams", "/upstreams/test",
        ];
        if (
          !allowed.includes(path ?? "") &&
          approvalPath === null &&
          upstreamPath === null
        ) {
          safeError(response, 404, "not_found");
          return;
        }
        if (
          (path === "/health" && request.method !== "GET") ||
          (path === "/tools" && request.method !== "GET") ||
          (path === "/policy" && request.method !== "GET" && request.method !== "PUT") ||
          (path === "/policy/validate" && request.method !== "POST") ||
          (path === "/approvals" && request.method !== "GET") ||
          (approvalPath !== null && approvalPath[1] !== undefined && request.method !== "GET" && request.method !== "POST") ||
          (path === "/upstreams" && request.method !== "GET" && request.method !== "POST") ||
          (upstreamPath !== null && upstreamPath[1] !== undefined && request.method !== "GET" && request.method !== "PUT" && request.method !== "DELETE") ||
          (path === "/upstreams/test" && request.method !== "POST")
        ) {
          if (allowed.includes(path ?? "") || approvalPath !== null || upstreamPath !== null) {
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
        }
          if (request.method === "GET" && path === "/approvals") {
            if (options.approval === undefined) {
              safeError(response, 503, "approval_unavailable");
              return;
            }
            const approvals = options.approval.list().map(safeApproval);
            sendJson(response, 200, { count: approvals.length, approvals });
            return;
          }
          if (approvalPath !== null && approvalPath[1] !== undefined && request.method === "GET") {
            const approval = options.approval?.get(approvalPath[1]);
            if (approval === undefined) {
              safeError(response, 404, "not_found");
              return;
            }
            sendJson(response, 200, { approval: safeApproval(approval) });
            return;
          }
          if (approvalPath !== null && approvalPath[1] !== undefined && request.method === "POST") {
            const decision = approvalPath[2] === "reject" ? "rejected" : approvalPath[2] === "approve" ? "approved" : undefined;
            if (options.approval === undefined) {
              safeError(response, 503, "approval_unavailable");
              return;
            }
            if (decision === undefined) {
              safeError(response, 405, "method_not_allowed");
              return;
            }
            const id = approvalPath[1];
            const resolved = options.approval.resolve(id, decision as "approved" | "rejected");
            if (!resolved) {
              const current = options.approval.get(id);
              sendJson(response, current?.status === "expired" ? 409 : 404, {
                error: current?.status === "expired" ? "expired" : "not_found",
                message: current?.status === "expired" ? "Approval request expired" : "Approval request unavailable",
              });
              return;
            }
            sendJson(response, 200, { approval: options.approval.get(id) ?? { id, status: decision } });
            return;
          }
          if (request.method === "GET" && path === "/upstreams") {
            if (upstream === undefined) {
              try {
                upstream = loadUpstreamConfiguration(options.upstreamPath);
              } catch {
                safeError(response, 503, "upstream_unavailable");
                return;
              }
            }
            sendJson(response, 200, {
              restartRequired: true,
              upstreams: [{ id: "default", status: upstreamRuntimeStatus, toolCount: options.status.discoveredToolCount, ...safeUpstream(upstream) }],
            });
            return;
          }
          if (request.method === "POST" && path === "/upstreams/test") {
            void readJsonBody(request).then(async (body) => {
              const configuration = parseUpstreamConfiguration(body);
              try {
                const result = options.testUpstream === undefined
                  ? { connected: false, toolCount: 0 }
                  : await options.testUpstream(configuration);
                sendJson(response, 200, result);
              } catch {
                sendJson(response, 503, { error: "connection_failed", message: "Upstream connection failed" });
              }
            }).catch(() => {
              if (!response.headersSent) sendJson(response, 400, { error: "invalid_upstream", message: "Invalid upstream configuration" });
            });
            return;
          }
          if (request.method === "POST" && path === "/upstreams") {
            void readJsonBody(request).then(async (body) => {
              const configuration = parseUpstreamConfiguration(body);
              if (options.upstreamPath === undefined) {
                safeError(response, 503, "upstream_persistence_failed");
                return;
              }
              await persistUpstream(options.upstreamPath, configuration);
              upstream = configuration;
              upstreamRuntimeStatus = "restart-required";
              sendJson(response, 200, { id: "default", restartRequired: true, ...safeUpstream(configuration) });
            }).catch(() => {
              if (!response.headersSent) safeError(response, 400, "upstream_persistence_failed");
            });
            return;
          }
          if (upstreamPath !== null && upstreamPath[1] === "default" && request.method === "PUT") {
            void readJsonBody(request).then(async (body) => {
              const configuration = parseUpstreamConfiguration(body);
              if (options.upstreamPath === undefined) {
                safeError(response, 503, "upstream_persistence_failed");
                return;
              }
              await persistUpstream(options.upstreamPath, configuration);
              upstream = configuration;
              upstreamRuntimeStatus = "restart-required";
              sendJson(response, 200, { id: "default", restartRequired: true, ...safeUpstream(configuration) });
            }).catch(() => {
              if (!response.headersSent) safeError(response, 400, "upstream_persistence_failed");
            });
            return;
          }
          if (upstreamPath !== null && upstreamPath[1] === "default" && request.method === "DELETE") {
            sendJson(response, 409, { error: "restart_required", message: "The configured upstream cannot be removed while the gateway is running." });
            return;
          }
        if (request.method === "GET" && path === "/tools") {
          const tools = options.discoveredTools?.map(sanitizeTool) ?? [];
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
