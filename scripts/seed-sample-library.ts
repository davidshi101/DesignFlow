/**
 * One-time seed: pulls a handful of real garment photos from Woman Within
 * (a Fullbeauty Brands site — the actual client behind this MVP) to give the
 * freshly-wiped libraries something to show. Each image is used twice:
 * once as a sample Garment-stage asset (for the "Previous garments" reuse
 * grid), and once as an extra CAD Fill print/pattern option — a retail site
 * only has product photography, not technical flats, so the same simple
 * on-white product shots stand in for both.
 *
 * Self-contained (no @/lib imports) so it runs standalone via `npx tsx`.
 *
 * Usage: npx tsx scripts/seed-sample-library.ts
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const IMAGES_DIR = path.join(DATA_DIR, "images", "garment");
const PRINTS_PUBLIC_DIR = path.join(process.cwd(), "public", "prints");
const ASSETS_PATH = path.join(DATA_DIR, "assets.json");
const PRINTS_PATH = path.join(DATA_DIR, "prints.json");

const SAMPLES: { label: string; url: string }[] = [
  {
    label: "Pink V-Neck Tunic",
    url: "https://www.womanwithin.com/fleximages/08255/0007_08255_mc_1515.jpg",
  },
  {
    label: "Floral Crewneck Tee",
    url: "https://www.womanwithin.com/fleximages/10771/0007_10771_mc_5280_00.jpg",
  },
  {
    label: "Purple V-Neck Tee",
    url: "https://www.womanwithin.com/fleximages/40792/0037_40792_mc_1650_00.jpg",
  },
  {
    label: "Blue Crewneck Tee",
    url: "https://www.womanwithin.com/fleximages/34649/0037_34649_mc_2925_00.jpg",
  },
  {
    label: "Knit Shirt Dress",
    url: "https://www.womanwithin.com/fleximages/30335/0005_30335_mc_1409.jpg",
  },
  {
    label: "Crewneck Tee Dress",
    url: "https://www.womanwithin.com/fleximages/00538/0005_00538_mc_4478_00.jpg",
  },
  {
    label: "Pintucked Sleeveless Dress",
    url: "https://www.womanwithin.com/fleximages/12009/0005_12009_fx_2885_0000092999.jpg",
  },
  {
    label: "V-Neck Tee Dress",
    url: "https://www.womanwithin.com/fleximages/36371/0005_36371_mc_2380.jpg",
  },
];

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

interface StoredAssetLike {
  meta?: { source?: string; label?: string };
}
interface PrintLike {
  label?: string;
}

async function main() {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  await fs.mkdir(PRINTS_PUBLIC_DIR, { recursive: true });

  const rawAssets = JSON.parse(await fs.readFile(ASSETS_PATH, "utf-8"));
  const assets: StoredAssetLike[] = Array.isArray(rawAssets) ? rawAssets : [];
  const seededLabels = new Set(
    assets
      .filter((a) => a.meta?.source === "sample-library")
      .map((a) => a.meta?.label)
  );

  const rawPrints = JSON.parse(await fs.readFile(PRINTS_PATH, "utf-8"));
  const prints: PrintLike[] = Array.isArray(rawPrints) ? rawPrints : [];
  const existingPrintLabels = new Set(prints.map((p) => p.label));

  const now = new Date().toISOString();
  let added = 0;

  for (let i = 0; i < SAMPLES.length; i++) {
    const { label, url } = SAMPLES[i];
    // Idempotent: safe to re-run without piling up duplicate entries for
    // the same sample (matched by label, since that's stable across runs
    // while ids/filenames are freshly generated each time).
    if (seededLabels.has(label) && existingPrintLabels.has(label)) {
      console.log(`  [skip] ${label} — already seeded`);
      continue;
    }
    console.log(`  [${i + 1}/${SAMPLES.length}] ${label} …`);
    const bytes = await download(url);

    if (!seededLabels.has(label)) {
      const assetId = crypto.randomUUID();
      const imagePath = path.join("images", "garment", `${assetId}.png`);
      await fs.writeFile(path.join(DATA_DIR, imagePath), bytes);
      assets.push({
        id: assetId,
        stage: "garment",
        parentId: null,
        imagePath,
        status: "approved",
        meta: { source: "sample-library", label },
        createdAt: now,
      } as unknown as StoredAssetLike);
    }

    if (!existingPrintLabels.has(label)) {
      const printId = crypto.randomUUID();
      const printFile = `ww-${i + 1}.jpg`;
      await fs.writeFile(path.join(PRINTS_PUBLIC_DIR, printFile), bytes);
      prints.push({
        id: printId,
        label,
        src: `/prints/${printFile}`,
        createdAt: now,
      } as unknown as PrintLike);
    }
    added++;
  }

  await fs.writeFile(ASSETS_PATH, JSON.stringify(assets, null, 2) + "\n", "utf-8");
  await fs.writeFile(PRINTS_PATH, JSON.stringify(prints, null, 2) + "\n", "utf-8");

  console.log(`Done: ${added} new sample(s) seeded, ${SAMPLES.length - added} already present.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
