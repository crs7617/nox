import { describe, expect, it } from "vitest";
import type { AuditEvent } from "./audit";
import { calculateMetrics, decisionBreakdown, filterEventsByRange } from "./dashboard";

const event = (timestamp: string, decision: AuditEvent["decision"], outcome: AuditEvent["outcome"]): AuditEvent => ({
  timestamp,
  tool: "filesystem.read",
  decision,
  outcome,
});

describe("dashboard calculations", () => {
  const now = Date.parse("2026-10-30T12:00:00.000Z");
  const events = [
    event("2026-10-30T11:00:00.000Z", "allowed", "success"),
    event("2026-10-29T11:00:00.000Z", "denied", "error"),
    event("2026-10-20T11:00:00.000Z", "allowed", "error"),
  ];

  it("calculates security metrics from event fields", () => {
    expect(calculateMetrics(events)).toEqual({ total: 3, allowed: 2, denied: 1, failed: 2 });
  });

  it("filters events by the selected time window", () => {
    expect(filterEventsByRange(events, "24h", now)).toHaveLength(1);
    expect(filterEventsByRange(events, "7d", now)).toHaveLength(2);
    expect(filterEventsByRange(events, "all", now)).toHaveLength(3);
  });

  it("returns decision counts for the visualization", () => {
    expect(decisionBreakdown(events)).toEqual([
      { label: "Allowed", value: 2, tone: "success" },
      { label: "Denied", value: 1, tone: "danger" },
    ]);
  });
});
