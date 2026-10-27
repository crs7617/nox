# Nox

Nox is a minimal MCP stdio proxy. It exposes the upstream demo server's
`greet` tool and evaluates a local policy before forwarding each invocation.

## Policy configuration

By default, Nox looks for an optional `nox-policy.json` in the current
working directory. Set `NOX_POLICY_FILE` to use a different JSON file. An
explicitly configured file must exist and be valid; startup fails closed if
it cannot be read or parsed.

The file contains only exact tool-name rules:

```json
{
  "allow": ["greet"],
  "deny": ["dangerous-tool"],
  "approval": ["sensitive-tool"],
  "approvalTimeoutMs": 30000
}
```

Rules are evaluated in this order:

1. `NOX_DENY_TOOLS` is always a deny override.
2. A matching policy-file `deny` rule denies the call.
3. If `allow` is non-empty, tools not in `allow` are denied.
4. Otherwise, the tool is allowed.

The same tool may not appear in both `allow` and `deny`; this is a
configuration error. Unknown fields, non-string rule values, and malformed
JSON are also configuration errors. The compatibility variable
`NOX_DENY_TOOLS` is a comma-separated list, for example
`NOX_DENY_TOOLS=greet,other-tool`.

Tools in `approval` must pass policy first and then require explicit human
approval. Approval prompts are written only to stderr and read from the
controlling terminal (`/dev/tty`, or `CONIN$` on Windows), never from the MCP
protocol stdin. Enter `y` or `yes` to approve; any other response, EOF,
unavailable terminal, or timeout rejects the call. Approval prompts are
serialized, so concurrent calls cannot answer one another. The optional
`NOX_APPROVAL_INPUT_FILE` is intended only for non-interactive test harnesses.

## Commands

```sh
npm run build
npm test
npm run demo-client
NOX_DENY_TOOLS=greet npm run demo-client
```

All protocol messages use stdout. Nox diagnostics and upstream demo-handler
diagnostics use stderr.

## Audit logging

Nox appends one privacy-conscious JSONL event for every tool invocation to
`nox-audit.jsonl` in the project working directory. Set `NOX_AUDIT_FILE` to
override the path. Each event contains only:

```json
{
  "timestamp": "2026-10-27T12:00:00.000Z",
  "tool": "greet",
  "decision": "allowed",
  "outcome": "success"
}
```

Denied events have `"decision": "denied"` and `"outcome": "error"`, plus a
safe policy reason when available. Tool names and reasons are bounded and
sanitized. Arguments, results, secrets, environment-variable values, and raw
error objects or messages are never written. Approval-gated events also
contain `"approval": "approved"`, `"rejected"`, `"timed_out"`, or
`"unavailable"`.

Writes are append-only and serialized so concurrent events do not overlap.
Audit writes are asynchronous, and a filesystem failure does not stop the
gateway or turn into a false persistence claim; Nox emits a clear stderr
warning and that event may be missing from the audit file.

Run the build and all tests with:

```sh
npm run build
npm test
```