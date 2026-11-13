import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* No module may reach for a macOS-only path without handling the other platform too.

   This is here because of five separate failures, all the same bug wearing different hats.
   Circuit was written on one Mac, and every tool it shells out to was looked up by a
   hard-coded /Applications, /opt/homebrew or /usr/local path. On Windows each of those lists
   misses entirely, so:

     - Codex was "not installed" while it sat in two places on disk
     - the posters and the morning briefing failed with "No Chrome or Brave on this Mac"
     - the Claude CLI was invisible, and the button that opens its sign-in did nothing,
       because it drove AppleScript
     - a headless render executed a .cmd shim directly, which Node refuses

   Each was found by accident, days apart, by somebody watching a feature fail. A list of
   paths that is right on one machine and silently wrong on another is not a bug you can find
   by reading; it is a bug you find by being the person it happens to. So it is tested instead.

   The rule is not "never name a Mac path" — a Mac path is correct on a Mac. The rule is that
   a file naming one must also know what platform it is on, so there is a branch for the other
   one. `lib/toolpath.ts` exists so most files need neither. */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/* Mac-only absolute paths, and the one Mac-only program Circuit shells out to. */
const MAC_ONLY = /\/(Applications|Library|System)\/|\/usr\/(bin|local)\/|\/opt\/homebrew|\bosascript\b|\/Volumes\//;

/* A file that checks the platform has somewhere to put the other branch. */
const PLATFORM_AWARE = /process\.platform|win32|isWin/;

/* Known gaps, named rather than hidden. These are not path lists — they are macOS programs
   with no Windows equivalent, so making them portable is work, not a lookup:
     collateral.ts — sips (resize an image) and ditto (expand an archive). sharp is already a
     dependency and could do the first; the second needs an unzip. Until then the collateral
     import is Mac-only, and says so here rather than failing quietly on somebody's Windows
     machine. */
const ALLOWED = new Map([
  ["lib/collateral.ts", "sips and ditto are macOS programs with no Windows equivalent yet"],
  ["components/views/CollateralView.tsx", "names the Mac and Windows OneDrive folders in help text; prose, not a lookup"],
]);

/* Comments are blanked, keeping newlines so reported line numbers still point at the real
   line. The explanation above names several of these paths, and a test that reports itself is
   no use to anybody. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : [];
});

function offenders() {
  const found = [];
  for (const file of walk(SRC)) {
    /* Separators normalised because the keys are written with forward slashes and
       path.relative answers in the platform's own. */
    const rel = path.relative(SRC, file).split(path.sep).join("/");
    if (ALLOWED.has(rel)) continue;
    const raw = fs.readFileSync(file, "utf8");
    if (PLATFORM_AWARE.test(raw)) continue;
    stripComments(raw).split("\n").forEach((line, i) => {
      if (MAC_ONLY.test(line)) found.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
  }
  return found;
}

test("no module reaches for a Mac-only path without handling Windows", () => {
  const found = offenders();
  assert.deepEqual(found, [],
    `use findTool() from lib/toolpath, or branch on process.platform:\n  ${found.join("\n  ")}`);
});

test("the check can see a breach", () => {
  /* The forms that actually broke, so the pattern cannot quietly stop matching them. */
  for (const sample of [
    '"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",',
    'const tool = ["/opt/homebrew/bin/pdftotext", "/usr/local/bin/pdftotext"].find(exists);',
    'await run("/usr/bin/osascript", ["-e", script]);',
  ]) assert.ok(MAC_ONLY.test(sample), `must be caught: ${sample}`);

  /* And what must not trip it: a Windows path, and a plain tool name. */
  for (const ok of [
    'path.join(process.env.APPDATA, "npm", "claude.cmd")',
    'const bin = findTool("ffmpeg");',
  ]) assert.ok(!MAC_ONLY.test(ok), `must not be caught: ${ok}`);
});

test("every allowance names a real file and says why", () => {
  for (const [rel, why] of ALLOWED) {
    assert.ok(fs.existsSync(path.join(SRC, rel)), `${rel} is allowed but no longer exists — drop the entry`);
    assert.ok(why.length > 20, `${rel} needs a reason somebody can act on`);
  }
});
