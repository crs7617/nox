import { appendFile } from "node:fs/promises";

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

type Append = (path: string, data: string, encoding: "utf8") => Promise<void>;

const append = async (path: string, data: string, encoding: "utf8") => {
  await appendFile(path, data, { encoding });
};

export function sanitizeAuditValue(value: string, maxLength = 100): string {
  return value.replace(/[^\x20-\x7e]/g, "?").slice(0, maxLength);
}

export function serializeAuditEvent(event: AuditEvent): string {
  return `${JSON.stringify({
    timestamp: event.timestamp,
    tool: sanitizeAuditValue(event.tool),
    decision: event.decision,
    outcome: event.outcome,
    ...(event.approval === undefined ? {} : { approval: event.approval }),
    ...(event.reason === undefined
      ? {}
      : { reason: sanitizeAuditValue(event.reason, 200) }),
  })}\n`;
}

export class AuditLogger {
  private pending: Promise<void> = Promise.resolve();

  public constructor(
    private readonly filePath = process.env.NOX_AUDIT_FILE ?? "nox-audit.jsonl",
    private readonly appendLine: Append = append,
    private readonly warn: (message: string) => void = (message) =>
      console.error(`[NOX] Audit warning: ${message}`),
  ) {}

  public write(event: AuditEvent): Promise<boolean> {
    const line = serializeAuditEvent(event);
    const write = this.pending.then(async () => {
      try {
        await this.appendLine(this.filePath, line, "utf8");
        return true;
      } catch {
        this.warn("Could not persist audit event");
        return false;
      }
    });

    this.pending = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }
}
