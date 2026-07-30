/**
 * One-shot: trim white margins from existing library CAD fill images in place.
 * Run: npx tsx scripts/trim-cad-whitespace.ts
 */
import { promises as fs } from "fs";
import path from "path";
import { shouldTrimCadMeta, trimWhitespace } from "../lib/trimImage";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "assets.json");

async function main() {
  const raw = JSON.parse(await fs.readFile(STORE_PATH, "utf-8"));
  const assets = Array.isArray(raw) ? raw : raw.assets ?? [];
  let trimmed = 0;
  let skipped = 0;

  for (const asset of assets) {
    if (asset.stage !== "cad" || !asset.imagePath) {
      skipped++;
      continue;
    }
    if (!shouldTrimCadMeta(asset.meta)) {
      skipped++;
      continue;
    }
    const abs = path.join(DATA_DIR, asset.imagePath);
    try {
      const before = await fs.readFile(abs);
      const after = await trimWhitespace(before);
      if (after.equals(before)) {
        console.log(`unchanged ${asset.id.slice(0, 8)} (${asset.meta?.label ?? ""})`);
        continue;
      }
      await fs.writeFile(abs, after);
      trimmed++;
      console.log(
        `trimmed ${asset.id.slice(0, 8)} (${asset.meta?.label ?? ""}) ${before.length} → ${after.length} bytes`
      );
    } catch (err) {
      console.error(`failed ${asset.id}`, err);
    }
  }

  console.log(`\nDone. Trimmed ${trimmed}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
