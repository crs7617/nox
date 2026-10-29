import { readFile } from "node:fs/promises";
import path from "node:path";

export type AuditDecision = "allowed" | "denied";
export type AuditOutcome = "success" | "error";
export type AuditApproval = "approved" | "rejected" | "timed_out" | "unavailable";

export type AuditEvent = {
  timestamp: string;
  tool: string;
  decision: AuditDecision;
  outcome: AuditOutcome;
  approval?: AuditApproval;
  reason?: string;
};

export type AuditResult =
  | { status: "ready"; events: AuditEvent[]; source: string }
  | { status: "not-configured"; message: string }
  | { status: "error"; message: string };

function isAuditEvent(value: unknown): value is AuditEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.timestamp === "string" &&
    typeof event.tool === "string" &&
    (event.decision === "allowed" || event.decision === "denied") &&
    (event.outcome === "success" || event.outcome === "error") &&
    (event.approval === undefined ||
      ["approved", "rejected", "timed_out", "unavailable"].includes(String(event.approval))) &&
    (event.reason === undefined || typeof event.reason === "string")
  );
}

export async function readAuditEvents(): Promise<AuditResult> {
  const configuredPath = process.env.NOX_AUDIT_FILE;
  if (!configuredPath || configuredPath.trim() === "") {
    return {
      status: "not-configured",
      message: "Set NOX_AUDIT_FILE to the sanitized JSONL audit file to connect this explorer.",
    };
  }

  const source = path.basename(configuredPath);
  try {
    const contents = await readFile(configuredPath, "utf8");
    const events = contents
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed: unknown = JSON.parse(line);
          return isAuditEvent(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      })
      .slice(-500)
      .reverse();

    return { status: "ready", events, source };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        status: "not-configured",
        message: `The configured audit file ${source} does not exist yet.`,
      };
    }
    return {
      status: "error",
      message: "The audit file could not be read. Check the frontend process permissions.",
    };
  }
}
