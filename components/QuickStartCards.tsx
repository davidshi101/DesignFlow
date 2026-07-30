"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssetStage, AssetStatus } from "@/lib/store";
import { startFromHref } from "@/lib/chain";
import type { Asset } from "@/lib/store";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

interface QuickStartCard {
  key: string;
  uploadStage: AssetStage;
  status: AssetStatus;
  title: string;
  description: string;
  uploadLabel: string;
}

const CARDS: QuickStartCard[] = [
  {
    key: "cad",
    uploadStage: "sketch",
    status: "approved",
    title: "Start from CAD",
    description: "Upload a line sketch — opens CAD Fill with an empty fill ready to go.",
    uploadLabel: "Upload line sketch",
  },
  {
    key: "minibody",
    uploadStage: "cad",
    status: "approved",
    title: "Start from Minibody",
    description:
      "Upload a filled sketch — opens Minibody with generation empty.",
    uploadLabel: "Upload filled sketch",
  },
];

/** Homepage shortcuts that jump to CAD Fill or Minibody via file upload. */
export default function QuickStartCards() {
  const router = useRouter();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(
    card: QuickStartCard,
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusyKey(card.key);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: card.uploadStage,
          status: card.status,
          parentId: null,
          imageUrl: dataUrl,
          meta: { source: "upload-direct", fileName: file.name },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      router.push(startFromHref(data.asset as Asset));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusyKey(null);
    } finally {
      const input = fileInputRefs.current[card.key];
      if (input) input.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <section
            key={card.key}
            className="flex flex-col gap-3 rounded-lg border border-navy-50 bg-navy-100 p-4"
          >
            <div className="space-y-1">
              <h3 className="text-sm font-medium">{card.title}</h3>
              <p className="text-xs text-cream-muted">{card.description}</p>
            </div>
            <label className="inline-flex cursor-pointer items-center self-start">
              <span className="rounded-md bg-accent-blue px-3 py-2 text-sm font-semibold text-navy transition hover:brightness-110">
                {busyKey === card.key ? "Uploading…" : card.uploadLabel}
              </span>
              <input
                ref={(el) => {
                  fileInputRefs.current[card.key] = el;
                }}
                type="file"
                accept="image/*"
                disabled={busyKey !== null}
                onChange={(e) => handleUpload(card, e)}
                className="sr-only"
              />
            </label>
          </section>
        ))}
      </div>
      {error && <p className="text-xs text-accent-orange">{error}</p>}
    </div>
  );
}
