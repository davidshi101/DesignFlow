"use client";

import type { Asset } from "@/lib/store";

interface AssetThumbPickerProps {
  assets: Asset[];
  /** Currently selected asset id. Pass `null` / `""` when none is selected. */
  selectedId?: string | null;
  onSelect: (id: string | null) => void;
  /** Adds a leading "no parent / standalone" tile that selects `null`. */
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  className?: string;
}

function labelFor(asset: Asset): string {
  const metaLabel = asset.meta?.label;
  if (typeof metaLabel === "string" && metaLabel.trim()) return metaLabel.trim();
  return asset.id.slice(0, 8);
}

/** Finder-style icon grid for picking a prior asset. Scrolls when the set
 * grows past a couple of rows. Renders nothing when `assets` is empty
 * (unless `allowNone` is set). */
export default function AssetThumbPicker({
  assets,
  selectedId = null,
  onSelect,
  allowNone = false,
  noneLabel = "None",
  disabled = false,
  className = "",
}: AssetThumbPickerProps) {
  const noneSelected = selectedId == null || selectedId === "";

  if (assets.length === 0 && !allowNone) {
    return null;
  }

  return (
    <div
      className={[
        "max-h-52 overflow-y-auto rounded-md border border-navy-50 bg-navy-100/40 p-2",
        disabled ? "pointer-events-none opacity-40" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
        {allowNone && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(null)}
            title={noneLabel}
            className={[
              "flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed px-1 text-center transition",
              noneSelected
                ? "border-accent-blue bg-accent-blue/10 text-cream"
                : "border-navy-50 text-cream-muted hover:border-cream-muted hover:text-cream",
            ].join(" ")}
          >
            <span className="text-lg leading-none text-cream-muted">∅</span>
            <span className="line-clamp-2 w-full text-[10px] leading-tight">
              {noneLabel}
            </span>
          </button>
        )}
        {assets.map((asset) => {
          const selected = asset.id === selectedId;
          return (
            <button
              key={asset.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(asset.id)}
              title={labelFor(asset)}
              className={[
                "group flex flex-col gap-1 rounded-md p-1 text-left transition",
                selected
                  ? "bg-accent-blue/15 ring-2 ring-accent-blue"
                  : "hover:bg-navy-50/60",
              ].join(" ")}
            >
              <div
                className={[
                  "aspect-square overflow-hidden rounded border bg-white",
                  selected ? "border-accent-blue" : "border-navy-50",
                ].join(" ")}
              >
                {asset.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.imageUrl}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-navy-100 text-[10px] text-cream-muted">
                    —
                  </div>
                )}
              </div>
              <span className="line-clamp-2 px-0.5 text-center text-[10px] leading-tight text-cream-muted group-hover:text-cream">
                {labelFor(asset)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
