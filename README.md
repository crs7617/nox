# Nox

Nox is a security gateway for MCP tool calls. It sits between MCP clients and upstream servers to enforce tool policies, require human approval for sensitive operations, and record privacy-conscious audit logs.

## How it works

Nox sits between an MCP client and an upstream MCP server, acting as a security checkpoint for tool calls.

At startup, Nox discovers the upstream server's tools and exposes their names, descriptions, and input schemas to the client. When a tool is called, Nox checks its policy first, requests human approval for configured sensitive tools, and forwards only permitted calls. Decisions and outcomes are recorded in privacy-conscious JSONL audit logs.

Upstream failures and timeouts return safe MCP errors. Nox does not automatically retry calls, since tools may have side effects.

Nox supports local MCP servers over stdio and upstream MCP servers over
Streamable HTTP. Remote HTTP connections do not change the downstream stdio
interface.

## Features

- Dynamic upstream MCP tool discovery and metadata exposure.
- Exact-name allow/deny policy rules and `NOX_DENY_TOOLS` compatibility denies.
- Fail-closed human approval for configured sensitive tools.
- Serialized, privacy-conscious JSONL audit events.
- Configurable upstream call timeout and safe failure responses.
- MCP protocol messages on stdout; diagnostics on stderr.

## Prerequisites and commands

Requires Node.js 18 or newer and npm.

```sh
npm ci
npm run build
npm test
npm run demo-client
```

`npm run demo-client` starts the demo client, which starts Nox; Nox starts the
demo upstream server using the default configuration. The demo client prints
the discovered tools and calls `greet`.

## Configuration

Nox optionally reads `nox-policy.json` from the working directory. Set
`NOX_POLICY_FILE` to use another file. An explicitly selected file must exist
and validate.

```json
{
  "allow": ["greet", "farewell"],
  "deny": ["dangerous-tool"],
  "approval": ["farewell"],
  "approvalTimeoutMs": 30000,
  "upstreamTimeoutMs": 30000
}
```

The upstream is configured separately. By default Nox launches
`npx tsx src/demo-server.ts`, preserving the demo workflow. To select a
different local stdio server, set `NOX_UPSTREAM_FILE` to a JSON file such as
[`nox-upstream.example.json`](./nox-upstream.example.json):

```json
{
  "command": "python",
  "args": ["server.py", "--profile", "safe mode"]
}
```

The `command` is the executable and `args` is an array of individual
arguments. Nox passes them directly to the MCP SDK's
`StdioClientTransport`; it does not invoke a shell or parse a command string.
The file must contain only a non-empty `command` and an optional string-array
`args`. An explicitly selected file must exist and validate. For simple
deployments, the same values can be supplied without a file:

```powershell
$env:NOX_UPSTREAM_COMMAND = "python"
$env:NOX_UPSTREAM_ARGS = '["server.py", "--profile", "safe mode"]'
npm run dev
```

`NOX_UPSTREAM_ARGS` must be valid JSON. The file setting takes precedence over
the environment settings; setting only one environment variable is invalid.
For example, to run the demo client against a custom server:

```powershell
$env:NOX_UPSTREAM_FILE = "$PWD\nox-upstream.json"
npm run demo-client
```

For a Streamable HTTP upstream, use an explicit transport configuration:

```json
{
  "transport": "http",
  "url": "https://mcp.example.test/mcp"
}
```

Set `NOX_UPSTREAM_FILE` to this file, or use:

```powershell
$env:NOX_UPSTREAM_TRANSPORT = "http"
$env:NOX_UPSTREAM_URL = "https://mcp.example.test/mcp"
npm run dev
```

HTTPS is required for non-loopback HTTP upstreams. Plain HTTP is accepted only
for `localhost`, `127.0.0.1`, or `::1`, which supports controlled local
development and tests. Nox does not provide authentication in this milestone;
place the upstream behind a trusted network boundary and configure TLS and
authentication outside Nox as appropriate. The SDK transport is configured
with zero reconnection retries, and Nox never retries tool calls.

## Remote client authentication

The upstream configuration above controls how Nox connects to an upstream
server. Client authentication is a separate boundary: it protects clients
connecting to Nox's optional downstream HTTP listener and does not authenticate
Nox to an upstream server.

Local stdio mode remains the default and does not require a PAT. To expose Nox
over Streamable HTTP, configure the downstream listener and a token file:

```powershell
$env:NOX_DOWNSTREAM_TRANSPORT = "http"
$env:NOX_DOWNSTREAM_HOST = "127.0.0.1"
$env:NOX_DOWNSTREAM_PORT = "3000"
$env:NOX_AUTH_TOKEN_FILE = "$PWD\nox-tokens.json"
npm run dev
```

Create a token once and save the displayed secret securely:

```powershell
$env:NOX_AUTH_TOKEN_FILE = "$PWD\nox-tokens.json"
npm run auth-token -- create
```

The command prints the newly generated token once. The token file stores only
its SHA-256 hash, token id, optional expiration, and optional revocation time;
the plaintext token is never written to disk. Protect the file with restrictive
filesystem permissions and do not commit it. An optional ISO expiration can be
provided:

```powershell
npm run auth-token -- create 2027-01-01T00:00:00.000Z
```

Clients must send the token as an HTTP header:

```http
Authorization: Bearer <token>
```

Revoke a token by its id from `nox-tokens.json`:

```powershell
npm run auth-token -- revoke <token-id>
```

Nox reloads the token file for each HTTP request, so revocation takes effect
without restarting the process. Missing, malformed, expired, revoked, and
invalid credentials receive HTTP 401 before MCP initialization, discovery, or
tool execution. Authentication failures do not include token values or
authorization headers in diagnostics or audit events. This is bearer-token
authentication: anyone who obtains a valid token can use the protected Nox
endpoint until it expires or is revoked. Use HTTPS for non-loopback listeners;
Nox does not implement OAuth, token rotation, per-user permissions, or a
dashboard.

For a reproducible end-to-end check using the independent local fixture in
[`src/local-test-server.ts`](./src/local-test-server.ts), run:

```sh
npx vitest run src/local-mcp.integration.test.ts
```

That test starts the separate stdio server through Nox, verifies both
discovered tools and their metadata, invokes `add`, and confirms that a
policy-denied tool does not reach its upstream handler. It also verifies safe
startup failure for an unavailable executable. The fixture writes diagnostics
only to stderr, as required for stdio MCP servers.

The controlled Streamable HTTP integration test starts an in-process local MCP
HTTP server and does not contact a public service:

```sh
npx vitest run src/http-mcp.integration.test.ts
```

Nox validates the configuration before starting the downstream MCP connection.
Missing executables, upstream initialization failures, invalid tool discovery,
and shutdown failures are reported as safe diagnostics on stderr; raw
exceptions, tool arguments, results, credentials, and environment values are
not logged. The executable and arguments are still local process configuration:
use trusted files and paths, and avoid putting secrets in arguments because
operating-system process listings may expose them. The upstream inherits only
the environment variables permitted by the MCP SDK's stdio transport.

Rules use exact tool names. `NOX_DENY_TOOLS` is a comma-separated deny
override. Denies are evaluated before the allow list; a non-empty `allow`
list denies tools not listed. Policy denial always precedes approval and
upstream execution.

Approval prompts are written to stderr and read from `/dev/tty` (or
`CONIN$` on Windows), never from the MCP protocol stdin. `y` or `yes` is
required; rejection, EOF, unavailable input, malformed input, and timeout all
fail closed. Prompts are serialized. `NOX_APPROVAL_INPUT_FILE` exists only
for non-interactive test harnesses.

Audit events default to `nox-audit.jsonl`; set `NOX_AUDIT_FILE` to override the
path. Events contain a UTC timestamp, sanitized tool name, policy decision,
outcome, and safe reason or approval status. Arguments, results, secrets,
environment values, and raw exceptions are not written. Audit write failures
produce a stderr warning and may leave an event missing.

`upstreamTimeoutMs` controls how long Nox waits for an upstream call. The
installed MCP stdio transport does not guarantee cancellation when this local
deadline wins, so upstream work may continue in the background. Nox does not
retry timed-out or failed calls.

## Development roadmap

### Stage 1 — Security gateway core

- [x] MCP proxy and tool forwarding
- [x] Configurable allow/deny policies
- [x] Human approval gate for sensitive tools
- [x] Privacy-conscious audit logging
- [x] Dynamic upstream tool discovery
- [x] Upstream timeout and failure handling

### Stage 2 — Real MCP integrations

- [x] Configurable upstream server commands and arguments
- [x] Support for real local stdio MCP servers
- [x] End-to-end test with a real MCP server and compatible client
- [x] Document server configuration and operational limitations

### Stage 3 — Remote support and hardening

- [x] Remote Streamable HTTP transport without built-in authentication
- [ ] Security tests for malformed input, secrets handling, and failure cases
- [ ] Reproducible demo and security documentation

Stage 3 remains intentionally incomplete; Nox is still a prototype for remote
transport and broader hardening.
