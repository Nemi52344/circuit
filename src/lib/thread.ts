import { getDb, newId, now } from "@/lib/db";

/* What was said about a picture, and which pictures it came from.

   Both halves answer the same question — why does this one look like this — from opposite
   ends. The notes are what people said; the chain is what the machine did. */

export type Note = { id: string; creation_id: string; author: string; body: string; created_at: string };

export type Version = {
  id: string; title: string; status: string; file_id: string;
  created_at: string; parent_id: string | null;
  /* Where it sits in the chain: the root is 1, its children 2, and three attempts at the same
     stage are all 2. Counted by walking down from the root rather than read off the `round`
     column, which is the render pipeline's own counter — it starts at 1 for the first
     iteration, so trusting it labelled the original of every chain "v2". */
  step: number;
  /* The raw counter, kept because it is what the pipeline recorded. */
  round: number;
  /* How many notes sit on this version, so a chain can show where the argument happened. */
  notes: number;
  current: boolean;
};

export const notesFor = (creationId: string): Note[] =>
  getDb().prepare("SELECT * FROM creation_notes WHERE creation_id = ? ORDER BY created_at").all(creationId) as Note[];

export function addNote(creationId: string, body: string, author: string): Note {
  const text = body.trim();
  /* An empty note is not a note. Refused here rather than stored and shown as a blank line
     somebody later has to work out the meaning of. */
  if (!text) throw new Error("Write the note before saving it");
  if (!getDb().prepare("SELECT 1 FROM creations WHERE id = ?").get(creationId)) throw new Error("That creation is not here any more");
  const note: Note = { id: newId(), creation_id: creationId, author: author || "", body: text, created_at: now() };
  getDb()
    .prepare("INSERT INTO creation_notes (id, creation_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(note.id, note.creation_id, note.author, note.body, note.created_at);
  return note;
}

export const removeNote = (id: string): number =>
  getDb().prepare("DELETE FROM creation_notes WHERE id = ?").run(id).changes;

/* Every version in the same family as this one, oldest first.

   Walking up to the root first, then down, rather than listing siblings: a chain that showed
   only the pictures beside this one would hide the original it was all an attempt at. The
   climb is capped because a parent_id loop would otherwise hang the request — it should not
   be possible, and a cap costs nothing against finding out that it was. */
export function chainOf(creationId: string): Version[] {
  const db = getDb();
  type Row = { id: string; parent_id: string | null };
  let rootId = creationId;
  const seen = new Set<string>([creationId]);
  for (let hop = 0; hop < 50; hop += 1) {
    const r = db.prepare("SELECT id, parent_id FROM creations WHERE id = ?").get(rootId) as Row | undefined;
    if (!r?.parent_id || seen.has(r.parent_id)) break;
    seen.add(r.parent_id);
    rootId = r.parent_id;
  }

  const family: Version[] = [];
  let edge = [rootId];
  const have = new Set<string>();
  for (let depth = 0; depth < 50 && edge.length; depth += 1) {
    const rows = db
      .prepare(`SELECT c.id, COALESCE(c.title,'') title, COALESCE(c.round,0) round, c.status, c.file_id,
                       c.created_at, c.parent_id,
                       (SELECT COUNT(*) FROM creation_notes n WHERE n.creation_id = c.id) notes
                FROM creations c WHERE c.id IN (${edge.map(() => "?").join(",")})
                ORDER BY c.round, c.created_at`)
      .all(...edge) as Omit<Version, "current" | "step">[];
    for (const r of rows) {
      if (have.has(r.id)) continue;
      have.add(r.id);
      family.push({ ...r, step: depth + 1, current: r.id === creationId });
    }
    const kids = db
      .prepare(`SELECT id FROM creations WHERE parent_id IN (${edge.map(() => "?").join(",")}) ORDER BY round, created_at`)
      .all(...edge) as { id: string }[];
    edge = kids.map((k) => k.id).filter((id) => !have.has(id));
  }
  /* One picture on its own is not a chain, and calling it "v1 of 1" would be noise. */
  return family.length > 1 ? family : [];
}
