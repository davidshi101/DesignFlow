"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import StageOutputTiles from "@/components/StageOutputTiles";
import type { Asset } from "@/lib/store";
import { getAncestorChain } from "@/lib/chain";

export default function ReviewPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const [minibody, setMinibody] = useState<Asset | null>(null);
  const [cad, setCad] = useState<Asset | null>(null);
  const [sketch, setSketch] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/assets");
      const data = await res.json();
      const allAssets: Asset[] = data.assets ?? [];
      const mb = allAssets.find((a) => a.id === id) ?? null;
      setMinibody(mb);

      // Walk ancestors past the minibody's own parent to find the real CAD
      // and sketch that fed into this specific run — same pattern already
      // used for garmentSource/cadSource on the Sketch/Minibody pages.
      const ancestry = mb?.parentId ? getAncestorChain(allAssets, mb.parentId) : [];
      const reversed = [...ancestry].reverse();
      setCad(reversed.find((a) => a.stage === "cad") ?? null);
      setSketch(reversed.find((a) => a.stage === "sketch") ?? null);
    } catch {
      setMinibody(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleToggle(asset: Asset, checked: boolean) {
    // Checked → library (approved). Unchecked → not in library (discarded).
    const status = checked ? "approved" : "discarded";
    const patched = { ...asset, status } as Asset;
    if (asset.id === minibody?.id) setMinibody(patched);
    if (asset.id === cad?.id) setCad(patched);
    if (asset.id === sketch?.id) setSketch(patched);

    setError(null);
    try {
      const res = await fetch("/api/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asset.id, status }),
      });
      if (!res.ok) throw new Error("Failed to update");
    } catch {
      setError("Couldn't save that change — reverting.");
      load();
    }
  }

  if (loading) {
    return <p className="text-sm text-cream-muted">Loading…</p>;
  }

  if (!minibody) {
    return <p className="text-sm text-accent-orange">Asset not found.</p>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="space-y-1">
        <Link
          href={`/minibody/${id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-cream-muted transition hover:text-cream"
        >
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Review &amp; Save</h1>
        <p className="text-sm text-cream-muted">
          Choose which outputs to upload to the library. Checked items are
          saved to the library; unchecked items are not.
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-navy-50 bg-navy-100/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-cream-muted">
          Library upload
        </p>
        <p className="text-sm text-cream">
          Each checkbox controls whether that output appears in the Memory Bank
          libraries. Leave unchecked to keep it out of the library.
        </p>
        <StageOutputTiles
          sketch={sketch}
          cad={cad}
          minibody={minibody}
          size="lg"
          onToggle={handleToggle}
        />
      </div>

      {error && (
        <p className="rounded-md border border-accent-orange/40 bg-accent-orange/10 px-3 py-2 text-sm text-accent-orange">
          {error}
        </p>
      )}

      <div className="border-t border-navy-50 pt-4">
        <Link
          href="/"
          className="inline-flex rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-navy transition hover:brightness-110"
        >
          Done → Back to dashboard
        </Link>
      </div>
    </div>
  );
}
