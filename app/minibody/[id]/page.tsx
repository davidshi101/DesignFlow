"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import StageStepper from "@/components/StageStepper";
import ApprovalBar from "@/components/ApprovalBar";
import DownloadLink from "@/components/DownloadLink";
import AssetThumbPicker from "@/components/AssetThumbPicker";
import type { Asset } from "@/lib/store";
import { getAncestorChain, getFullChain, startFromHref } from "@/lib/chain";
import { DEFAULT_MINIBODY_PROMPT } from "@/lib/prompts";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function isMinibodyStage(stage: Asset["stage"]): boolean {
  return stage === "minibody" || stage === "approval" || stage === "done";
}

/** Slice a root-first chain down to this page's generation history starting
 * at `id`. Compare against the minibody output stage (not `id`'s own stage)
 * so a CAD-id entry keeps its minibody children, while a minibody-id entry
 * still stops before walking into any later unrelated asset. */
function ownHistoryFrom(chain: Asset[], id: string): Asset[] {
  const idx = chain.findIndex((a) => a.id === id);
  if (idx < 0) return chain;
  const result = [chain[idx]];
  for (let i = idx + 1; i < chain.length; i++) {
    if (!isMinibodyStage(chain[i].stage)) break;
    result.push(chain[i]);
  }
  return result;
}

export default function MinibodyPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const router = useRouter();
  const searchParams = useSearchParams();
  const fresh = searchParams.get("fresh") === "1";
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadMinibodyInputRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<Asset | null>(null);
  const [cadSource, setCadSource] = useState<Asset | null>(null);
  const [allAssets, setAllAssets] = useState<Asset[]>([]);
  const [chain, setChain] = useState<Asset[]>([]);
  const [chainFromId, setChainFromId] = useState(id);
  const [backHref, setBackHref] = useState(`/cad/${id}`);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptText, setPromptText] = useState(DEFAULT_MINIBODY_PROMPT);
  const [uploadParentId, setUploadParentId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMinibodyParentId, setUploadMinibodyParentId] = useState("");
  const [uploadingMinibody, setUploadingMinibody] = useState(false);

  const fullOwnHistory = ownHistoryFrom(chain, id);
  const selectedIdx = fullOwnHistory.findIndex((a) => a.id === chainFromId);
  const history =
    selectedIdx >= 0 ? fullOwnHistory.slice(0, selectedIdx + 1) : fullOwnHistory;
  const current = history.find((a) => a.id === chainFromId) ?? source;
  const hasRender = Boolean(current?.imageUrl) && current?.stage === "minibody";

  const load = useCallback(async () => {
    try {
      const [oneRes, allRes] = await Promise.all([
        fetch(`/api/assets?id=${id}`),
        fetch("/api/assets"),
      ]);
      const oneData = await oneRes.json();
      const allData = await allRes.json();
      const allAssetsList: Asset[] = allData.assets ?? [];
      setAllAssets(allAssetsList);

      const src: Asset | null = oneData.asset ?? null;
      setSource(src);
      const fullChain = getFullChain(allAssetsList, id);
      setChain(fullChain);
      const tip = ownHistoryFrom(fullChain, id);
      // `?fresh=1` (library / start-from) keeps generation empty even when
      // this CAD already has minibody children from earlier runs.
      const tipAsset = fresh ? null : tip[tip.length - 1] ?? null;
      setChainFromId(fresh ? id : tipAsset?.id ?? id);
      setDone(Boolean(tipAsset && tipAsset.status === "approved"));

      if (src?.stage === "cad") {
        setCadSource(src);
        setBackHref(`/cad/${id}`);
      } else {
        // A minibody-stage id (direct upload, or reached via back-nav/regen
        // chaining) isn't itself the CAD Fill — walk ancestors past any
        // same-stage hops (regenerations) to the real CAD source, exactly as
        // ownHistoryFrom stops the forward walk at that boundary. "Back"
        // always means "the CAD Fill that led here."
        const ancestry = src?.parentId
          ? getAncestorChain(allAssetsList, src.parentId)
          : [];
        const cadAncestor = [...ancestry].reverse().find((x) => x.stage === "cad");
        setCadSource(cadAncestor ?? null);
        setBackHref(cadAncestor ? `/cad/${cadAncestor.id}` : "/");
      }
    } catch {
      setSource(null);
    } finally {
      setLoading(false);
    }
  }, [id, fresh]);

  useEffect(() => {
    load();
  }, [load]);

  // Always show the editable default prompt when entering this page. Selecting
  // Versions does not wipe edits — only a new route id resets.
  useEffect(() => {
    setPromptText(DEFAULT_MINIBODY_PROMPT);
  }, [id]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-minibody", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: chainFromId, promptText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      const updated = [...allAssets, data.asset as Asset];
      setAllAssets(updated);
      setChain(getFullChain(updated, id));
      setChainFromId(data.asset.id);
      setDone(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegenerate() {
    await handleGenerate();
  }

  async function handleUploadFilledSketch(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      // A filled sketch is a CAD-stage asset; open Minibody with it as input.
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "cad",
          status: "approved",
          imageUrl: dataUrl,
          parentId: uploadParentId || null,
          meta: { source: "upload-direct" },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      router.push(startFromHref(data.asset as Asset));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function handleUploadFinishedMinibody(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMinibody(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "minibody",
          status: "approved",
          imageUrl: dataUrl,
          parentId: uploadMinibodyParentId || null,
          meta: { source: "upload-direct" },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      router.push(startFromHref(data.asset as Asset));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploadingMinibody(false);
    } finally {
      if (uploadMinibodyInputRef.current) uploadMinibodyInputRef.current.value = "";
    }
  }

  if (loading) {
    return <p className="text-sm text-cream-muted">Loading…</p>;
  }

  if (!source) {
    return <p className="text-sm text-accent-orange">Asset not found.</p>;
  }

  const sketchOptions = allAssets.filter(
    (a) => a.stage === "sketch" && a.status === "approved"
  );
  const cadOptions = allAssets.filter(
    (a) => a.stage === "cad" && a.status === "approved"
  );
  const generatedHistory = history.slice(1); // exclude the route source itself

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <StageStepper current="minibody" chain={chain} />

      <div className="space-y-0.5">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-cream-muted transition hover:text-cream"
        >
          ← Back
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Minibody</h1>
        <p className="text-sm text-cream-muted">
          Turn a filled sketch into a dimensional product render.
        </p>
      </div>

      <div className="mx-auto grid w-[80%] items-start gap-6 md:grid-cols-2">
        <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
              Filled sketch
            </h2>
            {cadSource?.imageUrl && (
              <DownloadLink
                dataUrl={cadSource.imageUrl}
                filename={`cad-${cadSource.id.slice(0, 8)}.png`}
              />
            )}
          </div>
          <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-navy-50 bg-navy-100">
            {cadSource?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cadSource.imageUrl}
                alt="Filled sketch"
                className="max-h-full max-w-full bg-white object-contain"
              />
            ) : (
              <p className="px-4 text-center text-sm text-cream-muted">
                No filled sketch — upload one below to generate from
              </p>
            )}
          </div>
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
              Minibody render
            </h2>
            {hasRender && current?.imageUrl && (
              <DownloadLink
                dataUrl={current.imageUrl}
                filename={`minibody-${current.id.slice(0, 8)}.png`}
              />
            )}
          </div>
          <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-navy-50 bg-navy-100">
            {generating ? (
              <div className="flex flex-col items-center gap-2 px-4 text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
                <p className="text-sm text-cream-muted">
                  Generating minibody render with Gemini…
                </p>
              </div>
            ) : hasRender ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current!.imageUrl!}
                alt="Minibody render"
                className="max-h-full max-w-full bg-white object-contain"
              />
            ) : (
              <p className="px-4 text-center text-sm text-cream-muted">
                No render yet — click Generate minibody to create one
              </p>
            )}
          </div>
        </section>
      </div>

      {generatedHistory.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
            Versions
          </h2>
          <p className="text-xs text-cream-muted">
            Select a version to continue from. Later versions are hidden;
            Generate again branches from the one you selected.
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {generatedHistory.map((a, i) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setChainFromId(a.id);
                  setDone(a.status === "approved");
                }}
                className={[
                  "shrink-0 overflow-hidden rounded-md border-2 transition",
                  a.id === chainFromId
                    ? "border-accent-blue"
                    : "border-navy-50 hover:border-cream-muted",
                ].join(" ")}
                title={`Version ${i + 1}`}
              >
                {a.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.imageUrl}
                    alt={`Version ${i + 1}`}
                    className="h-16 w-16 bg-white object-contain"
                  />
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <label className="block space-y-2">
        <span className="text-sm font-medium">Generation prompt</span>
        <p className="text-xs text-cream-muted">
          Default instructions are pre-filled — edit them before generating if
          you want a different result.
        </p>
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          rows={3}
          disabled={generating || busy || done}
          className="w-full resize-y rounded-md border border-navy-50 bg-navy-100 px-3 py-2 text-sm text-cream placeholder:text-cream-muted/60 focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue disabled:opacity-50"
        />
      </label>

      {error && (
        <p className="rounded-md border border-accent-orange/40 bg-accent-orange/10 px-3 py-2 text-sm text-accent-orange">
          {error}
        </p>
      )}

      {!hasRender || generating ? (
        <div className="border-t border-navy-50 pt-4">
          <button
            type="button"
            disabled={generating || !source.imageUrl}
            onClick={handleGenerate}
            className="rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-navy transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating ? "Generating…" : "Generate minibody"}
          </button>
        </div>
      ) : (
        <ApprovalBar
          disabled={busy || generating}
          onContinue={() => router.push(`/review/${current!.id}`)}
          continueLabel="Review & Save →"
          onRegenerate={handleRegenerate}
          regenerateLabel="Generate again"
        />
      )}

      <details className="rounded-lg border border-navy-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-cream-muted hover:text-cream">
          Skip CAD Fill — upload your own filled sketch
        </summary>
        <div className="mt-4 space-y-3">
          <p className="text-xs text-cream-muted">
            Use this when you already have a print-filled flat. It becomes the
            filled-sketch input for a new Minibody generation
            {sketchOptions.length > 0
              ? " (optionally linked to a line sketch below)."
              : "."}
          </p>
          {sketchOptions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-cream-muted">
                Link to an existing line sketch (optional)
              </p>
              <AssetThumbPicker
                assets={sketchOptions}
                selectedId={uploadParentId || null}
                allowNone
                noneLabel="Standalone"
                disabled={uploading}
                onSelect={(nextId) => setUploadParentId(nextId ?? "")}
              />
            </div>
          )}
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={handleUploadFilledSketch}
            className="block w-full text-sm text-cream-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent-blue file:px-3 file:py-2 file:text-sm file:font-semibold file:text-navy hover:file:brightness-110 disabled:opacity-40"
          />
          {uploading && (
            <p className="text-xs text-cream-muted">Uploading…</p>
          )}
        </div>
      </details>

      <details className="rounded-lg border border-navy-50 p-4">
        <summary className="cursor-pointer text-sm font-medium text-cream-muted hover:text-cream">
          Already have a finished minibody? Upload it directly
        </summary>
        <div className="mt-4 space-y-3">
          <p className="text-xs text-cream-muted">
            Use this when you already have a finished dimensional render. It
            opens here directly, ready to review or generate again
            {cadOptions.length > 0
              ? " (optionally linked to a CAD-filled sketch below)."
              : "."}
          </p>
          {cadOptions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-cream-muted">
                Link to an existing filled sketch (optional)
              </p>
              <AssetThumbPicker
                assets={cadOptions}
                selectedId={uploadMinibodyParentId || null}
                allowNone
                noneLabel="Standalone"
                disabled={uploadingMinibody}
                onSelect={(nextId) => setUploadMinibodyParentId(nextId ?? "")}
              />
            </div>
          )}
          <input
            ref={uploadMinibodyInputRef}
            type="file"
            accept="image/*"
            disabled={uploadingMinibody}
            onChange={handleUploadFinishedMinibody}
            className="block w-full text-sm text-cream-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent-blue file:px-3 file:py-2 file:text-sm file:font-semibold file:text-navy hover:file:brightness-110 disabled:opacity-40"
          />
          {uploadingMinibody && (
            <p className="text-xs text-cream-muted">Uploading…</p>
          )}
        </div>
      </details>
    </div>
  );
}
