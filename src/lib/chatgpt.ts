import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/* Circuit uses the owner's own ChatGPT sign-in through OpenAI's Codex CLI (bundled with the
   ChatGPT desktop app). Circuit never sees the credential: sign-in happens in Codex's own flow
   in a Terminal window. Every run is read-only: web search and a JSON answer, no shell commands,
   no file writes, nothing saved as a session. */

const isWin = process.platform === "win32";

const isFile = (p: string): boolean => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/* Where Codex lives differs by platform, and on Windows it is usually a .cmd shim dropped by
   npm rather than a binary inside the app. Known paths are tried first because they cost
   nothing, then PATH, then the Store package, then a search inside the app directory. */
function knownPaths(): string[] {
  const home = os.homedir();
  if (!isWin) return [
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    path.join(home, ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
  const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const programs = process.env.ProgramFiles || "C:/Program Files";
  /* .exe first: a real binary can be spawned directly, a .cmd cannot. */
  const exts = [".exe", ".cmd", ".bat", ""];
  const bases = [
    path.join(local, "Programs", "ChatGPT", "resources", "codex-cli", "bin", "codex"),
    path.join(local, "Programs", "ChatGPT", "resources", "codex", "codex"),
    path.join(local, "Programs", "ChatGPT", "resources", "codex"),
    path.join(programs, "ChatGPT", "resources", "codex-cli", "bin", "codex"),
    path.join(roaming, "npm", "codex"),
    path.join(local, "Programs", "codex", "codex"),
    path.join(home, ".local", "bin", "codex"),
  ];
  return bases.flatMap((b) => exts.map((e) => b + e));
}

/* Whatever is on PATH, which is where `npm i -g @openai/codex` leaves it. */
function fromPath(): string | null {
  const exts = isWin ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const p = path.join(dir, `codex${e.toLowerCase()}`);
      if (isFile(p)) return p;
    }
  }
  return null;
}

/* A bounded search for the binary under a directory we already trust. */
function huntFor(root: string, names: string[], maxDepth: number): string | null {
  if (!fs.existsSync(root)) return null;
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop() as { dir: string; depth: number };
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && names.includes(e.name.toLowerCase())) return full;
      if (e.isDirectory() && depth < maxDepth) stack.push({ dir: full, depth: depth + 1 });
    }
  }
  return null;
}

/* The Store build of the ChatGPT app installs under C:/Program Files/WindowsApps, and that
   folder cannot be listed — reading it is EPERM even though the files inside stat and run
   perfectly well. The package's own folder is readable once its name is known, and the only
   thing that knows the name is the package manager, so ask it.

   The answer is cached because it costs the better part of a second, and it changes only when
   the app updates — at which point the cached path stops existing and we ask again. A miss is
   held briefly too, so a machine without the app does not pay for the question every time. */
/* This lookup is the answer to PATH-based discovery having failed, so it must not depend on
   PATH itself: powershell.exe does not live in System32 but in a subdirectory of it, and a
   process handed a trimmed PATH cannot resolve the bare name at all. Address it outright and
   keep the bare name only as a fallback. */
function powershellExe(): string {
  const root = process.env.SystemRoot || process.env.windir || "C:/Windows";
  const abs = path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return isFile(abs) ? abs : "powershell.exe";
}

let appxCache: { at: number; found: string | null } = { at: 0, found: null };
function fromAppx(): string | null {
  if (appxCache.found && isFile(appxCache.found)) return appxCache.found;
  if (!appxCache.found && appxCache.at && Date.now() - appxCache.at < 60_000) return null;
  let roots: string[] = [];
  try {
    const query = 'Get-AppxPackage | Where-Object { $_.Name -match "OpenAI" } | ForEach-Object { $_.InstallLocation }';
    const out = execFileSync(powershellExe(), ["-NoProfile", "-NonInteractive", "-Command", query], { timeout: 20000, windowsHide: true }).toString();
    roots = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { /* no answer from the package manager; fall through to a miss */ }
  let found: string | null = null;
  for (const root of roots) {
    const direct = path.join(root, "app", "resources", "codex.exe");
    if (isFile(direct)) { found = direct; break; }
    const hunted = huntFor(path.join(root, "app"), ["codex.exe"], 3);
    if (hunted) { found = hunted; break; }
  }
  appxCache = { at: Date.now(), found };
  return found;
}

/* The ChatGPT app has moved this binary once already — an update shifted it from
   Resources/codex to Resources/codex-cli/bin/codex, and every drafted caption, researched
   topic and swept briefing stopped working until somebody noticed. So rather than trusting a
   list of paths to stay true, the app directory is searched a couple of levels deep as a last
   resort. The known paths are still tried first because they cost nothing. */
function huntInsideApp(): string | null {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const programs = process.env.ProgramFiles || "C:/Program Files";
  const roots = isWin
    ? [path.join(local, "Programs", "ChatGPT", "resources"), path.join(programs, "ChatGPT", "resources")]
    : ["/Applications/ChatGPT.app/Contents/Resources"];
  const names = isWin ? ["codex.exe", "codex.cmd", "codex.bat"] : ["codex"];
  for (const root of roots) {
    const hit = huntFor(root, names, 3);
    if (hit) return hit;
  }
  return null;
}

export function codexPath(): string | null {
  const known = knownPaths().find(isFile);
  if (known) return known;
  const onPath = fromPath();
  if (onPath) return onPath;
  if (isWin) {
    const appx = fromAppx();
    if (appx) return appx;
  }
  return huntInsideApp();
}

/* Node refuses to execute a .cmd or .bat shim directly (the CVE-2024-27980 fix), and that is
   exactly what npm leaves behind on Windows. Those go through the command processor; a real
   binary is run as it always was. */
function codexCommand(bin: string, args: string[]): [string, string[]] {
  if (isWin && /\.(cmd|bat)$/i.test(bin)) return [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", bin, ...args]];
  return [bin, args];
}

const INSTALL_HINT = isWin
  ? "Install the ChatGPT desktop app from the Microsoft Store, or the Codex CLI (npm i -g @openai/codex)."
  : "Install the ChatGPT desktop app (it includes Codex) or the Codex CLI.";

export type ChatGptStatus = { installed: boolean; path: string | null; version: string; logged_in: boolean; detail: string };

export async function chatgptStatus(): Promise<ChatGptStatus> {
  const bin = codexPath();
  if (!bin) return { installed: false, path: null, version: "", logged_in: false, detail: INSTALL_HINT };
  const ask = (args: string[]) => run(...codexCommand(bin, args), { timeout: 15000 });
  const version = await ask(["--version"]).then((r) => r.stdout.trim()).catch(() => "");
  const status = await ask(["login", "status"]).then((r) => `${r.stdout}${r.stderr}`.trim()).catch((e: { stdout?: string; stderr?: string }) => `${e.stdout || ""}${e.stderr || ""}`.trim());
  const logged_in = /logged in/i.test(status) && !/not logged in/i.test(status);
  return { installed: true, path: bin, version, logged_in, detail: status.split("\n")[0] || "" };
}

export async function openChatGptLogin() {
  const bin = codexPath();
  if (!bin) throw new Error(INSTALL_HINT);
  if (isWin) {
    /* A console window the owner can see and type into, same as the Terminal window on a Mac.
       Circuit never handles the credential either way. */
    const child = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", `"Codex sign-in"`, "cmd", "/k", `"${bin}" login`], {
      detached: true, stdio: "ignore", windowsVerbatimArguments: true,
    });
    child.unref();
    return;
  }
  const command = `'${bin}' login`;
  const script = `tell application "Terminal"\n  activate\n  do script "${command.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"\nend tell`;
  await run("/usr/bin/osascript", ["-e", script], { timeout: 15000 });
}
/* Pulls the JSON answer out of the model's last message, tolerating a code fence around it. */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.search(/[[{]/);
  if (start < 0) throw new Error("ChatGPT didn't return JSON");
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  const end = t.lastIndexOf(close);
  if (end <= start) throw new Error("ChatGPT's answer was cut off");
  return JSON.parse(t.slice(start, end + 1));
}

/* A run that ran out of time, as opposed to one that failed. Worth telling apart: a run that
   hung is worth trying again, and a run that could not sign in is not. */
class ChatGptTimeout extends Error {
  readonly timedOut = true;
  constructor(ms: number) { super(`ChatGPT took longer than ${Math.round(ms / 60000)} minutes`); this.name = "ChatGptTimeout"; }
}
const timedOut = (e: unknown): boolean => e instanceof ChatGptTimeout;

/* One read-only ChatGPT run: the prompt goes in on stdin, the final message comes back as JSON.

   A run that overruns is given one more go with half again as long. These calls are a single
   shot at a model that occasionally stalls on a search, and the old behaviour — fail, mark the
   job failed, never look at it again — is what left six morning briefings and three learning
   runs dead in the history with nothing to show for them. Only a timeout is retried: a run
   that exited because nobody is signed in will exit the same way the second time. */
export async function runChatGptJson(prompt: string, opts: { search?: boolean; timeoutMs?: number; images?: string[]; retryOnTimeout?: boolean } = {}): Promise<unknown> {
  const first = opts.timeoutMs ?? 15 * 60 * 1000;
  try {
    return await chatGptJsonOnce(prompt, opts, first);
  } catch (e) {
    if (!timedOut(e) || opts.retryOnTimeout === false) throw e;
    const second = Math.round(first * 1.5);
    console.warn(`[circuit] ChatGPT overran ${Math.round(first / 60000)} minutes — one more attempt at ${Math.round(second / 60000)}.`);
    return await chatGptJsonOnce(prompt, opts, second);
  }
}

async function chatGptJsonOnce(prompt: string, opts: { search?: boolean; images?: string[] }, timeoutMs: number): Promise<unknown> {
  const bin = codexPath();
  if (!bin) throw new Error(`Codex isn't installed. ${INSTALL_HINT}`);
  const outFile = path.join(os.tmpdir(), `circuit-chatgpt-${process.pid}-${Date.now()}.txt`);
  const args = [
    ...(opts.search === false ? [] : ["--search"]),
    "exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "--color", "never",
    "-C", os.tmpdir(), ...(opts.images || []).flatMap((i) => ["-i", i]), "-o", outFile, "-",
  ];
  const log: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const [cmd, cmdArgs] = codexCommand(bin, args);
    const child = spawn(cmd, cmdArgs, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new ChatGptTimeout(timeoutMs)); }, timeoutMs);
    const keep = (b: Buffer) => { log.push(b.toString()); if (log.length > 200) log.splice(0, 100); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ChatGPT run failed (exit ${code}): ${log.join("").slice(-400).trim()}`));
    });
    child.stdin.end(prompt);
  });
  let text = "";
  try { text = fs.readFileSync(outFile, "utf8"); } finally { fs.rmSync(outFile, { force: true }); }
  if (!text.trim()) throw new Error(`ChatGPT returned nothing: ${log.join("").slice(-300).trim()}`);
  if (/not logged in|please (log|sign) in|401/i.test(log.join("")) && !text.includes("{")) throw new Error("ChatGPT isn't signed in. Use Sign in with ChatGPT in Settings.");
  return extractJson(text);
}

/* One ChatGPT image: references attached, Codex's own image tool draws it, still read-only.
   Codex saves generated images under ~/.codex/generated_images; the newest one made during
   this run is the result. */
export async function runChatGptImage(prompt: string, imagePaths: string[], timeoutMs = 10 * 60 * 1000): Promise<string> {
  const bin = codexPath();
  if (!bin) throw new Error(`Codex isn't installed. ${INSTALL_HINT}`);
  const outDir = path.join(os.homedir(), ".codex", "generated_images");
  const started = Date.now() - 1000;
  const args = ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "--color", "never", "-C", os.tmpdir(), ...imagePaths.flatMap((p) => ["-i", p]), "-"];
  const log: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const [cmd, cmdArgs] = codexCommand(bin, args);
    const child = spawn(cmd, cmdArgs, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`ChatGPT took longer than ${Math.round(timeoutMs / 60000)} minutes`)); }, timeoutMs);
    const keep = (b: Buffer) => { log.push(b.toString()); if (log.length > 200) log.splice(0, 100); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`ChatGPT image run failed (exit ${code}): ${log.join("").slice(-400).trim()}`)); });
    child.stdin.end(`${prompt}\n\nUse your image generation tool to create exactly one image. It must be a finished, full-bleed photo that fills the whole frame with an opaque background: no transparency, no cutout, no vignette shape, no border. Do not write files yourself and do not run commands other than reading the image generation skill. When the image is created, reply with one short line.`);
  });
  const found: { file: string; mtime: number }[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (/\.(png|jpe?g|webp)$/i.test(e.name)) {
        const m = fs.statSync(p).mtimeMs;
        if (m >= started) found.push({ file: p, mtime: m });
      }
    }
  };
  walk(outDir, 0);
  const newest = found.sort((a, b) => b.mtime - a.mtime)[0];
  if (!newest) throw new Error(`ChatGPT finished without an image. ${log.join("").slice(-300).trim()}`);
  return newest.file;
}
