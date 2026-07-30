/**
 * One-time migration: pulls inline base64 image data out of data/assets.json
 * into real files under data/images/{stage}/{id}.png, rewriting each asset
 * entry to carry an `imagePath` instead of the raw `imageUrl` bytes.
 *
 * Self-contained (no @/lib imports) so it runs standalone via `npx tsx`,
 * independent of Next's path-alias resolution.
 *
 * Usage: npx tsx scripts/migrate-storage.ts
 */
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const IMAGES_DIR = path.join(DATA_DIR, "images");
const STORE_PATH = path.join(DATA_DIR, "assets.json");

interface OldAsset {
  id: string;
  stage: string;
  parentId: string | null;
  imageUrl?: string | null;
  imagePath?: string | null;
  status: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

interface NewAsset {
  id: string;
  stage: string;
  parentId: string | null;
  imagePath: string | null;
  status: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

async function main() {
  const raw = await fs.readFile(STORE_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  const assets: OldAsset[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.assets)
      ? parsed.assets
      : [];

  const results: NewAsset[] = [];
  let written = 0;
  let alreadyMigrated = 0;
  let noImage = 0;

  for (const asset of assets) {
    const { imageUrl, ...rest } = asset;

    // Already migrated (has imagePath, no raw imageUrl) — pass through.
    if (!imageUrl && asset.imagePath !== undefined) {
      results.push({ ...rest, imagePath: asset.imagePath ?? null } as NewAsset);
      alreadyMigrated++;
      console.log(`  [skip]  ${asset.id} (${asset.stage}) — already migrated`);
      continue;
    }

    const match = imageUrl
      ? /^data:([^;]+);base64,([\s\S]+)$/.exec(imageUrl)
      : null;

    if (!match) {
      results.push({ ...rest, imagePath: null } as NewAsset);
      noImage++;
      console.log(`  [none]  ${asset.id} (${asset.stage}) — no image data`);
      continue;
    }

    const [, , base64] = match;
    const dir = path.join(IMAGES_DIR, asset.stage);
    await fs.mkdir(dir, { recursive: true });
    const relPath = path.join("images", asset.stage, `${asset.id}.png`);
    await fs.writeFile(path.join(DATA_DIR, relPath), Buffer.from(base64, "base64"));

    results.push({ ...rest, imagePath: relPath } as NewAsset);
    written++;
    console.log(`  [write] ${asset.id} (${asset.stage}) -> data/${relPath}`);
  }

  await fs.writeFile(STORE_PATH, JSON.stringify(results, null, 2) + "\n", "utf-8");

  console.log("\nMigration complete.");
  console.log(`  ${written} image(s) written to data/images/`);
  console.log(`  ${alreadyMigrated} asset(s) already migrated (skipped)`);
  console.log(`  ${noImage} asset(s) had no image`);
  console.log(`  ${results.length} total asset(s) in assets.json`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
