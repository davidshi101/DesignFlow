import { promises as fs } from "fs";
import path from "path";

export type AssetStage =
  | "garment"
  | "sketch"
  | "cad"
  | "minibody"
  | "approval"
  | "done"; // legacy alias for approval
export type AssetStatus = "draft" | "pending" | "approved" | "discarded";

export interface Asset {
  id: string;
  stage: AssetStage;
  parentId: string | null;
  imageUrl: string | null;
  status: AssetStatus;
  meta: Record<string, unknown>;
  createdAt: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "assets.json");

async function ensureStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.writeFile(STORE_PATH, "[]\n", "utf-8");
  }
}

async function readStore(): Promise<Asset[]> {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  // Support legacy `{ assets: [] }` shape if present
  if (Array.isArray(parsed)) return parsed as Asset[];
  if (parsed && Array.isArray(parsed.assets)) return parsed.assets as Asset[];
  return [];
}

async function writeStore(assets: Asset[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(STORE_PATH, JSON.stringify(assets, null, 2) + "\n", "utf-8");
}

export async function getAssets(): Promise<Asset[]> {
  return readStore();
}

export async function getAsset(id: string): Promise<Asset | null> {
  const assets = await readStore();
  return assets.find((a) => a.id === id) ?? null;
}

export async function createAsset(
  data: Omit<Asset, "id" | "createdAt"> & { id?: string; createdAt?: string }
): Promise<Asset> {
  const assets = await readStore();
  const asset: Asset = {
    id: data.id ?? crypto.randomUUID(),
    stage: data.stage,
    parentId: data.parentId ?? null,
    imageUrl: data.imageUrl ?? null,
    status: data.status,
    meta: data.meta ?? {},
    createdAt: data.createdAt ?? new Date().toISOString(),
  };
  assets.push(asset);
  await writeStore(assets);
  return asset;
}

export async function updateAsset(
  id: string,
  updates: Partial<Omit<Asset, "id" | "createdAt">>
): Promise<Asset | null> {
  const assets = await readStore();
  const index = assets.findIndex((a) => a.id === id);
  if (index === -1) return null;

  assets[index] = {
    ...assets[index],
    ...updates,
  };
  await writeStore(assets);
  return assets[index];
}
