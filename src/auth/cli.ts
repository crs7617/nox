import { access } from "node:fs/promises";
import { createToken, loadTokenFile, saveTokenFile } from "./index.js";

const path = process.env.NOX_AUTH_TOKEN_FILE ?? "nox-tokens.json";
const command = process.argv[2] ?? "create";

async function main(): Promise<void> {
  let tokenFile: Awaited<ReturnType<typeof loadTokenFile>>;
  try {
    await access(path);
    tokenFile = await loadTokenFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      tokenFile = { tokens: [] };
    } else {
      throw error;
    }
  }
  if (command === "create") {
    const created = createToken(process.argv[3]);
    tokenFile.tokens.push(created.record);
    await saveTokenFile(path, tokenFile);
    console.log(created.plaintext);
    return;
  }
  if (command === "revoke") {
    const id = process.argv[3];
    if (id === undefined) {
      throw new Error("Token id is required");
    }
    const token = tokenFile.tokens.find((record) => record.id === id);
    if (token === undefined) {
      throw new Error("Token id was not found");
    }
    token.revokedAt = new Date().toISOString();
    await saveTokenFile(path, tokenFile);
    return;
  }
  throw new Error("Unknown token command");
}

main().catch(() => {
  console.error("Authentication token operation failed");
  process.exitCode = 1;
});
