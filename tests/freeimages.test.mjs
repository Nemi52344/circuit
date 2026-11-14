import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

/* The picture search, with the network and the settings table replaced by canned answers.

   Wikimedia Commons appends its own tracking parameters to the address it reports for a file
   — utm_source, utm_campaign and the rest. The file-type check used to test that whole string
   for a .jpg ending, so once Commons started doing it, every single result was discarded as
   "not a picture" and the Inspiration library's free-photo half silently returned nothing.
   Nothing failed, nothing was logged; the grid was simply always empty.

   That is the case worth holding onto: an empty result is indistinguishable from "no matches"
   unless something asserts it. */

const WITH_UTM = "?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original";
const FILE = "https://upload.wikimedia.org/wikipedia/commons/d/d3/Electrocat_-_electric_motorcycle.JPG";
const PAGE = "https://commons.wikimedia.org/wiki/File:Electrocat_-_electric_motorcycle.JPG";

const LARGE2X = "https://images.pexels.com/photos/123/rider.jpeg?auto=compress&w=1880";
const ORIGINAL = "https://images.pexels.com/photos/123/rider.jpeg";

const commonsBody = () => JSON.stringify({
  query: {
    pages: {
      "123": {
        title: "File:Electrocat - electric motorcycle.JPG",
        imageinfo: [{
          url: FILE + WITH_UTM,
          thumburl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d3/Electrocat_-_electric_motorcycle.JPG/500px-Electrocat_-_electric_motorcycle.JPG" + WITH_UTM,
          descriptionurl: PAGE + WITH_UTM,
          width: 3872,
          height: 2592,
          extmetadata: {
            LicenseShortName: { value: "CC BY 3.0" },
            Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Someone">A Photographer</a>' },
          },
        }],
      },
    },
  },
});

const pexelsBody = () => JSON.stringify({
  photos: [{
    id: 123,
    width: 5000,
    height: 3333,
    url: "https://www.pexels.com/photo/rider-123/",
    alt: "Delivery rider on an electric scooter",
    photographer: "Someone Else",
    src: { original: ORIGINAL, large2x: LARGE2X, large: ORIGINAL, medium: ORIGINAL, tiny: ORIGINAL },
  }],
});

/* fetchUrl and getSetting are the only things stubbed. Openverse answers the way it does in
   the wild today; Commons and Pexels answer with real-shaped JSON. */
const load = async ({ openverse = 403, pexelsKey = "", pexelsStatus = 200 } = {}) => {
  const stub = `
const getSetting = (k) => (k === "pexels_key" ? ${JSON.stringify(pexelsKey)} : null);
const fetchUrl = async (url) => {
  if (url.includes("openverse")) return { ok: ${openverse === 200}, status: ${openverse}, buffer: Buffer.from('{"results":[]}'), contentType: "application/json", finalUrl: url };
  if (url.includes("pexels")) return { ok: ${pexelsStatus === 200}, status: ${pexelsStatus}, buffer: Buffer.from(${JSON.stringify(pexelsBody())}), contentType: "application/json", finalUrl: url };
  return { ok: true, status: 200, buffer: Buffer.from(${JSON.stringify(commonsBody())}), contentType: "application/json", finalUrl: url };
};
`;
  const src = fs.readFileSync(new URL("../src/lib/freeimages.ts", import.meta.url), "utf8")
    .replace(/\r\n/g, "\n")
    .replace('import { fetchUrl } from "@/lib/sources";\nimport { getSetting } from "@/lib/db";', stub);
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  assert.ok(!js.includes("@/lib/"), "an unstubbed import is left in — the test is not exercising the real module");
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "freeimages-")), "freeimages.mjs");
  fs.writeFileSync(out, js);
  return import(pathToFileURL(out).href);
};

test("a Commons result survives the tracking parameters on its address", async () => {
  const { searchFreeImages } = await load();
  const r = await searchFreeImages("electric motorcycle", 10);
  assert.equal(r.images.length, 1, "the picture was discarded — the file-type check is reading the query string again");
});

test("the stored address is the clean one, so the same picture is recognised later", async () => {
  const { searchFreeImages } = await load();
  const [img] = (await searchFreeImages("electric motorcycle", 10)).images;
  assert.equal(img.full, FILE);
  assert.equal(img.page, PAGE);
  assert.ok(!img.full.includes("utm_"), "a tracking parameter in the stored address breaks deduplication on re-import");
});

test("the credit and the licence come through, because reuse depends on them", async () => {
  const { searchFreeImages } = await load();
  const [img] = (await searchFreeImages("electric motorcycle", 10)).images;
  assert.equal(img.licence, "CC BY 3.0");
  assert.equal(img.creator, "A Photographer", "the markup around the artist name should be stripped");
  assert.equal(img.reuse, "credit", "CC BY is usable, but only with a credit line");
});

test("a blocked Openverse is explained, not reported as a bare status code", async () => {
  const { searchFreeImages } = await load();
  const line = (await searchFreeImages("electric motorcycle", 10)).errors.find((e) => e.startsWith("Openverse"));
  assert.ok(line, "the failure should still be surfaced, not swallowed");
  assert.ok(!/403/.test(line), `"${line}" tells the reader nothing — say what is actually wrong`);
});

test("one failing source is listed once, however many times it is tried", async () => {
  const { searchFreeImages } = await load();
  /* a phrase of more than two words is retried shortened, which asks each source twice */
  const r = await searchFreeImages("a phrase with several words", 10);
  assert.equal(r.errors.filter((e) => e.startsWith("Openverse")).length, 1, "the same failure listed twice reads like two separate faults");
});

test("Wikimedia alone still fills the grid while Openverse is unreachable", async () => {
  const { searchFreeImages } = await load();
  const r = await searchFreeImages("electric motorcycle", 10);
  assert.ok(r.images.length > 0, "one source being down must not empty the whole result");
  assert.ok(r.google.startsWith("https://www.google.com/search"), "the hand-search link is the fallback and should survive");
});

/* ---- Pexels ------------------------------------------------------------------------- */

test("Pexels is not asked at all when no key is stored", async () => {
  const { searchFreeImages } = await load({ pexelsKey: "" });
  const r = await searchFreeImages("electric motorcycle", 10);
  assert.equal(r.errors.filter((e) => e.startsWith("Pexels")).length, 0,
    "with no key the source should be skipped quietly, not fail and complain on every search");
  assert.ok(r.images.every((i) => i.source !== "Pexels"));
});

test("with a key, a Pexels photograph comes through free to reuse", async () => {
  const { searchFreeImages } = await load({ pexelsKey: "test-key" });
  const img = (await searchFreeImages("delivery rider", 10)).images.find((i) => i.source === "Pexels");
  assert.ok(img, "the photograph did not come through");
  assert.equal(img.reuse, "free", "the Pexels licence asks for no credit line, so it is free to reuse");
  assert.equal(img.creator, "Someone Else", "the photographer is recorded even though crediting is not required");
  assert.equal(img.title, "Delivery rider on an electric scooter");
});

test("a Pexels picture is taken at a sane size, not the 25 MB original", async () => {
  const { searchFreeImages } = await load({ pexelsKey: "test-key" });
  const img = (await searchFreeImages("delivery rider", 10)).images.find((i) => i.source === "Pexels");
  assert.equal(img.full, LARGE2X, "importing the original gets the fetch throttled and fills the database");
});

test("free pictures are offered before ones needing a credit line", async () => {
  const { searchFreeImages } = await load({ pexelsKey: "test-key" });
  const r = await searchFreeImages("electric motorcycle", 10);
  assert.equal(r.images[0].reuse, "free", "the ones usable without conditions should come first");
});

test("a rejected key is named as a key problem", async () => {
  const { searchFreeImages } = await load({ pexelsKey: "wrong-key", pexelsStatus: 401 });
  const line = (await searchFreeImages("electric motorcycle", 10)).errors.find((e) => e.startsWith("Pexels"));
  assert.ok(line, "a rejected key must be reported, or the grid just looks empty");
  assert.match(line, /key/i, `"${line}" should point at the key, since that is what the reader has to fix`);
});
