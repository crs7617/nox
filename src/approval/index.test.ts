import { describe, expect, it, vi } from "vitest";
import { ApprovalManager, type ApprovalReader } from "./index.js";

function reader(answer: string | Error | PromiseLike<string>, delay = 0): ApprovalReader {
  return {
    question: async () => {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      if (answer instanceof Error) {
        throw answer;
      }
      return await answer;
    },
    close: vi.fn(),
  };
}

describe("approval manager", () => {
  it("approves and rejects explicit terminal responses", async () => {
    const readers = [reader("yes"), reader("no")];
    const manager = new ApprovalManager(
      new Set(["sensitive"]),
      100,
      () => readers.shift(),
      vi.fn(),
    );

    expect(await manager.request("sensitive")).toBe("approved");
    expect(await manager.request("sensitive")).toBe("rejected");
  });

  it("times out without approving", async () => {
    const manager = new ApprovalManager(
      new Set(["sensitive"]),
      5,
      () => reader(new Promise<string>(() => {})),
      vi.fn(),
    );

    expect(await manager.request("sensitive")).toBe("timed_out");
  });

  it("rejects unavailable input", async () => {
    const manager = new ApprovalManager(new Set(["sensitive"]), 100, () => undefined, vi.fn());
    expect(await manager.request("sensitive")).toBe("unavailable");
  });

  it("serializes concurrent prompts", async () => {
    const order: string[] = [];
    const readers = [
      reader("yes", 10),
      reader("no", 1),
    ];
    const manager = new ApprovalManager(
      new Set(["first", "second"]),
      100,
      () => {
        order.push("prompt");
        return readers.shift();
      },
      vi.fn(),
    );

    const results = await Promise.all([
      manager.request("first"),
      manager.request("second"),
    ]);

    expect(results).toEqual(["approved", "rejected"]);
    expect(order).toEqual(["prompt", "prompt"]);
  });

  it("does not require approval for non-sensitive tools", () => {
    const manager = new ApprovalManager(new Set(["sensitive"]), 100, undefined, vi.fn());
    expect(manager.required("ordinary")).toBe(false);
    expect(manager.required("sensitive")).toBe(true);
  });
});
