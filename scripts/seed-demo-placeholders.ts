/**
 * Seeds approved library placeholders for Sketch + Minibody Memory Bank
 * density, plus one linked demo pipeline chain for the Resume closer shot.
 *
 * Sketches: greyscale conversions of approved garment photos via `sips`.
 * Minibodies: copies of approved CAD fills (stand-in product renders).
 * Demo chain: garment → sketch → cad → minibody (real parentId links).
 *
 * Idempotent: skips if meta.source library-placeholder / demo-pipeline
 * assets already exist.
 *
 * Usage: npx tsx scripts/seed-demo-placeholders.ts
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";

const DATA_DIR = path.join(process.cwd(), "data");
const ASSETS_PATH = path.join(DATA_DIR, "assets.json");

interface StoredAsset {
  id: string;
  stage: string;
  parentId: string | null;
  imagePath: string | null;
  status: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

function uuid(): string {
  return crypto.randomUUID();
}

async function readAssets(): Promise<StoredAsset[]> {
  const raw = JSON.parse(await fs.readFile(ASSETS_PATH, "utf-8"));
  return Array.isArray(raw) ? raw : [];
}

async function writeAssets(assets: StoredAsset[]): Promise<void> {
  await fs.writeFile(ASSETS_PATH, JSON.stringify(assets, null, 2) + "\n", "utf-8");
}

async function ensureDir(stage: string): Promise<void> {
  await fs.mkdir(path.join(DATA_DIR, "images", stage), { recursive: true });
}

function absImage(rel: string): string {
  return path.join(DATA_DIR, rel);
}

/** Greyscale PNG copy via macOS sips — stand-in line sketch. */
function writeGreyscaleSketch(srcAbs: string, destAbs: string): void {
  execFileSync(
    "sips",
    ["-s", "format", "png", "-s", "formatOptions", "default", srcAbs, "--out", destAbs],
    { stdio: "pipe" }
  );
  try {
    execFileSync("sips", ["-g", "hasAlpha", destAbs], { stdio: "pipe" });
    // Approximate a flat sketch look: bump contrast / desaturate if available
    execFileSync(
      "sips",
      ["--matchTo", "/System/Library/ColorSync/Profiles/Generic Gray Profile.icc", destAbs],
      { stdio: "pipe" }
    );
  } catch {
    // Greyscale profile match is best-effort; PNG copy alone is fine for demo.
  }
}

async function copyFile(srcAbs: string, destAbs: string): Promise<void> {
  await fs.copyFile(srcAbs, destAbs);
}

async function main() {
  let assets = await readAssets();
  await ensureDir("sketch");
  await ensureDir("minibody");
  await ensureDir("cad");

  const existingPlaceholder = assets.some(
    (a) => a.meta?.source === "library-placeholder"
  );
  const existingDemo = assets.some((a) => a.meta?.source === "demo-pipeline");

  const garments = assets.filter(
    (a) => a.stage === "garment" && a.status === "approved" && a.imagePath
  );
  const cads = assets.filter(
    (a) => a.stage === "cad" && a.status === "approved" && a.imagePath
  );

  if (!existingPlaceholder) {
    const sketchSources = garments.slice(0, 4);
    const minibodySources = cads.slice(0, 4);

    if (sketchSources.length < 4) {
      throw new Error(
        `Need 4 approved garments with images; found ${sketchSources.length}`
      );
    }
    if (minibodySources.length < 4) {
      throw new Error(
        `Need 4 approved CADs with images; found ${minibodySources.length}`
      );
    }

    for (let i = 0; i < 4; i++) {
      const g = sketchSources[i];
      const id = uuid();
      const rel = path.join("images", "sketch", `${id}.png`);
      const label =
        typeof g.meta?.label === "string"
          ? `${g.meta.label} sketch`
          : `Sample sketch ${i + 1}`;
      writeGreyscaleSketch(absImage(g.imagePath!), absImage(rel));
      assets.push({
        id,
        stage: "sketch",
        parentId: null,
        imagePath: rel,
        status: "approved",
        meta: { source: "library-placeholder", label },
        createdAt: new Date().toISOString(),
      });
      console.log("sketch placeholder:", label);
    }

    for (let i = 0; i < 4; i++) {
      const c = minibodySources[i];
      const id = uuid();
      const rel = path.join("images", "minibody", `${id}.png`);
      const label =
        typeof c.meta?.label === "string"
          ? `${c.meta.label} render`
          : `Sample minibody ${i + 1}`;
      await copyFile(absImage(c.imagePath!), absImage(rel));
      assets.push({
        id,
        stage: "minibody",
        parentId: null,
        imagePath: rel,
        status: "approved",
        meta: { source: "library-placeholder", label },
        createdAt: new Date().toISOString(),
      });
      console.log("minibody placeholder:", label);
    }
  } else {
    console.log("library-placeholder assets already present — skip");
  }

  if (!existingDemo) {
    // Prefer a labeled Woman Within garment if present
    const garment =
      garments.find((g) => typeof g.meta?.label === "string") ?? garments[0];
    if (!garment?.imagePath) {
      throw new Error("No approved garment available for demo chain");
    }
    const cadSource = cads[0];
    if (!cadSource?.imagePath) {
      throw new Error("No approved CAD available for demo chain");
    }

    const sketchId = uuid();
    const cadId = uuid();
    const minibodyId = uuid();
    const sketchRel = path.join("images", "sketch", `${sketchId}.png`);
    const cadRel = path.join("images", "cad", `${cadId}.png`);
    const minibodyRel = path.join("images", "minibody", `${minibodyId}.png`);

    // Prefer an existing real Gemini sketch image if on disk
    const realSketch = assets.find(
      (a) =>
        a.stage === "sketch" &&
        a.imagePath &&
        (a.meta?.source === "gemini-sketch" || a.status === "pending")
    );
    if (realSketch?.imagePath) {
      await copyFile(absImage(realSketch.imagePath), absImage(sketchRel));
    } else {
      writeGreyscaleSketch(absImage(garment.imagePath), absImage(sketchRel));
    }
    await copyFile(absImage(cadSource.imagePath), absImage(cadRel));
    // Prefer existing minibody file if any
    const realMb = assets.find(
      (a) => a.stage === "minibody" && a.imagePath && a.meta?.source === "gemini-minibody"
    );
    if (realMb?.imagePath) {
      await copyFile(absImage(realMb.imagePath), absImage(minibodyRel));
    } else {
      await copyFile(absImage(cadSource.imagePath), absImage(minibodyRel));
    }

    const now = Date.now();
    assets.push(
      {
        id: sketchId,
        stage: "sketch",
        parentId: garment.id,
        imagePath: sketchRel,
        status: "pending",
        meta: { source: "demo-pipeline", label: "Demo sketch" },
        createdAt: new Date(now).toISOString(),
      },
      {
        id: cadId,
        stage: "cad",
        parentId: sketchId,
        imagePath: cadRel,
        status: "pending",
        meta: {
          source: "demo-pipeline",
          label:
            typeof cadSource.meta?.label === "string"
              ? cadSource.meta.label
              : "Demo CAD fill",
        },
        createdAt: new Date(now + 1000).toISOString(),
      },
      {
        id: minibodyId,
        stage: "minibody",
        parentId: cadId,
        imagePath: minibodyRel,
        status: "draft",
        meta: { source: "demo-pipeline", label: "Demo minibody" },
        createdAt: new Date(now + 2000).toISOString(),
      }
    );
    console.log(
      "demo chain:",
      garment.id.slice(0, 8),
      "→",
      sketchId.slice(0, 8),
      "→",
      cadId.slice(0, 8),
      "→",
      minibodyId.slice(0, 8)
    );
  } else {
    console.log("demo-pipeline assets already present — skip");
  }

  await writeAssets(assets);
  const by: Record<string, number> = {};
  for (const a of assets) by[a.stage] = (by[a.stage] || 0) + 1;
  console.log("totals", by);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
