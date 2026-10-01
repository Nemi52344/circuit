"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Globe } from "@/components/Globe";
import { moneyShort } from "@/lib/money";
import { fmtDate } from "@/lib/api";

/* The front door.

   Every other page in Circuit answers one question. This one answers "where are
   we", and it has to do it in the time it takes to glance — so it is one
   sentence, one set of counted numbers, and a way into each part of the place.

   The numbers are counted from the database, never rounded up for effect. If the
   month has no revenue in it, it says so rather than showing a hopeful zero. */

type Data = {
  planned: number; ahead: number; posted: number; assets: number; known: number;
  briefings: number; competitors: number;
  work: { open: number; doing: number; late: number };
  month: { revenue: number; costs: number; net: number };
  last_intel: { at: string; date: string; items: number } | null;
};

const AREAS = [
  { href: "/", label: "Calendar", line: "The month, day by day — plan it, fill it, see what each post is waiting on.", k: "planned", unit: "posts planned" },
  { href: "/slots", label: "The queue", line: "Everything in hand, how far along it is, and what needs you next.", k: "ahead", unit: "booked ahead" },
  { href: "/intel", label: "Daily intel", line: "Ten verticals swept every morning, filed, and emailed out at 09:30.", k: "briefings", unit: "briefings kept" },
  { href: "/knowledge", label: "What we know", line: "What Circuit has learned from the market, our own numbers and our posters.", k: "known", unit: "things learned" },
  { href: "/library", label: "Library", line: "Every picture and video the brand owns, named and findable.", k: "assets", unit: "files held" },
  { href: "/inspiration", label: "Inspiration", line: "What competitors published, saved as it goes out.", k: "competitors", unit: "posts saved" },
];

export default function HomePage() {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => { api<Data>("/api/home").then(setD).catch(() => setD(null)); }, []);

  const n = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString("en-IN"));

  return (
    <div className="stack home">
      <section className="hero-world">
        <div className="hw-copy">
          <span className="hw-eyebrow">BNC Motors · a division of Nemi</span>
          <h1>
            Every marketing job<br />in <em>one</em> place.
          </h1>
          <p>
            Planning, research, drafts, captions, approvals, publishing, the morning intelligence
            briefing, and the books behind all of it. One app on one Mac — nothing goes out without you.
          </p>
          <div className="actions">
            <Link className="btn primary" href="/">Open the month</Link>
            <Link className="btn" href="/slots">See what needs you</Link>
          </div>
          {d?.last_intel ? (
            <span className="hw-note">Last briefing {fmtDate(d.last_intel.at)} · {d.last_intel.items} items</span>
          ) : null}
        </div>
        <div className="hw-globe"><Globe /></div>
      </section>

      <section className="hw-strip">
        <div><strong>{n(d?.planned)}</strong><small>posts in the plan</small></div>
        <div><strong>{n(d?.work.open)}</strong><small>jobs on the board{d?.work.late ? ` · ${d.work.late} late` : ""}</small></div>
        <div><strong>{n(d?.briefings)}</strong><small>briefings archived</small></div>
        <div><strong>{n(d?.known)}</strong><small>things learned</small></div>
        <div>
          <strong>{d ? (d.month.revenue || d.month.costs ? moneyShort(d.month.net) : "—") : "—"}</strong>
          <small>{d && !d.month.revenue && !d.month.costs ? "no books this month yet" : "net this month"}</small>
        </div>
      </section>

      <section className="hw-areas">
        {AREAS.map((a) => (
          <Link key={a.href + a.label} href={a.href} className="hw-area">
            <strong>{a.label}</strong>
            <p>{a.line}</p>
            <span className="hw-count">{n(d?.[a.k as keyof Data] as number)} <i>{a.unit}</i></span>
          </Link>
        ))}
      </section>
    </div>
  );
}
