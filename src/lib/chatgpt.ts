import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/* Circuit uses the owner's own ChatGPT sign-in through OpenAI's Codex CLI (bundled with the
   ChatGPT desktop app). Circuit never sees the credential: sign-in happens in Codex's own flow
   in a Terminal window. Every run is read-only: web search and a JSON answer, no shell commands,
   no file writes, nothing saved as a session. */

const CANDIDATES = [
  "/Applications/ChatGPT.app/Contents/Resources/codex",
  path.join(os.homedir(), ".local/bin/codex"),
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
];

export function codexPath(): string | null {
  return CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

export type ChatGptStatus = { installed: boolean; path: string | null; version: string; logged_in: boolean; detail: string };

export async function chatgptStatus(): Promise<ChatGptStatus> {
  const bin = codexPath();
  if (!bin) return { installed: false, path: null, version: "", logged_in: false, detail: "Install the ChatGPT desktop app (it includes Codex) or the Codex CLI." };
  const version = await run(bin, ["--version"], { timeout: 15000 }).then((r) => r.stdout.trim()).catch(() => "");
  const status = await run(bin, ["login", "status"], { timeout: 15000 }).then((r) => `${r.stdout}${r.stderr}`.trim()).catch((e: { stdout?: string; stderr?: string }) => `${e.stdout || ""}${e.stderr || ""}`.trim());
  const logged_in = /logged in/i.test(status) && !/not logged in/i.test(status);
  return { installed: true, path: bin, version, logged_in, detail: status.split("\n")[0] || "" };
}

export async function openChatGptLogin() {
  const bin = codexPath();
  if (!bin) throw new Error("Codex isn't installed. Install the ChatGPT desktop app first.");
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

/* One read-only ChatGPT run: the prompt goes in on stdin, the final message comes back as JSON. */
export async function runChatGptJson(prompt: string, opts: { search?: boolean; timeoutMs?: number; images?: string[] } = {}): Promise<unknown> {
  const bin = codexPath();
  if (!bin) throw new Error("Codex isn't installed. Install the ChatGPT desktop app first.");
  const outFile = path.join(os.tmpdir(), `circuit-chatgpt-${process.pid}-${Date.now()}.txt`);
  const args = [
    ...(opts.search === false ? [] : ["--search"]),
    "exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "--color", "never",
    "-C", os.tmpdir(), ...(opts.images || []).flatMap((i) => ["-i", i]), "-o", outFile, "-",
  ];
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
  const log: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`ChatGPT took longer than ${Math.round(timeoutMs / 60000)} minutes`)); }, timeoutMs);
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
  if (!bin) throw new Error("Codex isn't installed. Install the ChatGPT desktop app first.");
  const outDir = path.join(os.homedir(), ".codex", "generated_images");
  const started = Date.now() - 1000;
  const args = ["exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "--color", "never", "-C", os.tmpdir(), ...imagePaths.flatMap((p) => ["-i", p]), "-"];
  const log: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
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
