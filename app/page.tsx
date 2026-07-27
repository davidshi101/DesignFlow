import Link from "next/link";
import { getAssets, type Asset } from "@/lib/store";
import { getAncestorChain, stageHref } from "@/lib/chain";
import DownloadLink from "@/components/DownloadLink";

interface DesignGroup {
  root: Asset;
  leaves: Asset[];
  lastActivity: number;
}

function groupByDesign(assets: Asset[]): DesignGroup[] {
  const byRoot = new Map<string, Asset[]>();

  for (const asset of assets) {
    const chain = getAncestorChain(assets, asset.id);
    const root = chain[0] ?? asset;
    const group = byRoot.get(root.id) ?? [];
    group.push(asset);
    byRoot.set(root.id, group);
  }

  const groups: DesignGroup[] = [];
  for (const entry of Array.from(byRoot.entries())) {
    const [rootId, members] = entry;
    const root = members.find((a: Asset) => a.id === rootId) ?? members[0];
    const leaves = members.filter((a: Asset) => {
      if (a.status === "discarded") return false;
      const hasActiveChild = members.some(
        (child: Asset) =>
          child.parentId === a.id && child.status !== "discarded"
      );
      return !hasActiveChild;
    });
    if (leaves.length === 0) continue; // whole tree discarded — hide it

    const lastActivity = Math.max(
      ...members.map((a: Asset) => new Date(a.createdAt).getTime())
    );
    groups.push({ root, leaves, lastActivity });
  }

  groups.sort((a, b) => b.lastActivity - a.lastActivity);
  return groups;
}

export default async function HomePage() {
  const assets = await getAssets();
  const groups = groupByDesign(assets);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Design pipeline
        </h1>
        <p className="text-cream-muted max-w-xl">
          Garment → Line Sketch → CAD Fill → Minibody.
        </p>
        <Link
          href="/new"
          className="inline-flex rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-navy transition hover:brightness-110"
        >
          New design
        </Link>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-cream-muted">
          Designs
        </h2>
        {groups.length === 0 ? (
          <p className="text-sm text-cream-muted">
            No designs yet. Start a new one.
          </p>
        ) : (
          <ul className="space-y-3">
            {groups.map((group) => (
              <li
                key={group.root.id}
                className="overflow-hidden rounded-lg border border-navy-50"
              >
                <div className="flex items-center gap-3 bg-navy-100 px-4 py-3">
                  {group.root.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={group.root.imageUrl}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                  )}
                  <span className="truncate font-mono text-xs text-cream-muted">
                    Design {group.root.id.slice(0, 8)}
                  </span>
                  {group.leaves.length > 1 && (
                    <span className="shrink-0 rounded bg-navy px-2 py-0.5 text-[10px] text-cream-muted">
                      {group.leaves.length} branches in progress
                    </span>
                  )}
                </div>
                <ul className="divide-y divide-navy-50">
                  {group.leaves.map((leaf) => (
                    <li
                      key={leaf.id}
                      className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-navy-50"
                    >
                      <Link
                        href={stageHref(leaf)}
                        className="flex min-w-0 flex-1 items-center gap-3 truncate text-sm"
                      >
                        {leaf.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={leaf.imageUrl}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded object-cover"
                          />
                        )}
                        <span className="shrink-0 rounded bg-navy-100 px-2 py-0.5 text-xs capitalize text-accent-blue">
                          {leaf.stage} · {leaf.status}
                        </span>
                      </Link>
                      {leaf.imageUrl && (
                        <DownloadLink
                          dataUrl={leaf.imageUrl}
                          filename={`${leaf.stage}-${leaf.id.slice(0, 8)}.png`}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
