import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/* Who gets a piece of work, read from the real module the Inbox uses. */
const src = fs.readFileSync(new URL("../src/lib/allocate.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "alloc-")), "allocate.mjs");
fs.writeFileSync(out, js);
const a = await import(pathToFileURL(out).href);

const P = (id, name, kinds = [], takes_work = true) => ({ id, name, email: "", takes_work, kinds });
const team = [P("p", "Prasanth R", ["social_post"]), P("g", "Gowtham", ["poster", "video"]), P("m", "Marketing", [], false)];
const none = { done: {}, movedTo: {}, movedFrom: {}, open: {} };

test("the kind of work is read from the words", () => {
  assert.equal(a.guessKind("Need a Diwali poster for Instagram"), "poster");
  assert.equal(a.guessKind("edit the video from the dealer meet"), "video");
  assert.equal(a.guessKind("send the brochure print quote"), "print");
  assert.equal(a.guessKind("hello there"), "other");
});

test("work goes to whoever does that kind, and never to someone who doesn't take work", () => {
  assert.equal(a.pick("poster", team, none).choice.id, "g");
  assert.equal(a.pick("social_post", team, none).choice.id, "p");
  assert.ok(!a.rank("report", team, none).some((c) => c.id === "m"));
});

test("a manager moving work teaches it: after two moves the next one goes to the new person", () => {
  const moved = { ...none, movedTo: { p: { poster: 2 } }, movedFrom: { g: { poster: 2 } } };
  const r = a.pick("poster", team, moved);
  assert.equal(r.choice.id, "p");
  assert.match(r.reason, /given poster or graphic work by a manager 2 times/);
});

test("a person named in the message gets it", () => {
  const named = a.mentioned("Prasanth, please make the poster", team);
  assert.deepEqual(named, ["p"]);
  assert.equal(a.pick("poster", team, none, named).choice.id, "p");
});

test("with no history the work goes to whoever has least on", () => {
  const busy = { ...none, open: { p: 6, g: 1 } };
  assert.equal(a.pick("event", team, busy).choice.id, "g");
  assert.match(a.pick("event", team, busy).reason, /no history for this kind yet/);
});

test("nobody taking work is said plainly, not guessed", () => {
  const r = a.pick("poster", [P("m", "Marketing", [], false)], none);
  assert.equal(r.choice, null);
  assert.match(r.reason, /Nobody is set to take work/);
});

test("ChatGPT's answer is kept only where it makes sense", () => {
  const got = a.cleanExtraction({ tasks: [
    { title: "Design the Diwali poster", kind: "poster", due: "2026-11-01", priority: "high" },
    { title: "", kind: "video" },
    { title: "Reply to the dealer", kind: "made-up", due: "2026-01-01" },
  ] }, "2026-10-28");
  assert.equal(got.length, 2);
  assert.equal(got[0].due, "2026-11-01");
  assert.equal(got[0].priority, "high");
  assert.equal(got[1].kind, "reply");
  assert.equal(got[1].due, "");
});

test("without ChatGPT a message is still one task, urgent if it says so", () => {
  const [t] = a.fallbackExtraction("URGENT: banner for the expo stall\nsize 6x3 ft");
  assert.equal(t.title, "URGENT: banner for the expo stall");
  assert.equal(t.kind, "poster");
  assert.equal(t.priority, "high");
});

test("the parts of one job go to one person — whoever the strongest part points at", () => {
  // Booking a hall is vendor work nobody is known for; sending invites is event work Prasanth does.
  const crew = [P("p", "Prasanth R", ["social_post", "event"]), P("g", "Gowtham", ["poster", "video"])];
  const r = a.pickForJob(["vendor", "event"], crew, none);
  assert.equal(r.choice.id, "p");
  assert.match(r.reason, /does event or launch work/);
});

test("ChatGPT's job label is kept, tidied, so related tasks can be found", () => {
  const [t] = a.cleanExtraction({ tasks: [{ title: "Book the hall", kind: "vendor", job: "  Dealer Meet Coimbatore " }] }, "2026-10-28");
  assert.equal(t.job, "dealer meet coimbatore");
});

test("'Gowtham does decks, Prasanth does the rest' sorts today's list", () => {
  const crew = [P("p", "Prasanth", [a.ANY]), P("g", "Gowtham", ["deck"])];
  const to = (title) => a.pick(a.guessKind(title), crew, none).choice.name;
  assert.equal(to("My blog post"), "Prasanth");
  assert.equal(to("Evidence backup for deck"), "Gowtham");
  assert.equal(to("Battery deck"), "Gowtham");
  assert.equal(to("Upload the ESOPs and ASOPs"), "Prasanth");
  assert.equal(to("Build the Circuit platform"), "Prasanth");
  assert.equal(to("Postings for the application"), "Prasanth");
  assert.equal(to("Investor presentation for Q3"), "Gowtham");
  assert.match(a.pick("video", crew, none).reason, /does everything nobody else does/);
});

test("postings are social posts", () => {
  assert.equal(a.guessKind("Postings for the application"), "social_post");
  assert.equal(a.guessKind("Schedule this week's posts"), "social_post");
});
