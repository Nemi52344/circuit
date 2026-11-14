import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/* Circuit talks to the Claude Code CLI already installed on this computer.
   It never handles the login itself: it reads the CLI's status and opens the CLI's own
   sign-in in a Terminal window, so the credential stays with Claude Code, not with Circuit. */

const isWin = process.platform === "win32";

/* Where the Claude Code CLI sits depends on the machine. The list was written when Circuit
   only ran on one Mac, so on Windows every entry missed and the integration could never
   connect. npm's global install leaves a .cmd shim rather than a binary, which is why the
   runner below cannot simply execute whatever this returns.

   Deliberately NOT included: the Claude desktop app (Store package, app\claude.exe). It
   answers --version and exits 0 for `auth status` and `mcp list` while printing nothing, so
   pointing at it would report a CLI that is installed, never signed in and never ready —
   a false positive that is worse than finding nothing. */
const CANDIDATES = isWin
  ? [
      path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm", "claude.cmd"),
      path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm", "claude.exe"),
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Programs", "claude", "claude.exe"),
      path.join(os.homedir(), ".local", "bin", "claude.exe"),
      path.join(os.homedir(), ".local", "bin", "claude.cmd"),
    ]
  : [
      path.join(os.homedir(), ".local/bin/claude"),
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    ];

/* Whatever is on PATH, which is where a global npm install usually lands it. */
function fromPath(): string | null {
  const exts = isWin ? (process.env.PATHEXT || ".EXE;.CMD").split(";") : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const p = path.join(dir, `claude${e.toLowerCase()}`);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}
/* The picture service Claude drives over MCP. Magnific replaced Higgsfield here: it is the
   account this office already pays for, and Freepik's own api.freepik.com/mcp now answers
   every call with "deprecated, use https://mcp.magnific.com instead". The old constant is
   kept as an alias because the settings screen still names it. */
export const IMAGE_MCP_NAME = "magnific";
export const IMAGE_MCP_URL = "https://mcp.magnific.com";
export const HIGGSFIELD_MCP_URL = IMAGE_MCP_URL;

/* Magnific's own model slugs, in the order its catalogue recommends them: `auto` picks per
   job, Nano Banana is the strongest on a real product and on photographs, Magnific One is the
   most striking, and GPT is the one to use when an ad's wording has to survive. These are MCP
   slugs: do not mix them with the ids in lib/higgsfield.ts, which is a different service. */
export const MCP_MODELS = [
  { id: "auto", label: "Decide for me (recommended)", note: "Picks the best model for each job. Start here unless a run came out wrong." },
  { id: "imagen-nano-banana-2-1", label: "Truest bike colours", note: "Best at keeping a real product looking like itself, and at photographs." },
  { id: "magnific-one", label: "Most striking", note: "Directs its own light and framing. Use when the look matters more than the detail." },
  { id: "gpt-2-6", label: "Match the ad's text", note: "Strongest with wording and layout, so it keeps an ad's text space." },
];

let cached: string | null | undefined;
export function claudePath(): string | null {
  if (cached !== undefined) return cached;
  cached = CANDIDATES.find((p) => fs.existsSync(p)) ?? fromPath() ?? null;
  return cached;
}

/* Node refuses to execute a .cmd or .bat directly (the CVE-2024-27980 fix), and that is
   exactly what a global npm install leaves on Windows. Those go through the command
   processor; a real binary is run as it always was. */
function claudeCommand(bin: string, args: string[]): [string, string[]] {
  if (isWin && /.(cmd|bat)$/i.test(bin)) return [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", bin, ...args]];
  return [bin, args];
}

async function cli(args: string[], timeout = 20000) {
  const bin = claudePath();
  if (!bin) throw new Error("The Claude Code CLI is not installed. Install it, then reconnect here.");
  try {
    const [cmd, cmdArgs] = claudeCommand(bin, args);
    const { stdout, stderr } = await run(cmd, cmdArgs, { timeout, maxBuffer: 4_000_000 });
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
/* Matches the configured picture server, and still recognises a Higgsfield entry left over
   from before the switch, so an existing setup does not read as broken after an update. */
const IMAGE_SERVER_RE = new RegExp(`${IMAGE_MCP_NAME}|higgsfie?ld`, "i");

export function higgsfieldServerName(mcpOut: string): string {
  for (const line of mcpOut.split("\n")) {
    if (!IMAGE_SERVER_RE.test(line)) continue;
    /* A server can be listed and still be unusable. Two entries for the same service is
       ordinary — one added here, one from a claude.ai connector — and picking the wrong one
       allow-lists a tool that will sit waiting for an approval nobody can give. Only a server
       that reports itself connected counts. */
    if (/✗|failed to connect|needs auth/i.test(line)) continue;
    if (!/connected/i.test(line)) continue;
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
  if (isWin) {
    /* A console the owner can see and type into: the sign-in is interactive, so it cannot be
       done for them. AppleScript was the only path here before, so on Windows this button did
       nothing at all and the sign-in could never be started from the app. */
    const child = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", '"Claude Code"', "cmd", "/k", command], {
      detached: true, stdio: "ignore", windowsVerbatimArguments: true,
    });
    child.unref();
    return;
  }
  const script = `tell application "Terminal"\n  activate\n  do script "${command.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\nend tell`;
  await run("/usr/bin/osascript", ["-e", script], { timeout: 15000 });
}

export async function addHiggsfield() {
  const bin = claudePath();
  if (!bin) throw new Error("The Claude Code CLI is not installed.");
  // Adding the server is non-interactive; authorising it is not, so the Terminal is used.
  return cli(["mcp", "add", "--transport", "http", IMAGE_MCP_NAME, IMAGE_MCP_URL], 30000);
}

export type HeadlessResult = { ok: boolean; output: string };

/* One headless Claude run per job. The prompt is built by Circuit, never by the caller. */
export async function runHeadless(prompt: string, cwd: string, allowedTools: string[] = [], timeoutMs = 300000): Promise<HeadlessResult> {
  const bin = claudePath();
  if (!bin) throw new Error("The Claude Code CLI is not installed.");
  // Without an explicit allowlist an MCP call stops and asks for approval, and a headless
  // run has nobody to answer, so it stalls until the timeout. This is that allowlist.
  const args = ["-p", prompt, "--permission-mode", "acceptEdits"];
  if (allowedTools.length) args.push("--allowedTools", allowedTools.join(" "));
  try {
    /* Same shim problem as cli(): a .cmd cannot be executed directly, so it goes through the
       command processor. Without this every render fails on Windows before Claude even starts. */
    const [cmd, cmdArgs] = claudeCommand(bin, args);
    const { stdout, stderr } = await run(cmd, cmdArgs, {
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
