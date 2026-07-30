import { promises as fs } from "fs";
import path from "path";

export interface Print {
  id: string;
  label: string;
  src: string; // static path (placeholder) or data: URL (upload)
  createdAt: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "prints.json");

const PLACEHOLDERS: Omit<Print, "createdAt">[] = [
  { id: "black", label: "Black", src: "/prints/black.svg" },
  { id: "white", label: "White", src: "/prints/white.svg" },
  { id: "pattern", label: "Pattern", src: "/prints/pattern.svg" },
  { id: "word", label: "Word mark", src: "/prints/word.svg" },
];

async function ensureStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    const seeded: Print[] = PLACEHOLDERS.map((p) => ({
      ...p,
      createdAt: new Date().toISOString(),
    }));
    await fs.writeFile(STORE_PATH, JSON.stringify(seeded, null, 2) + "\n", "utf-8");
  }
}

async function readStore(): Promise<Print[]> {
  await ensureStore();
  const raw = await fs.readFile(STORE_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as Print[]) : [];
}

async function writeStore(prints: Print[]): Promise<void> {
  await ensureStore();
  await fs.writeFile(STORE_PATH, JSON.stringify(prints, null, 2) + "\n", "utf-8");
}

export async function getPrints(): Promise<Print[]> {
  return readStore();
}

export async function createPrint(label: string, src: string): Promise<Print> {
  const prints = await readStore();
  const print: Print = {
    id: crypto.randomUUID(),
    label: label.trim() || "Untitled print",
    src,
    createdAt: new Date().toISOString(),
  };
  prints.push(print);
  await writeStore(prints);
  return print;
}
