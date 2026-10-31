# Nox

Nox is a prototype security gateway for MCP tool calls. It sits between an
MCP client and an upstream server to apply exact-name tool policy, request
human approval for selected tools, and write privacy-conscious JSONL audit
events.

Nox is not a production security boundary. The controls and limitations
documented below describe the current implementation and its tests; they are
not a security guarantee for arbitrary upstream tools or deployments.

## Quick start

Prerequisites:

- Node.js 18 or newer (the CI workflow uses Node.js 22)
- npm
- A checkout of this repository

From a clean checkout:

```sh
npm ci
npm run build
npm test
npm run demo-client
```

The last command starts the default demo upstream
([`src/demo-server.ts`](./src/demo-server.ts)) through Nox. It prints the
discovered tools (`greet`, `farewell`, `fail`, and `slow`) and calls `greet`.
MCP protocol data is on stdout; diagnostics are on stderr. The successful call
appends an event to [`nox-audit.jsonl`](./nox-audit.jsonl).

The package scripts are:

| Script | Purpose |
| --- | --- |
| `npm run build` | Type-check and compile with `tsc` |
| `npm test` | Run all tests with `vitest run src` |
| `npm run demo` | Start the demo upstream server directly |
| `npm run demo-client` | Run the demo client against local stdio Nox, or HTTP when configured below |
| `npm run dev` | Start Nox |
| `npm run auth-token -- ...` | Create or revoke a downstream PAT |

## Frontend foundation

The frontend is an isolated Next.js App Router application under
[`frontend/`](./frontend). It does not replace or import the gateway entry
point. Install and run it separately:

```powershell
npm install --prefix frontend
$env:NOX_AUDIT_FILE = "$PWD\nox-audit.jsonl"
npm run dev --prefix frontend
```

Open `http://localhost:3000`. The Audit logs screen reads only the existing
sanitized JSONL audit schema through a read-only server route. It does not
control the gateway, expose tokens or tool arguments, or use the MCP
Streamable HTTP endpoint as a dashboard API. If `NOX_AUDIT_FILE` is absent or
the file does not exist, the UI shows an explicit integration state instead of
inventing events.

Frontend checks:

```powershell
npm run typecheck --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
```

## Reproducible security demonstrations

Run these from separate PowerShell terminals when a process must stay running.
Use `$PWD` for paths in PowerShell; quote paths containing spaces.

### Tool discovery and a successful call

The quick start already demonstrates both behaviors:

```powershell
Remove-Item .\nox-audit.jsonl -ErrorAction SilentlyContinue
npm run demo-client
Get-Content .\nox-audit.jsonl
```

The client receives the upstream names, descriptions, and input schemas from
`tools/list`, then calls `greet`. The audit line has `decision: "allowed"` and
`outcome: "success"`; it does not contain the call arguments or result.

### Policy denial before upstream execution

```powershell
$env:NOX_DENY_TOOLS = "greet"
$env:NOX_AUDIT_FILE = "$PWD\nox-denied-audit.jsonl"
npm run demo-client
Get-Content .\nox-denied-audit.jsonl
Remove-Item Env:NOX_DENY_TOOLS, Env:NOX_AUDIT_FILE
```

The call returns an MCP error (`Blocked by Nox policy`) and the demo upstream
does not run its `greet` handler. The audit event is denied/error with reason
`Denied by NOX_DENY_TOOLS`.

### Approval: approve and reject

Approval applies only to tools listed in the policy file. The input file is a
non-interactive test/demo input; normal operation reads from `/dev/tty` or
`CONIN$`, not MCP protocol stdin.

```powershell
@'
{"approval":["greet"],"approvalTimeoutMs":30000}
'@ | Set-Content .\nox-approval-policy.json
"yes" | Set-Content .\nox-approval-input.txt
$env:NOX_POLICY_FILE = "$PWD\nox-approval-policy.json"
$env:NOX_APPROVAL_INPUT_FILE = "$PWD\nox-approval-input.txt"
$env:NOX_AUDIT_FILE = "$PWD\nox-approved-audit.jsonl"
npm run demo-client
Get-Content .\nox-approved-audit.jsonl
```

The call succeeds and the audit event includes `approval: "approved"`.
Replace `yes` with `no`, change the audit filename, and run it again to see
`Blocked by Nox approval: Approval rejected` and `approval: "rejected"`.
Missing input, EOF, and timeout also fail closed. Clean up the demo files and
variables when finished:

```powershell
Remove-Item .\nox-approval-policy.json, .\nox-approval-input.txt, .\nox-approved-audit.jsonl -ErrorAction SilentlyContinue
Remove-Item Env:NOX_POLICY_FILE, Env:NOX_APPROVAL_INPUT_FILE, Env:NOX_AUDIT_FILE
```

### Audit logging

Audit output defaults to `nox-audit.jsonl`; set `NOX_AUDIT_FILE` to select
another path. Events contain a UTC timestamp, sanitized tool name, policy
decision, outcome, and safe reason/approval status. Arguments, results,
credentials, authorization headers, environment values, and raw exception
details are not serialized. An audit write failure emits a stderr warning and
can leave an event missing.

## Configuration

### Policy

Nox reads `nox-policy.json` in the working directory. Set
`NOX_POLICY_FILE` for another path. An explicitly selected file must exist and
validate:

```json
{
  "allow": ["greet", "farewell"],
  "deny": ["dangerous-tool"],
  "approval": ["farewell"],
  "approvalTimeoutMs": 30000,
  "upstreamTimeoutMs": 30000
}
```

Rules use exact tool names. A non-empty `allow` list denies everything not in
it. Deny rules and `NOX_DENY_TOOLS` are evaluated before approval; a denial
never reaches the upstream handler. `NOX_DENY_TOOLS` is a comma-separated
compatibility deny list.

### Local stdio upstream

With no upstream settings, Nox launches:

```text
npx tsx src/demo-server.ts
```

For another local MCP server, use
[`nox-upstream.example.json`](./nox-upstream.example.json):

```json
{
  "command": "python",
  "args": ["server.py", "--profile", "safe mode"]
}
```

```powershell
$env:NOX_UPSTREAM_FILE = "$PWD\nox-upstream.json"
npm run dev
```

The command and each argument are passed directly to the MCP SDK; Nox does
not invoke a shell or parse a command string. Alternatively:

```powershell
$env:NOX_UPSTREAM_COMMAND = "python"
$env:NOX_UPSTREAM_ARGS = '["server.py", "--profile", "safe mode"]'
npm run dev
```

`NOX_UPSTREAM_FILE` takes precedence. If environment configuration is used,
`NOX_UPSTREAM_ARGS` must be a JSON array of strings and the command must be
present. Treat commands, configuration files, and process arguments as
operator-controlled sensitive inputs.

### Streamable HTTP upstream

Use an HTTPS URL for a non-loopback upstream. Plain HTTP is accepted only for
`localhost`, `127.0.0.1`, or `::1`:

```json
{
  "transport": "http",
  "url": "https://mcp.example.test/mcp"
}
```

```powershell
$env:NOX_UPSTREAM_FILE = "$PWD\nox-http-upstream.json"
npm run dev
```

Or:

```powershell
$env:NOX_UPSTREAM_TRANSPORT = "http"
$env:NOX_UPSTREAM_URL = "https://mcp.example.test/mcp"
npm run dev
```

This configures Nox's connection to the upstream; it does not authenticate
Nox to that upstream. Configure upstream authentication and TLS outside Nox.
The HTTP transport is configured with zero reconnection retries, and Nox never
retries tool calls.

## Protected downstream HTTP listener

The default downstream transport is local stdio and needs no PAT. To expose
Nox over Streamable HTTP, first create a token store and a PAT:

```powershell
$env:NOX_AUTH_TOKEN_FILE = "$PWD\nox-tokens.json"
npm run auth-token -- create
```

The command prints the plaintext token once. Save it securely. The token
store contains only the token's SHA-256 hash, id, and optional expiration or
revocation timestamp. It never contains the plaintext. Find the id needed for
revocation with:

```powershell
$tokenId = (Get-Content .\nox-tokens.json | ConvertFrom-Json).tokens[0].id
$tokenId
```

Start Nox in another terminal:

```powershell
$env:NOX_AUTH_TOKEN_FILE = "$PWD\nox-tokens.json"
$env:NOX_DOWNSTREAM_TRANSPORT = "http"
$env:NOX_DOWNSTREAM_HOST = "127.0.0.1"
$env:NOX_DOWNSTREAM_PORT = "3000"
npm run dev
```

The listener is `http://127.0.0.1:3000/mcp`. For a manual authenticated
demo, put the one-time output from `auth-token` in `$env:NOX_DEMO_BEARER_TOKEN`
and run the HTTP-capable demo client in a third terminal:

```powershell
$env:NOX_DEMO_HTTP_URL = "http://127.0.0.1:3000/mcp"
$env:NOX_DEMO_BEARER_TOKEN = "<paste-the-token-output-here>"
npm run demo-client
```

The client sends `Authorization: Bearer <token>`, discovers tools, and calls
`greet`. The client does not print the token. To demonstrate rejection:

```powershell
try {
  Invoke-WebRequest http://127.0.0.1:3000/mcp -Method Post `
    -ContentType "application/json" -Body "{}" -ErrorAction Stop
} catch {
  [int]$_.Exception.Response.StatusCode
}
```

This request has no bearer token and receives HTTP 401 before MCP
initialization or tool execution. Revoke the PAT, without restarting Nox:

```powershell
npm run auth-token -- revoke $tokenId
```

Subsequent requests using that token receive HTTP 401 because Nox reloads the
token store for every request. Use HTTPS and a protected network boundary for
non-loopback listeners; this built-in listener is not an OAuth server and has
no rate limiting, token rotation, or per-user authorization.

The complete local authentication integration test exercises valid, missing,
invalid, expired, and revoked credentials:

```sh
npx vitest run src/remote-auth.integration.test.ts
```

## Management API

The optional management API is a separate HTTP listener from the MCP `/mcp`
endpoint. It is read-only and requires a token from `NOX_AUTH_TOKEN_FILE` for
every request. Enable it with a port; it binds to loopback by default:

```powershell
$env:NOX_AUTH_TOKEN_FILE = "$PWD\nox-tokens.json"
$env:NOX_MANAGEMENT_PORT = "3001"
npm run dev
```

Use the generated bearer token with `GET http://127.0.0.1:3001/health` or
`GET http://127.0.0.1:3001/policy`. `NOX_MANAGEMENT_HOST` can override the
listener address, but remote administration is not enabled by default and
should only be used with an independently secured network boundary. The API
does not provide policy mutation or command execution. Health reports only
startup facts available to the current process: connected upstream, selected
downstream transport, and discovered tool count; it does not claim to monitor
future runtime failures.

## Verification commands

These tests use local fixtures and do not contact a public service:

```sh
npx vitest run src/local-mcp.integration.test.ts
npx vitest run src/http-mcp.integration.test.ts
npx vitest run src/remote-auth.integration.test.ts
npx vitest run src/management/index.test.ts
npm run build
npm test
git diff --check
```

The local test fixture demonstrates discovery, a successful `add` call, and a
policy denial before the upstream handler runs. The HTTP fixture demonstrates
Streamable HTTP discovery, forwarding, and safe unavailable-upstream failure.
The full suite also covers malformed configuration and discovery, approval
fail-closed behavior, timeout without retry, safe failure responses, and
privacy-conscious audit serialization.

## Threat model and trust boundaries

### In scope

- The Nox process is trusted to enforce its configured exact-name policy before
  forwarding a call.
- The upstream process or HTTP service is outside Nox's trust boundary.
- The downstream MCP client is untrusted until it passes the configured PAT
  check in HTTP mode.
- Tool metadata is treated as untrusted input and validated before exposure.
- Policy denial and approval happen before the upstream handler is called.

### Out of scope and limitations

- **Bearer-token risk:** a PAT is a bearer credential. Anyone who obtains it
  can use the endpoint until expiration or revocation. There is no identity
  binding, OAuth, rotation, or per-user permission model.
- **Transport security:** the HTTP listener is plain HTTP. Use loopback for
  the demo or terminate TLS in a trusted reverse proxy/network boundary.
  Non-loopback HTTP upstream URLs are rejected unless HTTPS is used.
- **Token-file protection:** the file stores hashes and is written with mode
  `0600`; Windows operators must use filesystem ACLs. Hashing does not protect
  the token from a user/process that can read the original token or store.
- **No per-user authorization:** every valid token gets the same configured
  tool policy. Nox does not provide tenant isolation or user-specific audit
  identity.
- **Schemas are not safety proofs:** a tool's JSON schema describes accepted
  input shape, not its side effects, implementation, or trustworthiness.
  Review upstream code and tool descriptions; do not treat discovery metadata
  as a guarantee of safe behavior.
- **Audit limits:** audit events intentionally omit arguments and results.
  Audit writes can fail, and operator-supplied policy reasons are not a
  general secret detector.
- **Timeout limits:** a local timeout returns an error without retrying, but
  the installed stdio transport may not cancel upstream work that is already
  running.
- **Operational controls:** there is no rate limiting, dashboard, secret
  scanning, or production deployment hardening in this prototype.

## Implemented versus future work

Implemented and covered by tests: stdio and Streamable HTTP upstream
configuration, dynamic discovery, exact-name allow/deny policy, fail-closed
approval, PAT validation/revocation, safe failure responses, no automatic
retry, and sanitized audit event serialization.

Future work includes OAuth or another identity-bound authentication scheme,
token rotation, rate limiting, per-user permissions and audit identity,
stronger cancellation, deployment TLS integration, and broader operational
hardening. Nox should not be described as production-ready or as providing
those guarantees today.
