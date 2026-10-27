import { closeSync, createReadStream, existsSync, openSync, type ReadStream } from "node:fs";
import { createInterface, type Interface } from "node:readline";

export type ApprovalResult = "approved" | "rejected" | "timed_out" | "unavailable";

export type ApprovalReader = {
  question(prompt: string): Promise<string>;
  close(): void;
};

function terminalReader(): ApprovalReader | undefined {
  const path =
    process.env.NOX_APPROVAL_INPUT_FILE ??
    (process.platform === "win32" ? "CONIN$" : "/dev/tty");
  if (!existsSync(path)) {
    return undefined;
  }

  let input: ReadStream;
  try {
    const descriptor = openSync(path, "r");
    closeSync(descriptor);
    input = createReadStream(path);
  } catch {
    return undefined;
  }

  let prompt: Interface | undefined;
  return {
    question(text) {
      prompt = createInterface({ input, output: process.stderr });
      return new Promise((resolve, reject) => {
        prompt?.question(text, resolve);
        input.once("error", reject);
      });
    },
    close() {
      prompt?.close();
      input.destroy();
    },
  };
}

export class ApprovalManager {
  private pending: Promise<void> = Promise.resolve();

  public constructor(
    private readonly sensitiveTools: ReadonlySet<string>,
    private readonly timeoutMs: number,
    private readonly getReader: () => ApprovalReader | undefined = terminalReader,
    private readonly writePrompt: (message: string) => void = (message) =>
      process.stderr.write(message),
  ) {}

  public required(toolName: string): boolean {
    return this.sensitiveTools.has(toolName);
  }

  public request(toolName: string): Promise<ApprovalResult> {
    const request = this.pending.then(() => this.runRequest(toolName));
    this.pending = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  }

  private async runRequest(toolName: string): Promise<ApprovalResult> {
    const reader = this.getReader();
    if (reader === undefined) {
      return "unavailable";
    }

    this.writePrompt(`[NOX] Approve tool "${toolName}"? [y/N] `);
    let timer: NodeJS.Timeout | undefined;
    try {
      const answer = await Promise.race([
        reader.question(""),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve("__NOX_APPROVAL_TIMEOUT__"), this.timeoutMs);
        }),
      ]);
      if (answer === "__NOX_APPROVAL_TIMEOUT__") {
        return "timed_out";
      }

      const normalized = answer.trim().toLowerCase();
      return normalized === "y" || normalized === "yes" ? "approved" : "rejected";
    } catch {
      return "unavailable";
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      reader.close();
    }
  }
}
