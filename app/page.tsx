import Link from "next/link";
import { getAssets, type Asset } from "@/lib/store";
import { getAncestorChain, type Stage } from "@/lib/chain";
import RecentDesigns, { type DesignRow } from "@/components/RecentDesigns";
import QuickStartCards from "@/components/QuickStartCards";

const RECENT_DESIGNS_LIMIT = 10;

/** One row per root design, resolved down to its most-recently-active
 * branch's Sketch/CAD/Minibody outputs. A design with multiple in-progress
 * branches only shows its most recent one here — full branch history stays
 * reachable via the stage Library pages. */
function buildRecentDesignRows(assets: Asset[]): DesignRow[] {
  const byRoot = new Map<string, Asset[]>();
  for (const asset of assets) {
    const chain = getAncestorChain(assets, asset.id);
    const root = chain[0] ?? asset;
    const group = byRoot.get(root.id) ?? [];
    group.push(asset);
    byRoot.set(root.id, group);
  }

  const rows: (DesignRow & { lastActivity: number })[] = [];
  for (const [rootId, members] of Array.from(byRoot.entries())) {
    const rootAsset = members.find((m) => m.id === rootId) ?? null;
    if (rootAsset?.meta?.dismissedFromRecent === true) continue;

    // Include discarded leaves — Review may uncheck library save, but the
    // run should still appear under Recent Designs with the same tiles.
    const leaves = members.filter((a) => {
      const hasChild = members.some((child) => child.parentId === a.id);
      return !hasChild;
    });
    if (leaves.length === 0) continue;

    const leaf = leaves.reduce((latest, a) =>
      new Date(a.createdAt).getTime() > new Date(latest.createdAt).getTime()
        ? a
        : latest
    );

    const ancestry = [...getAncestorChain(members, leaf.id)].reverse();
    const findStage = (s: Stage) => ancestry.find((a) => a.stage === s) ?? null;

    const garment = findStage("garment");
    const sketch = findStage("sketch");
    const cad = findStage("cad");
    const minibody = findStage("minibody");
    // Library-only roots (placeholders / imports / uploads) aren't designs
    // in progress — skip when every member is a library-* source.
    const allLibraryOnly = members.every((m) => {
      const src = m.meta?.source;
      return typeof src === "string" && src.startsWith("library-");
    });
    if (allLibraryOnly) continue;
    // Anything that reached Review (has a minibody) or produced a sketch
    // counts — regardless of whether those outputs were saved to the library.
    if (!sketch && !minibody) continue;

    rows.push({
      rootId,
      garment,
      sketch,
      cad,
      minibody,
      lastActivity: new Date(leaf.createdAt).getTime(),
    });
  }

  rows.sort((a, b) => b.lastActivity - a.lastActivity);
  return rows.slice(0, RECENT_DESIGNS_LIMIT);
}

function SketchesIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
      <rect x="4" y="2.5" width="12" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 7h6M7 10h6M7 13h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function GarmentsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
      <path
        d="M7 3.2 10 5l3-1.8 3 3-2 2v8.1H6V8.4l-2-2 3-3z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MinibodiesIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
      <circle cx="10" cy="5" r="2.3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.5 17c0-3.6 2-5.7 4.5-5.7s4.5 2.1 4.5 5.7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CadsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5">
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 17h6M10 13.5v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export default async function HomePage() {
  const assets = await getAssets();
  const recentRows = buildRecentDesignRows(assets);
  const active = (stage: Stage) =>
    assets.filter((a) => a.stage === stage && a.status === "approved").length;

  const memoryBank = [
    { key: "sketches", label: "Sketches", icon: SketchesIcon, href: "/library/sketch", count: active("sketch") },
    { key: "cads", label: "CADs", icon: CadsIcon, href: "/library/cad", count: active("cad") },
    { key: "minibodies", label: "Minibodies", icon: MinibodiesIcon, href: "/library/minibody", count: active("minibody") },
    { key: "garments", label: "Garments", icon: GarmentsIcon, href: "/library/garment", count: active("garment") },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Design Pipeline</h1>
        <p className="text-sm text-cream-muted">
          Garment → Line sketch → CAD Fill → Minibody
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Link
          href="/new"
          className="group flex flex-col items-center justify-center gap-3 rounded-lg border border-navy-50 bg-navy-100 px-6 py-12 text-center transition hover:border-accent-blue"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-blue text-2xl font-semibold text-navy transition group-hover:brightness-110">
            +
          </span>
          <span className="text-lg font-semibold">New Design</span>
          <span className="max-w-[26rem] text-sm text-cream-muted">
            Start from a garment photo, in four steps, and then a finished
            minibody render.
          </span>
        </Link>

        <div className="grid grid-cols-2 gap-3">
          {memoryBank.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.key}
                href={card.href}
                className="flex flex-col items-start gap-2 rounded-lg border border-navy-50 bg-navy-100 p-4 transition hover:border-cream-muted"
              >
                <Icon />
                <span className="text-sm font-medium">{card.label}</span>
                <span className="text-xs text-cream-muted">{card.count} items</span>
              </Link>
            );
          })}
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wider text-cream-muted">
          Already further along?
        </h2>
        <QuickStartCards />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-cream-muted">
          Recent Designs
        </h2>
        <RecentDesigns initialRows={recentRows} />
      </section>
    </div>
  );
}
