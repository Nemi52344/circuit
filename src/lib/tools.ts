import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getSetting } from "@/lib/db";

/* What this Mac can actually do, as opposed to what Circuit does itself.

   The agents in Circuit are one thing; the skills sitting in the Claude folder and the servers
   wired into ChatGPT are another, and until now there was nowhere that said what any of them
   were. They are read off the disk every time rather than kept in the database: they change
   when a folder changes, and a stored copy would quietly describe a machine that no longer
   exists. */

export type Skill = {
  name: string;
  what: string;
  group: string;
  where: string;
  source: "Claude";
};

export type Server = {
  name: string;
  what: string;
  command: string;
  enabled: boolean;
  source: "ChatGPT";
};

export type Toolbox = {
  skills: Skill[];
  servers: Server[];
  /* Which folders were looked in, and what was found in each. Printed on the page, because a
     list of skills that is quietly missing a folder looks exactly like a folder with no skills
     in it. */
  roots: { path: string; exists: boolean; found: number }[];
  model: string;
  notes: string[];
};

const home = os.homedir();

/* Where skills live. The first two are where Claude Code keeps them; the third is the agency
   folder this Mac happens to have, included when it is there and silently skipped when it is
   not. More can be added in Settings. */
const defaultRoots = (): string[] => [
  path.join(home, ".claude", "skills"),
  path.join(process.cwd(), ".claude", "skills"),
  path.join(home, "Marketing Suite", "skills"),
];

const extraRoots = (): string[] => {
  try {
    const raw = getSetting("skill_folders") || "";
    return raw.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
};

/* The name and the one-line description out of a SKILL.md front matter block.

   Parsed rather than imported: these files are YAML headers on a Markdown body, the description
   routinely runs to a paragraph with colons and quotes in it, and a real YAML parser would be a
   dependency added to read two fields. Everything up to the closing --- is scanned, and a value
   that wraps onto the next line is joined back on. */
function readSkill(file: string): { name: string; what: string } | null {
  let text: string;
  try { text = fs.readFileSync(file, "utf8").slice(0, 8000); } catch { return null; }
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  const head = end === -1 ? text : text.slice(0, end);

  const field = (key: string): string => {
    const lines = head.split("\n");
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (i === -1) return "";
    let v = lines[i].slice(key.length + 1).trim();
    /* A folded value continues on the following indented lines until the next key. */
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^[a-zA-Z_-]+:/.test(lines[j]) || lines[j].startsWith("---")) break;
      v += ` ${lines[j].trim()}`;
    }
    return v.replace(/^["']|["']$/g, "").trim();
  };

  const name = field("name") || path.basename(path.dirname(file));
  return { name, what: field("description") };
}

/* One sentence out of a description that is often a whole paragraph of trigger words. */
const firstSentence = (s: string, max = 190): string => {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const stop = t.search(/\.\s|\. $|\.$/);
  const one = stop > 30 ? t.slice(0, stop + 1) : t;
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

function scan(root: string): Skill[] {
  const out: Skill[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (e.name !== "SKILL.md") continue;
      const read = readSkill(p);
      if (!read?.name) continue;
      /* The folder above the skill is its group when there is one — the agency folder sorts its
         skills into paid-media, organic-growth and so on, and that grouping is worth keeping. */
      const parent = path.basename(path.dirname(path.dirname(p)));
      const group = path.dirname(path.dirname(p)) === root ? "" : parent;
      out.push({ name: read.name, what: firstSentence(read.what), group, where: path.dirname(p), source: "Claude" });
    }
  };
  walk(root, 0);
  return out;
}

/* The servers ChatGPT is wired into, read from the Codex config.

   ChatGPT has no skills in the sense Claude does; what it has is this list. Mapping one onto
   the other rather than leaving the column blank, and labelled for what it is. */
function codex(): { servers: Server[]; model: string; found: boolean } {
  const file = path.join(home, ".codex", "config.toml");
  let text: string;
  try { text = fs.readFileSync(file, "utf8"); } catch { return { servers: [], model: "", found: false }; }

  const servers: Server[] = [];
  const re = /\[mcp_servers\.([A-Za-z0-9_-]+)\]([\s\S]*?)(?=\n\[|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const body = m[2];
    const get = (k: string) => (body.match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, "m")) || [])[1] || "";
    const enabled = !/^enabled\s*=\s*false/m.test(body);
    const cmd = get("command");
    servers.push({
      name: m[1],
      what: cmd ? path.basename(cmd) : "",
      command: cmd,
      enabled,
      source: "ChatGPT",
    });
  }
  const model = (text.match(/^model\s*=\s*"([^"]*)"/m) || [])[1] || "";
  return { servers, model, found: true };
}

export function toolbox(): Toolbox {
  const roots: Toolbox["roots"] = [];
  const skills: Skill[] = [];
  const seen = new Set<string>();

  for (const root of [...defaultRoots(), ...extraRoots()]) {
    const exists = fs.existsSync(root);
    const found = exists ? scan(root) : [];
    /* The same skill reachable through two roots is one skill, not two. */
    const fresh = found.filter((s) => !seen.has(s.name));
    for (const s of fresh) seen.add(s.name);
    skills.push(...fresh);
    roots.push({ path: root.replace(home, "~"), exists, found: fresh.length });
  }

  const cx = codex();
  const notes: string[] = [];
  if (!skills.length) notes.push("No skills found. Claude Code keeps them in ~/.claude/skills — add other folders under Settings if yours live elsewhere.");
  if (!cx.found) notes.push("ChatGPT's own config was not found at ~/.codex/config.toml, so nothing is listed for it.");
  else if (!cx.servers.length) notes.push("ChatGPT is set up but has no servers wired into it.");
  /* Said plainly, because the two columns are not the same kind of thing and the page should
     not imply that they are. */
  notes.push("Claude works from skills — folders of instructions. ChatGPT works from servers it can call. They are listed side by side because both run on this Mac, not because they are the same thing.");

  return {
    skills: skills.sort((a, b) => (a.group || "~").localeCompare(b.group || "~") || a.name.localeCompare(b.name)),
    servers: cx.servers.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name)),
    roots,
    model: cx.model,
    notes,
  };
}
