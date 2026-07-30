"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StageStepper from "@/components/StageStepper";
import AssetThumbPicker from "@/components/AssetThumbPicker";
import type { Asset, AssetStage, AssetStatus } from "@/lib/store";
import { startFromHref } from "@/lib/chain";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

interface UploadCard {
  key: string;
  stage: AssetStage;
  status: AssetStatus;
  title: string;
  description: string;
}

const PRIMARY_CARD: UploadCard = {
  key: "garment",
  stage: "garment",
  status: "approved",
  title: "Garment photo",
  description:
    "Starts at Line Sketch — AI converts your photo into a clean line-art flat.",
};

interface SecondaryCard {
  key: string;
  uploadStage: AssetStage;
  status: AssetStatus;
  title: string;
  description: string;
  uploadLabel: string;
}

const SECONDARY_CARDS: SecondaryCard[] = [
  {
    key: "cad",
    uploadStage: "sketch",
    status: "approved",
    title: "Start from CAD",
    description: "Upload a line sketch — opens CAD Fill empty.",
    uploadLabel: "Upload line sketch",
  },
  {
    key: "minibody",
    uploadStage: "cad",
    status: "approved",
    title: "Start from Minibody",
    description: "Upload a filled sketch — opens Minibody with generation empty.",
    uploadLabel: "Upload filled sketch",
  },
];

export default function NewDesignPage() {
  const router = useRouter();
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const [dragCard, setDragCard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentGarments, setRecentGarments] = useState<Asset[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/assets");
        const data = await res.json();
        const assets: Asset[] = data.assets ?? [];
        if (cancelled) return;
        setRecentGarments(
          assets
            .filter((a) => a.stage === "garment" && a.status === "approved")
            .sort(
              (a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            )
        );
      } catch {
        // Convenience grid — silently skip on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function createAndStart(opts: {
    key: string;
    stage: AssetStage;
    status: AssetStatus;
    file: File;
  }) {
    if (!opts.file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    setBusyCard(opts.key);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(opts.file);
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: opts.stage,
          status: opts.status,
          parentId: null,
          imageUrl: dataUrl,
          meta: {
            source: opts.stage === "garment" ? "upload" : "upload-direct",
            fileName: opts.file.name,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create asset");
      router.push(startFromHref(data.asset as Asset));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusyCard(null);
    } finally {
      const input = fileInputRefs.current[opts.key];
      if (input) input.value = "";
    }
  }

  const card = PRIMARY_CARD;
  const busy = busyCard === card.key;
  const dragging = dragCard === card.key;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <StageStepper current="garment" />

      <div className="space-y-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs font-medium text-cream-muted transition hover:text-cream"
        >
          ← back home
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Garment</h1>
        <p className="text-sm text-cream-muted">
          Upload a garment photo to start the pipeline.
        </p>
      </div>

      {error && <p className="text-sm text-accent-orange">{error}</p>}

      <div className="mx-auto grid max-w-md gap-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragCard(card.key);
          }}
          onDragLeave={() => setDragCard((k) => (k === card.key ? null : k))}
          onDrop={(e) => {
            e.preventDefault();
            setDragCard(null);
            const file = e.dataTransfer.files?.[0];
            if (file) {
              createAndStart({
                key: card.key,
                stage: card.stage,
                status: card.status,
                file,
              });
            }
          }}
          onClick={() => fileInputRefs.current[card.key]?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRefs.current[card.key]?.click();
            }
          }}
          role="button"
          tabIndex={0}
          className={[
            "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center transition",
            dragging
              ? "border-accent-blue bg-accent-blue/10"
              : "border-navy-50 bg-navy-100 hover:border-cream-muted",
          ].join(" ")}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-lg text-cream-muted">
            ↑
          </span>
          <h2 className="text-base font-medium">{card.title}</h2>
          <p className="text-xs text-cream-muted">
            Drag and drop, or{" "}
            <span className="text-accent-blue underline">browse files</span>
          </p>
          <p className="text-[11px] text-cream-muted">PNG or JPG up to 20MB</p>
          <p className="max-w-[16rem] text-[11px] text-cream-muted">
            {card.description}
          </p>
          <input
            ref={(el) => {
              fileInputRefs.current[card.key] = el;
            }}
            type="file"
            accept="image/*"
            disabled={busyCard !== null}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                createAndStart({
                  key: card.key,
                  stage: card.stage,
                  status: card.status,
                  file,
                });
              }
            }}
            className="hidden"
          />
          {busy && <p className="text-xs text-cream-muted">Creating asset…</p>}
        </div>
      </div>

      {recentGarments.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
            Previous garments
          </h2>
          <p className="text-xs text-cream-muted">
            Start a new design from a library garment — opens Line Sketch with
            generation empty.
          </p>
          <AssetThumbPicker
            assets={recentGarments}
            onSelect={(nextId) => {
              if (!nextId) return;
              const asset = recentGarments.find((g) => g.id === nextId);
              if (asset) router.push(startFromHref(asset));
            }}
          />
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-navy-50 p-4">
        <h2 className="text-sm font-medium text-cream-muted">
          Already further along?
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {SECONDARY_CARDS.map((sec) => (
            <section
              key={sec.key}
              className="flex flex-col gap-3 rounded-lg border border-navy-50 bg-navy-100 p-4"
            >
              <div className="space-y-1">
                <h3 className="text-sm font-medium">{sec.title}</h3>
                <p className="text-xs text-cream-muted">{sec.description}</p>
              </div>
              <label className="inline-flex cursor-pointer items-center self-start">
                <span className="rounded-md bg-accent-blue px-3 py-2 text-sm font-semibold text-navy transition hover:brightness-110">
                  {busyCard === sec.key ? "Uploading…" : sec.uploadLabel}
                </span>
                <input
                  ref={(el) => {
                    fileInputRefs.current[sec.key] = el;
                  }}
                  type="file"
                  accept="image/*"
                  disabled={busyCard !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      createAndStart({
                        key: sec.key,
                        stage: sec.uploadStage,
                        status: sec.status,
                        file,
                      });
                    }
                  }}
                  className="sr-only"
                />
              </label>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
