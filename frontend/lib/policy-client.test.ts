import { afterEach, describe, expect, it, vi } from "vitest";
import { getPolicy, savePolicy, validatePolicy } from "./policy-client";
import { emptyPolicy } from "./policy";

afterEach(() => vi.unstubAllGlobals());

describe("policy management client", () => {
  it("validates through the management API before saving", async () => {
    const policy = { ...emptyPolicy, allow: ["safe"] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true, policy })))
      .mockResolvedValueOnce(new Response(JSON.stringify(policy)));
    vi.stubGlobal("fetch", fetchMock);

    expect(await validatePolicy(policy)).toEqual(policy);
    expect(await savePolicy(policy)).toEqual(policy);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
      ["/api/management/policy/validate", "POST"],
      ["/api/management/policy", "PUT"],
    ]);
  });

  it("surfaces API errors without returning a success-shaped fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Unable to persist policy" }), { status: 503 }),
    ));
    await expect(savePolicy(emptyPolicy)).rejects.toThrow("Unable to persist policy");
  });

  it("rejects malformed policy responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      allow: [],
      deny: [],
      approval: [],
    }))));
    await expect(getPolicy()).rejects.toThrow("invalid policy timeouts");
  });
});
