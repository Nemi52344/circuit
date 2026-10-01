import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/* Circuit talks to the Claude Code CLI already installed on this Mac.
   It never handles the login itself: it reads the CLI's status and opens the CLI's own
   sign-in in a Terminal window, so the credential stays with Claude Code, not with Circuit. */

const CANDIDATES = [
  path.join(os.homedir(), ".local/bin/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
];
export const HIGGSFIELD_MCP_URL = "https://mcp.higgsfield.ai/mcp";

/* Higgsfield's MCP catalogue uses different ids from its REST API. These are the MCP ones,
   which is what a Claude run can actually call. Do not mix them with the REST model list. */
export const MCP_MODELS = [
  { id: "gpt_image_2_5", label: "Match the ad (recommended)", note: "Keeps the ad's layout and text space. About 1 credit." },
  { id: "marketing_studio_image", label: "Truest bike colours", note: "Most accurate bike, but may drop the ad's text. About 2 credits." },
  { id: "flux_2", label: "Follow my notes closely", note: "Sticks tightly to what you write in step 3." },
  { id: "grok_image_2_0", label: "Bold and punchy", note: "More dramatic, less literal." },
];

let cached: string | null | undefined;
export function claudePath(): string | null {
  if (cached !== undefined) return cached;
  cached = CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
  return cached;
}

async function cli(args: string[], timeout = 20000) {
  const bin = claudePath();
  if (!bin) throw new Error("The Claude Code CLI is not installed on this Mac");
  try {
    const { stdout, stderr } = await run(bin, args, { timeout, maxBuffer: 4_000_000 });
    return { ok: true, out: stdout || stderr || "" };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    if (err.killed) throw new Error(`claude ${args[0]} timed out`);
    return { ok: false, out: err.stdout || err.stderr || err.message || "" };
  }
}

export type ClaudeStatus = {
  installed: boolean;
  cli_path: string | null;
  version: string;
  logged_in: boolean;
  auth_method: string;
  higgsfield: boolean;
  higgsfield_server: string;
  mcp_detail: string;
  ready: boolean;
};

/* `claude mcp list` prints "<server name>: <url> - ✓ Connected". The tool prefix is that
   name with non-word characters replaced, e.g. "claude.ai Higgsfeild" -> claude_ai_Higgsfeild.
   The name is read rather than hard-coded, because Higgsfield's own listing misspells it. */
export function higgsfieldServerName(mcpOut: string): string {
  for (const line of mcpOut.split("\n")) {
    if (!/higgsfie?ld/i.test(line)) continue;
    if (/✗|failed to connect/i.test(line)) continue;
    const name = line.split(":")[0].trim();
    if (name) return `mcp__${name.replace(/[^A-Za-z0-9_]/g, "_")}`;
  }
  return "";
}

export async function claudeStatus(): Promise<ClaudeStatus> {
  const bin = claudePath();
  if (!bin) return { installed: false, cli_path: null, version: "", logged_in: false, auth_method: "none", higgsfield: false, higgsfield_server: "", mcp_detail: "", ready: false };

  const version = (await cli(["--version"]).catch(() => ({ out: "" } as { out: string }))).out.trim().split("\n")[0] || "";

  let logged_in = false;
  let auth_method = "none";
  const status = await cli(["auth", "status", "--json"]).catch(() => null);
  if (status) {
    try {
      const j = JSON.parse(status.out.trim()) as { loggedIn?: boolean; authMethod?: string };
      logged_in = Boolean(j.loggedIn);
      auth_method = j.authMethod || "none";
    } catch {
      // an unparsable answer is treated as logged out rather than guessed at
    }
  }

  // `mcp list` checks each server's health, so give it longer than the other calls.
  const mcp = await cli(["mcp", "list"], 45000).catch(() => null);
  const mcpOut = mcp?.out || "";
  const higgsfield_server = higgsfieldServerName(mcpOut);
  const higgsfield = Boolean(higgsfield_server);

  return {
    installed: true,
    cli_path: bin,
    version,
    logged_in,
    auth_method,
    higgsfield,
    higgsfield_server,
    mcp_detail: mcpOut.split("\n").filter((l) => l.trim()).slice(-6).join("\n").slice(0, 600),
    ready: logged_in && higgsfield,
  };
}

/* Sign-in and the MCP OAuth handshake are interactive, so they run in the user's own
   Terminal where they can see and approve them. Circuit never reads the credential. */
export async function openInTerminal(command: string) {
  const script = `tell application "Terminal"\n  activate\n  do script "${command.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\nend tell`;
  await run("/usr/bin/osascript", ["-e", script], { timeout: 15000 });
}

export async function addHiggsfield() {
  const bin = claudePath();
  if (!bin) throw new Error("The Claude Code CLI is not installed on this Mac");
  // Adding the server is non-interactive; authorising it is not, so the Terminal is used.
  return cli(["mcp", "add", "--transport", "http", "higgsfield", HIGGSFIELD_MCP_URL], 30000);
}

export type HeadlessResult = { ok: boolean; output: string };

/* One headless Claude run per job. The prompt is built by Circuit, never by the caller. */
export async function runHeadless(prompt: string, cwd: string, allowedTools: string[] = [], timeoutMs = 300000): Promise<HeadlessResult> {
  const bin = claudePath();
  if (!bin) throw new Error("The Claude Code CLI is not installed on this Mac");
  // Without an explicit allowlist an MCP call stops and asks for approval, and a headless
  // run has nobody to answer, so it stalls until the timeout. This is that allowlist.
  const args = ["-p", prompt, "--permission-mode", "acceptEdits"];
  if (allowedTools.length) args.push("--allowedTools", allowedTools.join(" "));
  try {
    const { stdout, stderr } = await run(bin, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 8_000_000,
      env: { ...process.env },
    });
    return { ok: true, output: (stdout || stderr || "").slice(-4000) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    if (err.killed) return { ok: false, output: "The headless Claude run produced no output and was stopped after 5 minutes. This is a known limitation: a -p run that needs both the Higgsfield MCP and shell commands stalls without reporting anything. Use the queue instead: open a Claude session and tell it to drain the Circuit render queue." };
    return { ok: false, output: (err.stdout || err.stderr || err.message || "Unknown failure").slice(-4000) };
  }
}
