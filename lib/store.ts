import { promises as fs } from "fs";
import path from "path";
import { shouldTrimCadMeta, trimWhitespace } from "@/lib/trimImage";

export type AssetStage =
  | "garment"
  | "sketch"
  | "cad"
  | "minibody"
  | "approval"
  | "done"; // legacy alias for approval
export type AssetStatus = "draft" | "pending" | "approved" | "discarded";

/** Public shape — what every API route / page consumes. `imageUrl` is
 * derived at read time (`/api/images/{id}`), never the raw image bytes. */
export interface Asset {
  id: string;
  stage: AssetStage;
  parentId: string | null;
  imageUrl: string | null;
  status: AssetStatus;
  meta: Record<string, unknown>;
  createdAt: string;
}

/** On-disk shape — assets.json holds metadata + a path to the image file,
 * never inline base64. */
interface StoredAsset {
  id: string;
  stage: AssetStage;
  parentId: string | null;
  imagePath: string | null; // relative to DATA_DIR, e.g. "images/sketch/<id>.png"
  status: AssetStatus;
  meta: Record<string, unknown>;
  createdAt: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const IMAGES_DIR = path.join(DATA_DIR, "images");
const STORE_PATH = path.join(DATA_DIR, "assets.json");

function toAsset(stored: StoredAsset): Asset {
  return {
    id: stored.id,
    stage: stored.stage,
    parentId: stored.parentId,
    imageUrl: stored.imagePath ? `/api/images/${stored.id}` : null,
    status: stored.status,
    meta: stored.meta,
    createdAt: stored.createdAt,
  };
}

async function ensureStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.writeFile(STORE_PATH, "[]\n", "utf-8");
  }
}

async function readStore(): Promise<StoredAsset[]> {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  // Support legacy `{ assets: [] }` shape if present
  if (Array.isArray(parsed)) return parsed as StoredAsset[];
  if (parsed && Array.isArray(parsed.assets)) return parsed.assets as StoredAsset[];
  return [];
}

async function writeStore(assets: StoredAsset[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(STORE_PATH, JSON.stringify(assets, null, 2) + "\n", "utf-8");
}

/** Decodes a `data:<mime>;base64,<data>` URL and writes it to
 * data/images/{stage}/{id}.png, returning the path stored in assets.json
 * (relative to DATA_DIR). Returns null if `imageUrl` isn't a data URL
 * (already null, or already a path from a prior materialization). */
async function materializeImage(
  stage: AssetStage,
  id: string,
  imageUrl: string | null | undefined,
  opts?: { trimWhitespace?: boolean }
): Promise<string | null> {
  if (!imageUrl || !imageUrl.startsWith("data:")) return null;
  // Avoid RegExp on multi‑MB canvas exports — V8 can blow the stack matching
  // the whole base64 payload. Slice after the marker instead.
  const marker = ";base64,";
  const markerIdx = imageUrl.indexOf(marker);
  if (markerIdx < 0) return null;
  const base64 = imageUrl.slice(markerIdx + marker.length);
  if (!base64) return null;

  let buffer: Buffer = Buffer.from(base64, "base64");
  if (opts?.trimWhitespace) {
    buffer = await trimWhitespace(buffer);
  }

  const dir = path.join(IMAGES_DIR, stage);
  await fs.mkdir(dir, { recursive: true });
  const relPath = path.join("images", stage, `${id}.png`);
  await fs.writeFile(path.join(DATA_DIR, relPath), buffer);
  return relPath;
}

export async function getAssets(): Promise<Asset[]> {
  const stored = await readStore();
  return stored.map(toAsset);
}

export async function getAsset(id: string): Promise<Asset | null> {
  const stored = await readStore();
  const found = stored.find((a) => a.id === id);
  return found ? toAsset(found) : null;
}

/** Absolute filesystem path to an asset's image file, for server-only
 * consumers that need the raw bytes (the /api/images route, and the
 * generate-* routes that feed an asset's image to Gemini). */
export async function getAssetImagePath(id: string): Promise<string | null> {
  const stored = await readStore();
  const found = stored.find((a) => a.id === id);
  if (!found?.imagePath) return null;
  return path.join(DATA_DIR, found.imagePath);
}

/** Reads an asset's image bytes directly off disk. mimeType is always
 * "image/png" — every producer in this app (Gemini, canvas exports) writes
 * genuine PNG bytes; browsers additionally content-sniff <img> regardless. */
export async function getAssetImageBuffer(
  id: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const absPath = await getAssetImagePath(id);
  if (!absPath) return null;
  try {
    const buffer = await fs.readFile(absPath);
    return { buffer, mimeType: "image/png" };
  } catch {
    return null;
  }
}

export async function createAsset(
  data: Omit<Asset, "id" | "createdAt"> & {
    id?: string;
    createdAt?: string;
    /** Force edge-trim (CAD fill swatches). Defaults on for library CAD uploads. */
    trimWhitespace?: boolean;
  }
): Promise<Asset> {
  const assets = await readStore();
  const id = data.id ?? crypto.randomUUID();
  const stage = data.stage;
  const meta = data.meta ?? {};
  const doTrim =
    data.trimWhitespace === true ||
    (stage === "cad" && shouldTrimCadMeta(meta));
  const imagePath = await materializeImage(stage, id, data.imageUrl, {
    trimWhitespace: doTrim,
  });

  const stored: StoredAsset = {
    id,
    stage,
    parentId: data.parentId ?? null,
    imagePath,
    status: data.status,
    meta,
    createdAt: data.createdAt ?? new Date().toISOString(),
  };
  assets.push(stored);
  await writeStore(assets);
  return toAsset(stored);
}

export async function updateAsset(
  id: string,
  updates: Partial<Omit<Asset, "id" | "createdAt">>
): Promise<Asset | null> {
  const assets = await readStore();
  const index = assets.findIndex((a) => a.id === id);
  if (index === -1) return null;

  const { imageUrl, ...rest } = updates;
  const existing = assets[index];
  const meta = (rest.meta as Record<string, unknown> | undefined) ?? existing.meta;
  const imagePath =
    imageUrl !== undefined
      ? await materializeImage(existing.stage, id, imageUrl, {
          trimWhitespace:
            existing.stage === "cad" && shouldTrimCadMeta(meta),
        })
      : existing.imagePath;

  assets[index] = {
    ...existing,
    ...rest,
    imagePath,
  };
  await writeStore(assets);
  return toAsset(assets[index]);
}
