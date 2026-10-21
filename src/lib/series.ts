import { getDb, newId, now } from "@/lib/db";
import { DAYS } from "@/lib/dates";

/* The posts that repeat.

   Thursday's reel, the dealer post on the first. They were typed in one at a time, and the ones
   nobody got round to were missed without anybody noticing.

   A series writes posts; it never becomes one. Everything it makes is an ordinary draft that can
   be moved, rewritten or deleted, and the series will not put it back — a calendar that restores
   what you deleted is worse than one that forgets. */

export type Cadence = "weekly" | "monthly";
export type Series = {
  id: string; name: string; platform: string; cadence: Cadence;
  weekday: number; day_of_month: number; at_time: string;
  caption: string; notes: string; active: number;
  /* The picture every draft starts with. Optional — some series are text, and refusing to save
     one without a picture would be refusing a legitimate thing. */
  file_id: string | null;
  created_at: string; updated_at: string;
  /* Filled in on read: how many posts it has made, and when the next one is due. */
  made?: number; next?: string | null;
  /* Whether this series is in a state to generate from, and what is wrong if not. Checked on
     read as well as on write, because a picture can be deleted from the library long after the
     series that points at it was set up. */
  ready?: boolean; fault?: string;
};

/* What would stop this series producing a usable draft.

   Returned rather than thrown: an unusable series should still be visible and editable, and a
   list that refuses to load because one row is wrong is worse than the wrong row. */
export function seriesFault(s: Pick<Series, "file_id" | "caption" | "platform">): string {
  if (s.file_id) {
    const f = getDb().prepare("SELECT mime FROM files WHERE id = ?").get(s.file_id) as { mime: string } | undefined;
    /* The picture was chosen and has since gone from the library. Saying so is the whole point
       of checking before generating: eight drafts pointing at a file that is not there look
       fine in the calendar and break at the moment somebody tries to post one. */
    if (!f) return "The picture chosen for this series is no longer in the library — pick another";
    if (!/^(image|video)\//.test(f.mime || "")) return "What is chosen is not a picture or a video";
  }
  if (!s.file_id && !(s.caption || "").trim()) {
    return "Nothing to start a draft from — choose a picture, write a caption, or both";
  }
  return "";
}

export { DAYS };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/* Every date this series falls on between two days, inclusive.

   A monthly series set to the 31st is the awkward case: February has no 31st, and skipping those
   months would silently drop a third of the year. It lands on the last day of the month instead,
   which is what somebody means by "the 31st" when the month is shorter. */
export function datesFor(s: Series, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const [hh, mm] = (s.at_time || "18:30").split(":").map((x) => Number(x) || 0);
  const at = (y: number, m: number, d: number) => {
    const x = new Date(y, m, d);
    x.setHours(clamp(hh, 0, 23), clamp(mm, 0, 59), 0, 0);
    return x;
  };

  if (s.cadence === "weekly") {
    const want = clamp(s.weekday, 0, 6);
    const cur = new Date(from);
    cur.setHours(0, 0, 0, 0);
    cur.setDate(cur.getDate() + ((want - cur.getDay() + 7) % 7));
    while (cur <= to) {
      out.push(at(cur.getFullYear(), cur.getMonth(), cur.getDate()));
      cur.setDate(cur.getDate() + 7);
    }
    return out;
  }

  const want = clamp(s.day_of_month, 1, 31);
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cur <= to) {
    const lastDay = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    const d = at(cur.getFullYear(), cur.getMonth(), Math.min(want, lastDay));
    if (d >= from && d <= to) out.push(d);
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

export const listSeries = (): Series[] => {
  const rows = getDb().prepare("SELECT * FROM series ORDER BY active DESC, name").all() as Series[];
  const db = getDb();
  return rows.map((s) => {
    const made = db.prepare("SELECT COUNT(*) n FROM posts WHERE series_id = ?").get(s.id) as { n: number };
    const next = db
      .prepare("SELECT scheduled_at FROM posts WHERE series_id = ? AND scheduled_at >= ? ORDER BY scheduled_at LIMIT 1")
      .get(s.id, now()) as { scheduled_at: string } | undefined;
    const fault = seriesFault(s);
    return { ...s, made: made.n, next: next?.scheduled_at || null, ready: !fault, fault };
  });
};

export function saveSeries(b: Partial<Series>): Series {
  const db = getDb();
  const t = now();
  const id = b.id || newId();
  const existing = b.id ? (db.prepare("SELECT * FROM series WHERE id = ?").get(b.id) as Series | undefined) : undefined;
  if (b.id && !existing) throw new Error("That series is not here any more");

  /* Every field falls back to what is already stored, so changing one thing means sending one
     thing. Requiring the whole row on an update makes a caller that wants to set a picture
     restate the name, the cadence and the time — and quietly lose whatever it forgot. */
  const name = (b.name ?? existing?.name ?? "").trim();
  const platform = (b.platform ?? existing?.platform ?? "").trim();
  if (!name) throw new Error("Give the series a name");
  if (!platform) throw new Error("Say which platform it goes to");

  const row: Series = {
    id,
    name,
    platform,
    cadence: b.cadence === "monthly" ? "monthly" : "weekly",
    weekday: clamp(b.weekday ?? existing?.weekday ?? 4, 0, 6),
    day_of_month: clamp(b.day_of_month ?? existing?.day_of_month ?? 1, 1, 31),
    at_time: (b.at_time || existing?.at_time || "18:30").slice(0, 5),
    caption: b.caption ?? existing?.caption ?? "",
    file_id: b.file_id === undefined ? existing?.file_id ?? null : b.file_id || null,
    notes: b.notes ?? existing?.notes ?? "",
    active: b.active === undefined ? existing?.active ?? 1 : b.active ? 1 : 0,
    created_at: existing?.created_at || t,
    updated_at: t,
  };
  /* Checked here, not only at generate time, so the mistake is caught while the person who made
     it is still looking at the form. */
  if (row.file_id && !db.prepare("SELECT 1 FROM files WHERE id = ?").get(row.file_id)) {
    throw new Error("That picture is not in the library any more");
  }
  db.prepare(`INSERT INTO series (id, name, platform, cadence, weekday, day_of_month, at_time, caption, notes, active, file_id, created_at, updated_at)
              VALUES (@id, @name, @platform, @cadence, @weekday, @day_of_month, @at_time, @caption, @notes, @active, @file_id, @created_at, @updated_at)
              ON CONFLICT(id) DO UPDATE SET name=excluded.name, platform=excluded.platform, cadence=excluded.cadence,
                weekday=excluded.weekday, day_of_month=excluded.day_of_month, at_time=excluded.at_time,
                caption=excluded.caption, notes=excluded.notes, active=excluded.active,
                file_id=excluded.file_id, updated_at=excluded.updated_at`)
    .run(row);
  return row;
}

/* Deleting a series leaves its posts alone. They are real planned work — a caption, a time,
   sometimes a picture — and taking them with it would be a delete nobody asked for. */
export function removeSeries(id: string): { deleted: string; kept: number } {
  const db = getDb();
  const kept = db.prepare("SELECT COUNT(*) n FROM posts WHERE series_id = ?").get(id) as { n: number };
  db.transaction(() => {
    db.prepare("UPDATE posts SET series_id = NULL, updated_at = ? WHERE series_id = ?").run(now(), id);
    db.prepare("DELETE FROM series WHERE id = ?").run(id);
  })();
  return { deleted: id, kept: kept.n };
}

export type Filled = {
  series: string; added: number; skipped: number; first: string | null; last: string | null;
  /* Set when nothing was written because the series is not in a fit state. */
  refused?: string;
};

/* Put the next `weeks` worth of a series on the calendar.

   Three things it will not do: write into the past, write a second post where this series
   already has one, and overwrite anything. Running it twice is therefore the same as running it
   once, which matters because the obvious thing to do with a button like this is press it
   again when you are not sure it worked. */
export function fillSeries(weeks = 8, onlyId?: string): Filled[] {
  const db = getDb();
  const all = (onlyId
    ? db.prepare("SELECT * FROM series WHERE id = ?").all(onlyId)
    : db.prepare("SELECT * FROM series WHERE active = 1").all()) as Series[];

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + weeks * 7 * 86400000);
  const t = now();
  const out: Filled[] = [];

  const insert = db.prepare(`INSERT INTO posts (id, platform, caption, file_id, creation_id, scheduled_at, status, posted_url, notes, slot_id, link_url, utm_campaign, utm_content, series_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, 'draft', '', ?, NULL, '', '', '', ?, ?, ?)`);

  for (const s of all) {
    /* Checked before anything is written. Generating eight drafts around a picture that is not
       there would put the fault eight places instead of one, and it would not surface until
       somebody tried to post one. */
    const fault = seriesFault(s);
    if (fault) {
      out.push({ series: s.name, added: 0, skipped: 0, first: null, last: null, refused: fault });
      continue;
    }
    const dates = datesFor(s, from, to);
    let added = 0;
    let skipped = 0;
    const done: string[] = [];
    db.transaction(() => {
      for (const d of dates) {
        if (d.getTime() < Date.now()) { skipped += 1; continue; }
        const dayStart = new Date(d); dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(d); dayEnd.setHours(23, 59, 59, 999);
        const clash = db
          .prepare("SELECT 1 FROM posts WHERE series_id = ? AND scheduled_at >= ? AND scheduled_at <= ? LIMIT 1")
          .get(s.id, dayStart.toISOString(), dayEnd.toISOString());
        if (clash) { skipped += 1; continue; }
        /* The picture is copied onto the draft, not referenced through the series: a draft is
           meant to be edited, and one that silently changed picture because the series was
           edited months later would be a change nobody asked for and nobody would see. */
        insert.run(newId(), s.platform, s.caption, s.file_id || null, d.toISOString(), s.notes, s.id, t, t);
        done.push(d.toISOString());
        added += 1;
      }
    })();
    out.push({ series: s.name, added, skipped, first: done[0] || null, last: done[done.length - 1] || null });
  }
  return out;
}
