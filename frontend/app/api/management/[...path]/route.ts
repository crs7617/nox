import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

function managementUrl(path: string[]): string | undefined {
  const base = process.env.NOX_MANAGEMENT_URL?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/$/, "")}/${path.join("/")}`;
}

async function proxy(request: Request, context: RouteContext): Promise<NextResponse> {
  const path = (await context.params).path;
  const requestedPath = `/${path.join("/")}`;
  if (!["/health", "/tools", "/policy", "/policy/validate", "/approvals", "/upstreams", "/upstreams/test"].includes(requestedPath)
    && !/^\/approvals\/[^/]+(?:\/(?:approve|reject))?$/u.test(requestedPath)
    && !/^\/upstreams\/[^/]+$/u.test(requestedPath)) {
    return NextResponse.json(
      { error: "not_found", message: "Not found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  const url = managementUrl(path);
  const token = process.env.NOX_MANAGEMENT_TOKEN?.trim();
  if (!url || !token) {
    return NextResponse.json(
      { error: "management_not_configured", message: "Configure the Nox management connection." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const body = request.method === "GET" ? undefined : await request.text();
  try {
    const response = await fetch(url, {
      method: request.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body,
      cache: "no-store",
    });
    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "management_unavailable", message: "The management API could not be reached." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxy(request, context);
}
