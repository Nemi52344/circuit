import crypto from "node:crypto";
import { getDb, newId, now } from "@/lib/db";

/* What Circuit has learned, kept.

   Until now an agent's answer went into a run log and died there. This is the place findings
   live instead: one fact per row, with where it came from, when, and how sure the agent was.
   Everything downstream reads from here — the topic ideas, the research, the captions — so the
   app gets better at its job the longer it runs, without anyone configuring anything.

   Two rules keep it honest:
   - Nothing is stored without a source. A finding with no source_url is dropped.
   - The same fact found twice is not two facts. It is matched on a fingerprint and its
     seen_count goes up, which is also a decent signal of how real it is. */

export type Kind = "market" | "competitor" | "audience" | "policy" | "product" | "trend" | "risk";
export type Fact = {
  id: string; kind: Kind; title: string; body: string; why: string;
  source_name: string; source_url: string; dated: string; confidence: string; tags: string;
  agent: string; status: string; fingerprint: string; seen_count: number; found_at: string; updated_at: string;
};

export const KINDS: { key: Kind; label: string; note: string }[] = [
  { key: "policy", label: "Rules and subsidies", note: "FAME, PM E-DRIVE, state subsidies, road tax, safety standards" },
  { key: "competitor", label: "Competitors", note: "Launches, prices, campaigns, expansion" },
  { key: "market", label: "The market", note: "Sales numbers, category shifts, charging, batteries" },
  { key: "audience", label: "What riders say", note: "Complaints, questions, the words they use" },
  { key: "product", label: "Product and tech", note: "Batteries, motors, range, service" },
  { key: "trend", label: "What's rising", note: "Formats, hooks and topics gaining attention" },
  { key: "risk", label: "Worth watching", note: "Recalls, fires, bad press, rule changes coming" },
];

/* A fact is "the same" when its meaning words match, not when its wording does. */
function fingerprint(kind: string, title: string) {
  const words = title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !["with", "that", "this", "from", "into", "will", "have", "says", "said", "after", "before", "their", "there", "about", "more", "than", "over"].includes(w))
    .sort()
    .slice(0, 8)
    .join(" ");
  return crypto.createHash("sha1").update(`${kind}|${words}`).digest("hex").slice(0, 16);
}

export type Incoming = {
  kind?: string; title?: string; body?: string; why?: string;
  source_name?: string; source_url?: string; dated?: string; confidence?: string; tags?: string[] | string;
};

/* Stores what an agent found. Returns what was new against what was already known. */
export function remember(list: Incoming[], agent: string) {
  const db = getDb();
  const out = { added: 0, seen_again: 0, dropped: 0 };
  const find = db.prepare("SELECT id, seen_count FROM knowledge WHERE fingerprint = ? AND status != 'deleted'");
  const bump = db.prepare("UPDATE knowledge SET seen_count = seen_count + 1, updated_at = ? WHERE id = ?");
  const ins = db.prepare(`INSERT INTO knowledge (id, kind, title, body, why, source_name, source_url, dated, confidence, tags, agent, status, fingerprint, seen_count, found_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, 1, ?, ?)`);

  for (const f of list) {
    const title = (f.title || "").trim();
    const url = (f.source_url || "").trim();
    // no source, no fact: this is the rule that keeps the store trustworthy
    if (!title || !/^https?:\/\//i.test(url)) { out.dropped++; continue; }
    const kind = (KINDS.find((k) => k.key === f.kind)?.key || "market") as Kind;
    const fp = fingerprint(kind, title);
    const had = find.get(fp) as { id: string; seen_count: number } | undefined;
    if (had) { bump.run(now(), had.id); out.seen_again++; continue; }
    ins.run(
      newId(), kind, title.slice(0, 200), (f.body || "").trim().slice(0, 1200), (f.why || "").trim().slice(0, 400),
      (f.source_name || "").trim().slice(0, 80), url.slice(0, 500), (f.dated || "").slice(0, 20),
      ["high", "medium", "low"].includes(String(f.confidence)) ? String(f.confidence) : "medium",
      Array.isArray(f.tags) ? f.tags.join(", ").slice(0, 200) : String(f.tags || "").slice(0, 200),
      agent, fp, now(), now(),
    );
    out.added++;
  }
  return out;
}

export function listKnowledge(opts: { kind?: string; limit?: number; days?: number } = {}): Fact[] {
  const where = ["status = 'live'"];
  const args: unknown[] = [];
  if (opts.kind && opts.kind !== "all") { where.push("kind = ?"); args.push(opts.kind); }
  if (opts.days) { where.push("found_at >= ?"); args.push(new Date(Date.now() - opts.days * 86400000).toISOString()); }
  args.push(opts.limit || 200);
  return getDb().prepare(`SELECT * FROM knowledge WHERE ${where.join(" AND ")} ORDER BY found_at DESC LIMIT ?`).all(...args) as Fact[];
}

export function knowledgeCounts() {
  const rows = getDb().prepare("SELECT kind, COUNT(*) n FROM knowledge WHERE status = 'live' GROUP BY kind").all() as { kind: string; n: number }[];
  const total = rows.reduce((a, r) => a + r.n, 0);
  const fresh = (getDb().prepare("SELECT COUNT(*) n FROM knowledge WHERE status = 'live' AND found_at >= ?").get(new Date(Date.now() - 7 * 86400000).toISOString()) as { n: number }).n;
  return { total, fresh, by_kind: Object.fromEntries(rows.map((r) => [r.kind, r.n])) };
}

export function forgetFact(id: string) {
  getDb().prepare("UPDATE knowledge SET status = 'deleted', updated_at = ? WHERE id = ?").run(now(), id);
}

/* The short version handed to other agents and to the content pipeline: recent, confident,
   and trimmed, so a prompt carries what matters without carrying everything. */
export function knowledgeBrief(limit = 24) {
  const rows = getDb().prepare(`
    SELECT kind, title, body, why, source_name, dated, confidence, seen_count FROM knowledge
     WHERE status = 'live' AND found_at >= ?
     ORDER BY (confidence = 'high') DESC, seen_count DESC, found_at DESC LIMIT ?
  `).all(new Date(Date.now() - 60 * 86400000).toISOString(), limit) as Fact[];
  return rows.map((r) => ({
    kind: r.kind, fact: r.title, detail: (r.body || "").slice(0, 300),
    matters: r.why, source: r.source_name, dated: r.dated, confidence: r.confidence, seen: r.seen_count,
  }));
}

/* Facts nobody has seen again for a long time are not deleted, only marked, so the store
   doesn't quietly rot while still being quoted as current. */
export function ageKnowledge(days = 120) {
  const cut = new Date(Date.now() - days * 86400000).toISOString();
  const r = getDb().prepare("UPDATE knowledge SET status = 'stale', updated_at = ? WHERE status = 'live' AND updated_at < ?").run(now(), cut);
  return { staled: r.changes };
}
