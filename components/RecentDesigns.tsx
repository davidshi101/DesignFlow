"use client";

import { useState } from "react";
import Link from "next/link";
import StageOutputTiles from "@/components/StageOutputTiles";
import type { Asset } from "@/lib/store";
import { resumeHref } from "@/lib/chain";

export interface DesignRow {
  rootId: string;
  garment: Asset | null;
  sketch: Asset | null;
  cad: Asset | null;
  minibody: Asset | null;
}

interface RecentDesignsProps {
  initialRows: DesignRow[];
}

/** Dashboard recent-design rows. Library save toggles live only on Review.
 * Dismiss (×) hides the design from this list without deleting library assets. */
export default function RecentDesigns({ initialRows }: RecentDesignsProps) {
  const [rows, setRows] = useState(initialRows);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  async function handleDismiss(rootId: string) {
    const previous = rows;
    setDismissingId(rootId);
    setRows((rs) => rs.filter((r) => r.rootId !== rootId));
    try {
      const oneRes = await fetch(`/api/assets?id=${rootId}`);
      const oneData = await oneRes.json();
      const asset = oneData.asset as Asset | null;
      if (!asset) throw new Error("Asset not found");

      const res = await fetch("/api/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: rootId,
          meta: { ...asset.meta, dismissedFromRecent: true },
        }),
      });
      if (!res.ok) throw new Error("Failed to dismiss");
    } catch {
      setRows(previous);
    } finally {
      setDismissingId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-cream-muted">No recent designs yet</p>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const href = resumeHref(row);
        return (
          <li
            key={row.rootId}
            className="flex items-center gap-4 rounded-lg border border-navy-50 bg-navy-100 p-3"
          >
            <span className="w-16 shrink-0 truncate font-mono text-[11px] text-cream-muted">
              {row.rootId.slice(0, 8)}
            </span>
            <div className="min-w-0 flex-1">
              <StageOutputTiles
                garment={row.garment}
                sketch={row.sketch}
                cad={row.cad}
                minibody={row.minibody}
                size="sm"
              />
            </div>
            {href && (
              <Link
                href={href}
                className="shrink-0 rounded-md bg-accent-blue px-3 py-1.5 text-sm font-semibold text-navy transition hover:brightness-110"
              >
                Resume
              </Link>
            )}
            <button
              type="button"
              disabled={dismissingId === row.rootId}
              onClick={() => handleDismiss(row.rootId)}
              aria-label="Remove from recent designs"
              title="Remove from recent designs"
              className="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-cream-muted transition hover:bg-navy-50 hover:text-cream disabled:opacity-40"
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
}
