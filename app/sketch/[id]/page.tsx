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
import { DEFAULT_SKETCH_PROMPT } from "@/lib/prompts";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

const DEFAULT_ERASE_BRUSH_SIZE = 40;

/** Slice a root-first chain down to this page's generation history starting
 * at `id`. getFullChain's forward-walk continues across pipeline stages (e.g.
 * sketch → CAD), so we only keep consecutive *sketch* entries after `id` —
 * comparing against this page's output stage, not `id`'s own stage. Otherwise:
 * (1) a sketch that already has a CAD child would wrongly tip to that CAD
 * asset, and (2) a garment-id entry (the normal first-gen path) would drop
 * every sketch child and the Result panel would stay empty after Generate. */
function ownHistoryFrom(chain: Asset[], id: string): Asset[] {
  const idx = chain.findIndex((a) => a.id === id);
  if (idx < 0) return chain;
  const result = [chain[idx]];
  for (let i = idx + 1; i < chain.length; i++) {
    if (chain[i].stage !== "sketch") break;
    result.push(chain[i]);
  }
  return result;
}

export default function SketchPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const router = useRouter();
  const searchParams = useSearchParams();
  const fresh = searchParams.get("fresh") === "1";
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const eraseCanvasRef = useRef<HTMLCanvasElement>(null);
  const eraseDprRef = useRef(1);

  const [source, setSource] = useState<Asset | null>(null);
  const [garmentSource, setGarmentSource] = useState<Asset | null>(null);
  const [allAssets, setAllAssets] = useState<Asset[]>([]);
  const [chain, setChain] = useState<Asset[]>([]);
  const [chainFromId, setChainFromId] = useState(id);
  const [backHref, setBackHref] = useState("/");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptText, setPromptText] = useState(DEFAULT_SKETCH_PROMPT);
  const [uploading, setUploading] = useState(false);
  const [eraseMode, setEraseMode] = useState(false);
  const [eraseBrushSize, setEraseBrushSize] = useState(DEFAULT_ERASE_BRUSH_SIZE);
  const [savingErase, setSavingErase] = useState(false);
  /** Screen-space erase brush preview (null when pointer is off-canvas). */
  const [eraseCursor, setEraseCursor] = useState<{
    x: number;
    y: number;
    scale: number;
  } | null>(null);

  // Full active path tip, then truncate at the selected version so later
  // siblings disappear from Versions until the user generates again from here.
  const fullOwnHistory = ownHistoryFrom(chain, id);
  const selectedIdx = fullOwnHistory.findIndex((a) => a.id === chainFromId);
  const history =
    selectedIdx >= 0 ? fullOwnHistory.slice(0, selectedIdx + 1) : fullOwnHistory;
  const current = history.find((a) => a.id === chainFromId) ?? source;
  // A real sketch to show/iterate on exists whenever `current` is itself at
  // the sketch stage — true both for a freshly-generated result AND for an
  // asset that arrived already at this stage (direct upload, or back-nav
  // from CAD Fill) — both cases should behave identically: show the image
  // and allow Generate again / Erase / Continue from it.
  const hasSketch = Boolean(current?.imageUrl) && current?.stage === "sketch";

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
      // this garment already has sketch children from earlier runs.
      setChainFromId(fresh ? id : tip[tip.length - 1]?.id ?? id);

      if (src?.stage === "garment") {
        setGarmentSource(src);
        setBackHref("/");
      } else {
        // A sketch-stage id (direct upload, or reached via back-nav/regen
        // chaining) isn't itself the garment photo — walk ancestors past
        // any same-stage hops (regenerations) to the real garment source,
        // exactly as ownHistoryFrom stops the forward walk at that boundary.
        const ancestry = src?.parentId
          ? getAncestorChain(allAssetsList, src.parentId)
          : [];
        const garmentAncestor = [...ancestry]
          .reverse()
          .find((a) => a.stage === "garment");
        setGarmentSource(garmentAncestor ?? null);
        setBackHref(garmentAncestor ? `/sketch/${garmentAncestor.id}` : "/");
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
    setPromptText(DEFAULT_SKETCH_PROMPT);
  }, [id]);

  // Loads the currently-selected sketch into the erase canvas at native
  // resolution whenever erase touch-up mode is switched on. Backing store is
  // device-pixel sized; drawing uses identity transform in device pixels so
  // erase strokes always land where the cursor is.
  useEffect(() => {
    if (!eraseMode || !current?.imageUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const img = await loadImage(current!.imageUrl!);
        if (cancelled) return;
        const canvas = eraseCanvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        eraseDprRef.current = dpr;
        canvas.width = Math.round(img.naturalWidth * dpr);
        canvas.height = Math.round(img.naturalHeight * dpr);
        const ctx = canvas.getContext("2d")!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      } catch {
        if (!cancelled) setError("Failed to load image for touch-up");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eraseMode, current?.imageUrl]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-sketch", {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegenerate() {
    await handleGenerate();
  }

  async function handleContinue() {
    if (!current) return;
    setBusy(true);
    await fetch("/api/assets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: current.id, status: "pending" }),
    });
    router.push(`/cad/${current.id}`);
  }

  async function handleSaveErase() {
    const canvas = eraseCanvasRef.current;
    if (!canvas || !current) return;
    setSavingErase(true);
    setError(null);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "sketch",
          parentId: current.id,
          status: "draft",
          imageUrl: dataUrl,
          meta: { source: "erase-edit" },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      const updated = [...allAssets, data.asset as Asset];
      setAllAssets(updated);
      setChain(getFullChain(updated, id));
      setChainFromId(data.asset.id);
      setEraseMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingErase(false);
    }
  }

  function updateEraseCursor(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const dpr = eraseDprRef.current || 1;
    const logicalW = canvas.width / dpr;
    setEraseCursor({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      scale: logicalW > 0 ? rect.width / logicalW : 1,
    });
  }

  function handleErasePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = eraseCanvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    updateEraseCursor(e);

    const ctx = canvas.getContext("2d")!;
    // Always draw in device-pixel space so strokes aren't affected by any
    // leftover CTM from the image load (or a prior stroke).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const brushDevice = eraseBrushSize * (eraseDprRef.current || 1);
    ctx.lineWidth = brushDevice;

    const toDevice = (clientX: number, clientY: number) => ({
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    });

    let last = toDevice(e.clientX, e.clientY);
    ctx.beginPath();
    ctx.arc(last.x, last.y, brushDevice / 2, 0, Math.PI * 2);
    ctx.fill();

    function onMove(ev: PointerEvent) {
      const r = canvas!.getBoundingClientRect();
      const dpr = eraseDprRef.current || 1;
      const logicalW = canvas!.width / dpr;
      setEraseCursor({
        x: ev.clientX - r.left,
        y: ev.clientY - r.top,
        scale: logicalW > 0 ? r.width / logicalW : 1,
      });
      const pt = toDevice(ev.clientX, ev.clientY);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      last = pt;
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function handleUploadSketch(e: React.ChangeEvent<HTMLInputElement>) {
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
          stage: "sketch",
          status: "approved",
          imageUrl: dataUrl,
          parentId: null,
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

  if (loading) {
    return <p className="text-sm text-cream-muted">Loading…</p>;
  }

  if (!source) {
    return <p className="text-sm text-accent-orange">Asset not found.</p>;
  }

  const previousSketches = allAssets
    .filter((a) => a.stage === "sketch" && a.status === "approved" && a.id !== id)
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  const generatedHistory = history.slice(1); // exclude the route source itself

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <StageStepper current="sketch" chain={chain} />

      <div className="space-y-0.5">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-cream-muted transition hover:text-cream"
        >
          ← Back
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Line Sketch</h1>
        <p className="text-sm text-cream-muted">
          Turn a garment photo into a clean line-art flat — or start from a
          sketch you already have.
        </p>
      </div>

      <div className="mx-auto grid w-[80%] items-start gap-6 md:grid-cols-2">
        <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
              Original garment
            </h2>
            {garmentSource?.imageUrl && (
              <DownloadLink
                dataUrl={garmentSource.imageUrl}
                filename={`garment-${garmentSource.id.slice(0, 8)}.png`}
              />
            )}
          </div>
          <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-navy-50 bg-navy-100">
            {garmentSource?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={garmentSource.imageUrl}
                alt="Original garment"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <p className="px-4 text-center text-sm text-cream-muted">
                No garment photo — you uploaded a sketch directly
              </p>
            )}
          </div>
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
              Line sketch
            </h2>
            {hasSketch && current?.imageUrl && (
              <DownloadLink
                dataUrl={current.imageUrl}
                filename={`sketch-${current.id.slice(0, 8)}.png`}
              />
            )}
          </div>
          <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-navy-50 bg-navy-100">
            {generating ? (
              <div className="flex flex-col items-center gap-2 px-4 text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
                <p className="text-sm text-cream-muted">
                  Generating line sketch with Gemini…
                </p>
              </div>
            ) : hasSketch ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current!.imageUrl!}
                alt="Line sketch"
                className="max-h-full max-w-full bg-white object-contain"
              />
            ) : (
              <p className="px-4 text-center text-sm text-cream-muted">
                No sketch yet — click Generate sketch to create one
              </p>
            )}
            {hasSketch && !generating && !eraseMode && (
              <button
                type="button"
                onClick={() => setEraseMode(true)}
                className="absolute bottom-2 right-2 z-10 rounded-md border border-navy-50 bg-navy/90 px-2.5 py-1 text-xs font-medium text-accent-blue shadow-sm backdrop-blur transition hover:brightness-110"
              >
                Erase part of this…
              </button>
            )}
          </div>
        </section>
      </div>

      {hasSketch && eraseMode && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-navy/95 p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Erase touch-up"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-cream">Erase touch-up</h2>
              <p className="text-xs text-cream-muted">
                Paint white over areas to remove. Save when done.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-w-[12rem] flex-1 items-center gap-2 text-xs text-cream-muted sm:flex-none">
                <span className="shrink-0">Brush size</span>
                <input
                  type="range"
                  min={8}
                  max={160}
                  value={eraseBrushSize}
                  onChange={(e) => setEraseBrushSize(Number(e.target.value))}
                  className="w-full accent-accent-blue sm:w-40"
                />
                <span className="shrink-0">{eraseBrushSize}px</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setEraseCursor(null);
                  setEraseMode(false);
                }}
                className="rounded-md border border-navy-50 px-3 py-1.5 text-xs font-medium text-cream-muted transition hover:border-cream-muted hover:text-cream"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingErase}
                onClick={handleSaveErase}
                className="rounded-md bg-accent-blue px-3 py-1.5 text-xs font-semibold text-navy transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingErase ? "Saving…" : "Save touch-up"}
              </button>
            </div>
          </div>
          <div className="mx-auto mt-4 flex min-h-0 w-full max-w-6xl flex-1 items-center justify-center">
            <div className="relative max-h-full max-w-full overflow-hidden rounded-lg border border-navy-50 bg-white shadow-lg">
              <canvas
                ref={eraseCanvasRef}
                onPointerDown={handleErasePointerDown}
                onPointerMove={updateEraseCursor}
                onPointerLeave={() => setEraseCursor(null)}
                className="block max-h-[min(80vh,56rem)] max-w-full cursor-none bg-white"
              />
              {eraseCursor && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute rounded-full border-[1.5px] border-black"
                  style={{
                    left: eraseCursor.x,
                    top: eraseCursor.y,
                    width: eraseBrushSize * eraseCursor.scale,
                    height: eraseBrushSize * eraseCursor.scale,
                    transform: "translate(-50%, -50%)",
                    boxShadow: "0 0 0 1px rgba(255,255,255,0.95)",
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

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
                  setEraseMode(false);
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

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Generation prompt</span>
        <p className="text-xs text-cream-muted">
          Default instructions are pre-filled — edit them before generating if
          you want a different result.
        </p>
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          rows={3}
          disabled={generating || busy || eraseMode}
          className="w-full resize-y rounded-md border border-navy-50 bg-navy-100 px-3 py-2 text-sm text-cream placeholder:text-cream-muted/60 focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue disabled:opacity-50"
        />
      </label>

      {error && (
        <p className="rounded-md border border-accent-orange/40 bg-accent-orange/10 px-3 py-2 text-sm text-accent-orange">
          {error}
        </p>
      )}

      {!hasSketch || generating ? (
        <div className="border-t border-navy-50 pt-4">
          <button
            type="button"
            disabled={generating || !source.imageUrl}
            onClick={handleGenerate}
            className="rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-navy transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating ? "Generating…" : "Generate sketch"}
          </button>
        </div>
      ) : (
        <ApprovalBar
          disabled={busy || generating || eraseMode}
          onContinue={handleContinue}
          continueLabel="Continue to CAD Fill →"
          onRegenerate={handleRegenerate}
          regenerateLabel="Generate again"
        />
      )}

      <section className="space-y-3 rounded-lg border border-navy-50 p-4">
        <h2 className="text-sm font-medium text-cream">
          Use your own line sketch
        </h2>
        <p className="text-xs text-cream-muted">
          {previousSketches.length > 0
            ? "Pick from previous sketches, or upload a new file."
            : "Upload a line sketch to use instead."}
        </p>
        {previousSketches.length > 0 && (
          <AssetThumbPicker
            assets={previousSketches}
            disabled={uploading}
            onSelect={(nextId) => {
              if (!nextId) return;
              const asset = previousSketches.find((s) => s.id === nextId);
              if (asset) router.push(startFromHref(asset));
            }}
          />
        )}
        <label className="inline-flex cursor-pointer items-center">
          <span className="rounded-md bg-accent-blue px-3 py-2 text-sm font-semibold text-navy transition hover:brightness-110">
            {uploading ? "Uploading…" : "Choose Line Sketch"}
          </span>
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={handleUploadSketch}
            className="sr-only"
          />
        </label>
      </section>
    </div>
  );
}
