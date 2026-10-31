import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { bearerToken, authenticateToken, loadTokenFile, type TokenFile } from "../auth/index.js";
import { sanitizePolicyConfiguration, type PolicyConfig, type SanitizedPolicyConfig } from "../policy/index.js";

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
  status: ManagementStatus;
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

function safeError(response: ServerResponse, status: number, error: "bad_request" | "not_found" | "method_not_allowed"): void {
  const messages = {
    bad_request: "Bad request",
    not_found: "Not found",
    method_not_allowed: "Method not allowed",
  };
  sendJson(response, status, { error, message: messages[error] }, error === "method_not_allowed" ? { allow: "GET" } : {});
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

function createRequestHandler(options: ManagementServerOptions) {
  const loadTokens = options.loadTokens ?? loadTokenFile;
  const policy: SanitizedPolicyConfig = sanitizePolicyConfiguration(options.policy);

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
        if (request.method !== "GET") {
          safeError(response, 405, "method_not_allowed");
          return;
        }
        if (path === "/health") {
          sendJson(response, 200, options.status);
          return;
        }
        if (path === "/policy") {
          sendJson(response, 200, policy);
          return;
        }
        safeError(response, 404, "not_found");
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
