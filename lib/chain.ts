/**
 * Pure helpers over an already-fetched Asset[] — no fs import, safe to use
 * from server components (getAssets()) and client pages (fetch("/api/assets")).
 */

import type { Asset, AssetStage } from "@/lib/store";

/** Stages that appear in navigation/UI. Legacy "approval"/"done" rows are
 * routed as "minibody" (see stageHref) rather than getting their own step. */
export type Stage = "garment" | "sketch" | "cad" | "minibody";

export const STAGE_ORDER: Stage[] = ["garment", "sketch", "cad", "minibody"];

function toNavStage(stage: AssetStage): Stage {
  if (stage === "approval" || stage === "done") return "minibody";
  return stage;
}

/** Walk parentId back to the root. Returns root-first, ending with the
 * asset itself. Cycle-safe. Empty array if `id` isn't found. */
export function getAncestorChain(assets: Asset[], id: string): Asset[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const chain: Asset[] = [];
  const seen = new Set<string>();

  let current = byId.get(id) ?? null;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) ?? null : null;
  }
  return chain;
}

/** Ancestor chain + forward walk to the most-recently-created non-discarded
 * child at each step, so navigation can also reach stages already generated
 * ahead of the current one. */
export function getFullChain(assets: Asset[], id: string): Asset[] {
  const chain = getAncestorChain(assets, id);
  if (chain.length === 0) return chain;

  const seen = new Set(chain.map((a) => a.id));
  let tail = chain[chain.length - 1];

  for (;;) {
    const children = assets
      .filter(
        (a) =>
          a.parentId === tail.id && a.status !== "discarded" && !seen.has(a.id)
      )
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    const next = children[0];
    if (!next) break;
    chain.push(next);
    seen.add(next.id);
    tail = next;
  }

  return chain;
}

/**
 * Route for revisiting/regenerating a given asset's stage.
 *
 * Each stage page takes its *input* asset's id as the route param, not the
 * output's — /cad/[id] takes a sketch id, /minibody/[id] takes a CAD id.
 * So routing "back" to stage X for an asset that is itself the *output* of
 * stage X means resolving through parentId (the thing that produced it),
 * falling back to the asset's own id for roots (e.g. an uploaded-as-sketch
 * asset with no parent).
 */
export function stageHref(asset: Asset): string {
  switch (toNavStage(asset.stage)) {
    case "garment":
      return `/sketch/${asset.id}`;
    case "sketch":
      return `/sketch/${asset.parentId ?? asset.id}`;
    case "cad":
      return `/cad/${asset.parentId ?? asset.id}`;
    case "minibody":
      return `/minibody/${asset.parentId ?? asset.id}`;
  }
}

export function stageIndex(stage: AssetStage): number {
  return STAGE_ORDER.indexOf(toNavStage(stage));
}
