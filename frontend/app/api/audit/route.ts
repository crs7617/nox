import { NextResponse } from "next/server";
import { readAuditEvents } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await readAuditEvents();
  return NextResponse.json(result, {
    status: result.status === "error" ? 500 : 200,
    headers: { "cache-control": "no-store" },
  });
}
