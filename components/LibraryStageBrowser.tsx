"use client";

import { useRef, useState } from "react";
import type { Asset, AssetStage } from "@/lib/store";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

interface LibraryStageBrowserProps {
  stage: AssetStage;
  label: string;
  initialItems: Asset[];
}

/** Browse-only library grid plus upload-into-this-library. Cards are not
 * links — picking a library item does not jump into a pipeline step. */
export default function LibraryStageBrowser({
  stage,
  label,
  initialItems,
}: LibraryStageBrowserProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState(initialItems);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage,
          status: "approved",
          parentId: null,
          imageUrl: dataUrl,
          meta: { source: "library-upload", fileName: file.name },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      const asset = data.asset as Asset;
      setItems((prev) => [asset, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(asset: Asset) {
    if (
      !window.confirm(
        `Remove this ${label.toLowerCase()} from the library? It will no longer appear here.`
      )
    ) {
      return;
    }
    const previous = items;
    setDeletingId(asset.id);
    setError(null);
    setItems((prev) => prev.filter((a) => a.id !== asset.id));
    try {
      const res = await fetch("/api/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asset.id, status: "discarded" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || "Failed to delete"
        );
      }
    } catch (err) {
      setItems(previous);
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-cream-muted">
          Approved {label.toLowerCase()} assets in the library. Browse here —
          use New Design or a stage page to start a pipeline from an upload.
        </p>
        <label className="inline-flex cursor-pointer items-center">
          <span className="rounded-md bg-accent-blue px-3 py-2 text-sm font-semibold text-navy transition hover:brightness-110">
            {uploading ? "Uploading…" : `Upload to ${label} library`}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={handleUpload}
            className="sr-only"
          />
        </label>
      </div>

      {error && (
        <p className="text-sm text-accent-orange">{error}</p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-cream-muted">
          No {label.toLowerCase()} assets in the library yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {items.map((asset) => (
            <div
              key={asset.id}
              className="overflow-hidden rounded-lg border border-navy-50 bg-navy-100"
            >
              <div className="relative aspect-square overflow-hidden bg-navy">
                {asset.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(asset)}
                  disabled={deletingId === asset.id}
                  aria-label={`Delete from ${label} library`}
                  className="absolute right-1.5 top-1.5 rounded bg-navy/80 px-2 py-0.5 text-[11px] font-medium text-cream transition hover:bg-accent-orange hover:text-navy disabled:opacity-50"
                >
                  {deletingId === asset.id ? "…" : "Delete"}
                </button>
              </div>
              <div className="space-y-1 p-2">
                <span className="inline-block rounded bg-navy px-1.5 py-0.5 text-[10px] capitalize text-accent-blue">
                  {typeof asset.meta?.label === "string"
                    ? asset.meta.label
                    : asset.status}
                </span>
                <p className="text-[11px] text-cream-muted">
                  {new Date(asset.createdAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
