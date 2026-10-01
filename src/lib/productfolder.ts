import fs from "node:fs";
import path from "node:path";
import { getDb, getSetting, newId, now, saveFileBuffer, DATA_DIR } from "@/lib/db";

/* The product root folder: the owner drops real product photos here and they become the bike
   photos every draft is built from. A subfolder name is the product name ("Challenger 110"),
   a file name can carry the colour ("olive-side.png"). Files already brought in are skipped. */

export const DEFAULT_PRODUCT_ROOT = path.join(DATA_DIR, "product");
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const COLOURS = ["olive", "green", "black", "white", "grey", "gray", "red", "blue", "yellow", "silver", "orange", "purple", "brown"];

export function productRoot() {
  return getSetting("product_root") || DEFAULT_PRODUCT_ROOT;
}

export function syncProductFolder() {
  const root = productRoot();
  if (root === DEFAULT_PRODUCT_ROOT && !fs.existsSync(root)) {
    fs.mkdirSync(path.join(root, "Challenger 110"), { recursive: true });
    fs.writeFileSync(path.join(root, "README.txt"), "Circuit product root folder.\n\nMake one folder per product (for example \"Challenger 110\") and put clean product photos inside: side, three-quarter, front. Put the colour in the file name (olive-side.png).\nCircuit adds new photos automatically; they become the bike photos drafts are built from.\n");
  }
  if (!fs.existsSync(root)) return { root, exists: false, added: 0, total: 0 };
  const db = getDb();
  const known = new Set((db.prepare("SELECT source_path FROM products WHERE source_path != ''").all() as { source_path: string }[]).map((r) => r.source_path));
  const found: { file: string; product: string }[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      for (const f of fs.readdirSync(p)) if (IMAGE_EXT.test(f) && !f.startsWith(".")) found.push({ file: path.join(p, f), product: e.name });
    } else if (IMAGE_EXT.test(e.name)) {
      found.push({ file: p, product: e.name.replace(IMAGE_EXT, "").replace(/[-_]+/g, " ") });
    }
  }
  let added = 0;
  const ins = db.prepare("INSERT INTO products (id, name, color, tags, file_id, source_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const f of found) {
    if (known.has(f.file)) continue;
    const base = path.basename(f.file);
    const ext = (base.split(".").pop() || "").toLowerCase();
    const buf = fs.readFileSync(f.file);
    if (buf.length > 25_000_000) continue;
    const saved = saveFileBuffer(buf, base, MIME[ext] || "image/png", "product");
    const lower = base.toLowerCase();
    const color = COLOURS.find((c) => lower.includes(c)) || "";
    ins.run(newId(), f.product, color ? color[0].toUpperCase() + color.slice(1) : "", `folder ${base.replace(IMAGE_EXT, "").replace(/[-_]+/g, " ")}`, saved.id, f.file, now());
    added++;
  }
  return { root, exists: true, added, total: found.length };
}
