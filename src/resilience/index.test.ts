import { describe, expect, it } from "vitest";
import { UpstreamTimeoutError, withUpstreamTimeout } from "./index.js";

describe("upstream timeout", () => {
  it("returns a completed upstream result", async () => {
    await expect(withUpstreamTimeout(Promise.resolve("ok"), 100)).resolves.toBe("ok");
  });

  it("rejects slow work with a timeout error", async () => {
    await expect(
      withUpstreamTimeout(
        new Promise<string>((resolve) => setTimeout(() => resolve("late"), 30)),
        5,
      ),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });
});
