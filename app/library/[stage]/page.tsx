import { notFound } from "next/navigation";
import { getAssets } from "@/lib/store";
import { STAGE_ORDER, type Stage } from "@/lib/chain";
import LibraryNav from "@/components/LibraryNav";
import LibraryStageBrowser from "@/components/LibraryStageBrowser";

const LABELS: Record<Stage, string> = {
  garment: "Garment",
  sketch: "Line Sketch",
  cad: "CAD Fill",
  minibody: "Minibody",
};

export default async function LibraryStagePage({
  params,
}: {
  params: { stage: string };
}) {
  if (!STAGE_ORDER.includes(params.stage as Stage)) {
    notFound();
  }
  const stage = params.stage as Stage;
  const label = LABELS[stage];

  const assets = await getAssets();
  const items = assets
    .filter((a) => a.stage === stage && a.status === "approved")
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <LibraryNav current={stage} />

      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {label} library
        </h1>
      </div>

      <LibraryStageBrowser stage={stage} label={label} initialItems={items} />
    </div>
  );
}
