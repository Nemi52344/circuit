import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Finding a command-line tool, on whichever machine this is.

   Circuit grew up on one Mac, so every tool it shells out to was looked up as a hard-coded
   Homebrew or /usr/local path. On Windows each of those lists misses entirely and the feature
   fails with a message about a Mac — which has now happened with Codex, with Chrome for the
   posters, with the Claude CLI and with the sign-in Terminal. This is the same lookup written
   once: PATH first, because that is where an installed tool normally is on any platform, then
   the places each platform actually puts things.

   PATH is tried before the fixed lists on purpose. A person who installed ffmpeg themselves
   put it where their shell can find it, and that choice should win over a guess. */

const isWin = process.platform === "win32";

const isFile = (p: string): boolean => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

/* Whatever is on PATH, honouring PATHEXT so a .cmd or .exe is found by its bare name. */
function fromPath(name: string): string | null {
  const exts = isWin ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const e of exts) {
      const p = path.join(dir, name + e);
      if (isFile(p)) return p;
    }
  }
  return null;
}

/* The usual places, per platform, for a tool that was installed without touching PATH. */
function wellKnown(name: string): string[] {
  if (!isWin) {
    return [
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
      `/usr/bin/${name}`,
      path.join(os.homedir(), ".local", "bin", name),
    ];
  }
  const roots = [
    process.env.ProgramFiles || "C:/Program Files",
    process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)",
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm"),
    "C:/ProgramData/chocolatey/bin",
  ];
  const exts = [".exe", ".cmd", ".bat"];
  /* Both the root itself and a folder named after the tool, which is how most Windows
     installers lay a command-line program out. */
  return roots.flatMap((r) => exts.flatMap((e) => [path.join(r, name + e), path.join(r, name, "bin", name + e), path.join(r, name, name + e)]));
}

/* The tool's full path, or null when it is not installed. `name` is the bare command — pass
   "ffmpeg", never "ffmpeg.exe"; the extension is added per platform. */
export function findTool(name: string): string | null {
  return fromPath(name) || wellKnown(name).find(isFile) || null;
}

/* The first of several that is installed. For a job more than one tool can do. */
export function findAnyTool(names: string[]): string | null {
  for (const n of names) {
    const hit = findTool(n);
    if (hit) return hit;
  }
  return null;
}
