import { closeSync, createReadStream, existsSync, openSync, type ReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { createInterface, type Interface } from "node:readline";

export type ApprovalResult = "approved" | "rejected" | "timed_out" | "unavailable";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type PendingApproval = {
  id: string;
  toolName: string;
  upstream: string;
  createdAt: string;
  expiresAt: string;
  status: ApprovalStatus;
};

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
  private readonly requests = new Map<string, {
    metadata: PendingApproval;
    resolve: (result: ApprovalResult) => void;
    settled: boolean;
  }>();
  private closed = false;

  public constructor(
    private sensitiveTools: ReadonlySet<string>,
    private timeoutMs: number,
    private readonly getReader: () => ApprovalReader | undefined = terminalReader,
    private readonly writePrompt: (message: string) => void = (message) =>
      process.stderr.write(message),
    private readonly options: {
      managementEnabled?: boolean;
      upstream?: string;
      onDecision?: (request: PendingApproval, result: ApprovalResult) => void;
    } = {},
  ) {}

  public update(config: { approval: readonly string[]; approvalTimeoutMs: number }): void {
    this.sensitiveTools = new Set(config.approval);
    this.timeoutMs = config.approvalTimeoutMs;
  }

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

  public list(): PendingApproval[] {
    this.expireRequests();
    return [...this.requests.values()]
      .map(({ metadata }) => metadata)
      .filter((metadata) => metadata.status === "pending")
      .map((metadata) => ({ ...metadata }));
  }

  public get(id: string): PendingApproval | undefined {
    this.expireRequests();
    const request = this.requests.get(id);
    return request === undefined ? undefined : { ...request.metadata };
  }

  public resolve(id: string, decision: "approved" | "rejected"): boolean {
    this.expireRequests();
    const request = this.requests.get(id);
    if (request === undefined || request.settled || request.metadata.status !== "pending") {
      return false;
    }
    request.metadata.status = decision;
    request.settled = true;
    request.resolve(decision);
    this.options.onDecision?.({ ...request.metadata }, decision);
    return true;
  }

  public close(): void {
    this.closed = true;
    for (const request of this.requests.values()) {
      if (!request.settled) {
        request.metadata.status = "rejected";
        request.settled = true;
        request.resolve("unavailable");
      }
    }
  }

  private async runRequest(toolName: string): Promise<ApprovalResult> {
    if (this.closed) return "unavailable";
    const createdAt = new Date();
    const id = randomUUID();
    const metadata: PendingApproval = {
      id,
      toolName,
      upstream: this.options.upstream ?? "configured upstream",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.timeoutMs).toISOString(),
      status: "pending",
    };
    let timer: NodeJS.Timeout | undefined;
    let resolveDecision!: (result: ApprovalResult) => void;
    const decision = new Promise<ApprovalResult>((resolve) => {
      resolveDecision = resolve;
    });
    const request = { metadata, resolve: resolveDecision, settled: false };
    this.requests.set(id, request);
    let reader: ApprovalReader | undefined;
    try {
      reader = this.getReader();
      if (reader !== undefined) {
        this.writePrompt(`[NOX] Approve tool "${toolName}"? [y/N] `);
        const answer = await Promise.race([
          reader.question(""),
          new Promise<string>((resolve) => {
            timer = setTimeout(() => resolve("__NOX_APPROVAL_TIMEOUT__"), this.timeoutMs);
          }),
        ]);
        if (answer === "__NOX_APPROVAL_TIMEOUT__") {
          metadata.status = "expired";
          request.settled = true;
          resolveDecision("timed_out");
        } else {
          const normalized = answer.trim().toLowerCase();
          const approved = normalized === "y" || normalized === "yes";
          metadata.status = approved ? "approved" : "rejected";
          request.settled = true;
          resolveDecision(approved ? "approved" : "rejected");
        }
        return await decision;
      }
      if (!this.options.managementEnabled) {
        metadata.status = "rejected";
        request.settled = true;
        resolveDecision("unavailable");
      } else {
        timer = setTimeout(() => {
          if (!request.settled) {
            metadata.status = "expired";
            request.settled = true;
            resolveDecision("timed_out");
          }
        }, this.timeoutMs);
      }
      return await decision;
    } catch {
      if (!request.settled) {
        metadata.status = "rejected";
        request.settled = true;
        resolveDecision("unavailable");
      }
      return await decision;
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      reader?.close();
      this.requests.delete(id);
    }
  }

  private expireRequests(): void {
    if (this.closed) return;
    for (const request of this.requests.values()) {
      if (!request.settled && Date.parse(request.metadata.expiresAt) <= Date.now()) {
        request.metadata.status = "expired";
        request.settled = true;
        request.resolve("timed_out");
      }
    }
  }
}
