"use client";

import Link from "next/link";
import type { Asset } from "@/lib/store";

type OutputStage = "garment" | "sketch" | "cad" | "minibody";

const LABELS: Record<OutputStage, string> = {
  garment: "Garment",
  sketch: "Sketch",
  cad: "CAD",
  minibody: "Minibody",
};

// Garment assets don't have their own route — they redo/continue via the
// Sketch page, same mapping used everywhere else (StageStepper, dashboard).
const ROUTE_STAGE: Record<OutputStage, string> = {
  garment: "sketch",
  sketch: "sketch",
  cad: "cad",
  minibody: "minibody",
};

const SIZE_CLASSES: Record<"sm" | "lg", string> = {
  sm: "h-[72px] w-[72px]",
  lg: "h-48 w-48",
};

interface StageOutputTilesProps {
  /** Omit entirely to hide the Garment tile (e.g. the Review & Save page,
   * which is only about the three generated outputs of one run). */
  garment?: Asset | null;
  sketch: Asset | null;
  cad: Asset | null;
  minibody: Asset | null;
  size?: "sm" | "lg";
  /** Omit to render read-only tiles (image + link only, no checkbox). */
  onToggle?: (asset: Asset, checked: boolean) => void;
}

/**
 * Shared Garment/Sketch/CAD/Minibody tile row — used on both the
 * post-pipeline Review & Save page (no Garment tile) and the dashboard's
 * Recent Designs list (Garment included), so curating a design works
 * identically in either place. Each checkbox is a live, self-contained
 * toggle (checked = keep/approved, unchecked = discarded) — there's no
 * separate submit step anywhere this component is used.
 */
export default function StageOutputTiles({
  garment,
  sketch,
  cad,
  minibody,
  size = "lg",
  onToggle,
}: StageOutputTilesProps) {
  const order: OutputStage[] =
    garment !== undefined ? ["garment", "sketch", "cad", "minibody"] : ["sketch", "cad", "minibody"];
  const assets: Record<OutputStage, Asset | null> = {
    garment: garment ?? null,
    sketch,
    cad,
    minibody,
  };
  const dim = SIZE_CLASSES[size];

  return (
    <div className="flex gap-3">
      {order.map((stage) => {
        const asset = assets[stage];
        return (
          <div key={stage} className="flex flex-col items-center gap-1.5">
            <div
              className={`relative ${dim} overflow-hidden rounded-md border border-navy-50 bg-navy-100`}
            >
              {asset?.imageUrl ? (
                <Link
                  href={`/${ROUTE_STAGE[stage]}/${asset.id}`}
                  className="block h-full w-full"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.imageUrl}
                    alt={LABELS[stage]}
                    className="h-full w-full bg-white object-contain transition hover:opacity-90"
                  />
                </Link>
              ) : (
                <div className="flex h-full w-full items-center justify-center border border-dashed border-navy-50">
                  <span className="text-[10px] text-cream-muted">Not yet</span>
                </div>
              )}
              {asset && onToggle && (
                <label
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-navy/80"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={asset.status === "approved"}
                    onChange={(e) => onToggle(asset, e.target.checked)}
                    className="h-3.5 w-3.5 accent-accent-blue"
                    title={
                      asset.status === "approved"
                        ? "Saved to library — uncheck to remove"
                        : "Check to save to the library"
                    }
                  />
                </label>
              )}
            </div>
            <span className="text-[11px] font-medium text-cream-muted">
              {LABELS[stage]}
              {onToggle && asset ? (
                <span className="mt-0.5 block font-normal text-[10px] text-cream-muted/80">
                  {asset.status === "approved" ? "In library" : "Not in library"}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
