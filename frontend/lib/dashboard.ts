import type { AuditEvent } from "./audit";

export type DashboardRange = "24h" | "7d" | "all";

export type DashboardMetrics = {
  total: number;
  allowed: number;
  denied: number;
  failed: number;
};

export function filterEventsByRange(
  events: AuditEvent[],
  range: DashboardRange,
  now = Date.now(),
): AuditEvent[] {
  if (range === "all") return events;
  const duration = range === "24h" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return events.filter((event) => {
    const timestamp = Date.parse(event.timestamp);
    return !Number.isNaN(timestamp) && timestamp >= now - duration && timestamp <= now;
  });
}

export function calculateMetrics(events: AuditEvent[]): DashboardMetrics {
  return events.reduce(
    (metrics, event) => ({
      total: metrics.total + 1,
      allowed: metrics.allowed + (event.decision === "allowed" ? 1 : 0),
      denied: metrics.denied + (event.decision === "denied" ? 1 : 0),
      failed: metrics.failed + (event.outcome === "error" ? 1 : 0),
    }),
    { total: 0, allowed: 0, denied: 0, failed: 0 },
  );
}

export function decisionBreakdown(events: AuditEvent[]) {
  const metrics = calculateMetrics(events);
  return [
    { label: "Allowed", value: metrics.allowed, tone: "success" },
    { label: "Denied", value: metrics.denied, tone: "danger" },
  ] as const;
}
