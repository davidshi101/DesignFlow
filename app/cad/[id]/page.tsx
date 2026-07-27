"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StageStepper from "@/components/StageStepper";
import ApprovalBar from "@/components/ApprovalBar";
import type { Asset } from "@/lib/store";
import { getFullChain } from "@/lib/chain";
import {
  clearMask,
  floodFillToMask,
  maskHasContent,
} from "@/lib/floodFill";
import {
  BATCH_HUES,
  BATCH_SCALES,
  DEFAULT_CAD_CONTROLS,
  PRINTS,
  type CadControls,
  type PrintId,
} from "@/lib/prints";

interface VariantThumb {
  id: string;
  dataUrl: string;
  scale: number;
  hue: number;
}

interface SketchLayout {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

// Defensive upper bound only — Gemini caps real output around 1024x1024.
const MAX_LOGICAL_DIM = 2048;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function fitSketch(
  canvasW: number,
  canvasH: number,
  sketch: HTMLImageElement
): SketchLayout {
  const fit = Math.min(canvasW / sketch.width, canvasH / sketch.height);
  const sw = sketch.width * fit;
  const sh = sketch.height * fit;
  return {
    sx: (canvasW - sw) / 2,
    sy: (canvasH - sh) / 2,
    sw,
    sh,
  };
}

function buildPrintTile(
  print: HTMLImageElement,
  controls: CadControls
): HTMLCanvasElement {
  const tileSize = Math.max(24, Math.round(64 * controls.scale));
  const tile = document.createElement("canvas");
  tile.width = tileSize;
  tile.height = tileSize;
  const tctx = tile.getContext("2d")!;
  tctx.translate(tileSize / 2, tileSize / 2);
  if (controls.mirrored) tctx.scale(-1, 1);
  tctx.rotate((controls.rotation * Math.PI) / 180);
  tctx.filter = `hue-rotate(${controls.hue}deg)`;
  tctx.drawImage(print, -tileSize / 2, -tileSize / 2, tileSize, tileSize);
  return tile;
}

/**
 * Size a canvas's backing store for crisp drawing at `logicalWidth/Height`
 * (native sketch resolution) — display size is controlled purely by CSS
 * (w-full h-auto on the element) so on-screen scaling never touches the
 * resolution used for drawing or export.
 */
function configureHiDpiCanvas(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
): { dpr: number } {
  canvas.width = Math.round(logicalWidth * dpr);
  canvas.height = Math.round(logicalHeight * dpr);
  return { dpr };
}

function getHiDpiContext(
  canvas: HTMLCanvasElement,
  dpr: number
): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  return ctx;
}

/**
 * Draw sketch + print clipped to garment mask (destination-in).
 * `logicalWidth`/`logicalHeight` are the drawing-space dimensions; canvas
 * backing store should already be sized with configureHiDpiCanvas.
 */
function renderCadToCanvas(
  canvas: HTMLCanvasElement,
  sketch: HTMLImageElement,
  print: HTMLImageElement,
  controls: CadControls,
  maskCanvas: HTMLCanvasElement | null,
  logicalWidth: number,
  logicalHeight: number,
  dpr: number
) {
  const ctx = getHiDpiContext(canvas, dpr);
  const layout = fitSketch(logicalWidth, logicalHeight, sketch);

  ctx.clearRect(0, 0, logicalWidth, logicalHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, logicalWidth, logicalHeight);
  ctx.drawImage(sketch, layout.sx, layout.sy, layout.sw, layout.sh);

  if (
    !maskCanvas ||
    maskCanvas.width !== logicalWidth ||
    maskCanvas.height !== logicalHeight
  ) {
    return;
  }

  // 1) Print pattern layer (logical pixels)
  const printLayer = document.createElement("canvas");
  printLayer.width = logicalWidth;
  printLayer.height = logicalHeight;
  const pctx = printLayer.getContext("2d")!;
  const tile = buildPrintTile(print, controls);
  const pattern = pctx.createPattern(tile, "repeat");
  if (pattern) {
    pctx.fillStyle = pattern;
    pctx.fillRect(0, 0, logicalWidth, logicalHeight);
  }

  // 2) Clip print to mask via destination-in
  pctx.globalCompositeOperation = "destination-in";
  pctx.drawImage(maskCanvas, 0, 0);

  // 3) Composite clipped print over base sketch
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(printLayer, 0, 0, logicalWidth, logicalHeight);
  ctx.restore();

  // Keep line art crisp on top
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.9;
  ctx.drawImage(sketch, layout.sx, layout.sy, layout.sw, layout.sh);
  ctx.restore();
}

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export default function CadPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sketchBufferRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sketchRef = useRef<HTMLImageElement | null>(null);
  const printCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const logicalSizeRef = useRef({ w: 0, h: 0 });
  const dprRef = useRef(1);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [chain, setChain] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [controls, setControls] = useState<CadControls>(DEFAULT_CAD_CONTROLS);
  const [showVariants, setShowVariants] = useState(false);
  const [variants, setVariants] = useState<VariantThumb[]>([]);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fillCount, setFillCount] = useState(0);
  const [hint, setHint] = useState(
    "Click inside the garment outline to fill a region with the print."
  );

  const getPrint = useCallback(async (printId: PrintId) => {
    const meta = PRINTS.find((p) => p.id === printId)!;
    const cached = printCache.current.get(meta.src);
    if (cached) return cached;
    const img = await loadImage(meta.src);
    printCache.current.set(meta.src, img);
    return img;
  }, []);

  const ensureBuffers = useCallback((w: number, h: number) => {
    if (!sketchBufferRef.current) {
      sketchBufferRef.current = document.createElement("canvas");
    }
    if (!maskCanvasRef.current) {
      maskCanvasRef.current = document.createElement("canvas");
    }
    const sketchBuf = sketchBufferRef.current;
    const mask = maskCanvasRef.current;
    if (sketchBuf.width !== w || sketchBuf.height !== h) {
      sketchBuf.width = w;
      sketchBuf.height = h;
    }
    if (mask.width !== w || mask.height !== h) {
      mask.width = w;
      mask.height = h;
      const mctx = mask.getContext("2d")!;
      mctx.clearRect(0, 0, w, h);
      setFillCount(0);
    }
  }, []);

  const paintSketchBuffer = useCallback(() => {
    const sketch = sketchRef.current;
    const buf = sketchBufferRef.current;
    if (!sketch || !buf) return;
    const ctx = buf.getContext("2d")!;
    const layout = fitSketch(buf.width, buf.height, sketch);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, buf.width, buf.height);
    ctx.drawImage(sketch, layout.sx, layout.sy, layout.sw, layout.sh);
  }, []);

  const redraw = useCallback(async () => {
    const canvas = canvasRef.current;
    const sketch = sketchRef.current;
    const { w: logicalW, h: logicalH } = logicalSizeRef.current;
    if (!canvas || !sketch || !logicalW || !logicalH) return;
    try {
      const print = await getPrint(controls.printId);
      renderCadToCanvas(
        canvas,
        sketch,
        print,
        controls,
        maskCanvasRef.current,
        logicalW,
        logicalH,
        dprRef.current
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Render failed");
    }
  }, [controls, getPrint]);

  // Fetch asset + chain data. Deliberately does NOT touch canvasRef here —
  // the <canvas> element doesn't exist in the DOM yet while `loading` is
  // still true (this component early-returns a "Loading…" placeholder), so
  // reading canvasRef.current in this effect would always see null.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [oneRes, allRes] = await Promise.all([
          fetch(`/api/assets?id=${id}`),
          fetch("/api/assets"),
        ]);
        const oneData = await oneRes.json();
        const allData = await allRes.json();
        if (cancelled) return;

        const a: Asset | null = oneData.asset ?? null;
        setAsset(a);
        setChain(getFullChain(allData.assets ?? [], id));
      } catch {
        if (!cancelled) setAsset(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Runs once `asset` is set and the canvas has actually mounted (loading
  // is false by then, in the same batched update as `asset`) — loads the
  // sketch image, sizes the canvas at native resolution, and paints it.
  useEffect(() => {
    if (!asset?.imageUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const sketch = await loadImage(asset.imageUrl!);
        if (cancelled) return;
        sketchRef.current = sketch;
        const canvas = canvasRef.current;
        if (canvas) {
          const logicalW = Math.min(sketch.width, MAX_LOGICAL_DIM) || 1024;
          const logicalH = Math.min(sketch.height, MAX_LOGICAL_DIM) || 1024;
          const { dpr } = configureHiDpiCanvas(canvas, logicalW, logicalH);
          dprRef.current = dpr;
          logicalSizeRef.current = { w: logicalW, h: logicalH };
          ensureBuffers(logicalW, logicalH);
          paintSketchBuffer();
          await redraw();
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load sketch");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asset, ensureBuffers, paintSketchBuffer, redraw]);

  useEffect(() => {
    if (!loading && sketchRef.current) {
      redraw();
    }
  }, [loading, redraw, fillCount]);

  function patchControls(patch: Partial<CadControls>) {
    setControls((c) => ({ ...c, ...patch }));
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const sketchBuf = sketchBufferRef.current;
    const mask = maskCanvasRef.current;
    const { w: logicalW, h: logicalH } = logicalSizeRef.current;
    if (!canvas || !sketchBuf || !mask || !logicalW || !logicalH) return;

    const rect = canvas.getBoundingClientRect();
    // Map click in rendered (CSS) pixels to logical drawing pixels — works
    // regardless of how large/small the canvas is actually displayed.
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * logicalW);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * logicalH);

    const sctx = sketchBuf.getContext("2d")!;
    const mctx = mask.getContext("2d")!;
    const source = sctx.getImageData(0, 0, sketchBuf.width, sketchBuf.height);
    const maskData = mctx.getImageData(0, 0, mask.width, mask.height);

    const added = floodFillToMask(source, maskData, x, y);
    if (added === 0) {
      setHint(
        "No fill — click a white area inside a closed garment outline (not on a black line, and not a region already filled)."
      );
      return;
    }

    mctx.putImageData(maskData, 0, 0);
    setFillCount((n) => n + 1);
    setHint(
      "Region added. Click another enclosed area (e.g. a sleeve) to add more, or adjust the print controls."
    );
    setError(null);
  }

  function resetToDefaults() {
    const mask = maskCanvasRef.current;
    if (mask) {
      const mctx = mask.getContext("2d")!;
      const data = mctx.getImageData(0, 0, mask.width, mask.height);
      clearMask(data);
      mctx.putImageData(data, 0, 0);
    }
    setFillCount(0);
    setVariants([]);
    setShowVariants(false);
    setControls(DEFAULT_CAD_CONTROLS);
    setHint("Mask cleared. Click inside the garment to fill again.");
  }

  async function handleGenerateVariants() {
    const sketch = sketchRef.current;
    const mask = maskCanvasRef.current;
    const { w: logicalW, h: logicalH } = logicalSizeRef.current;
    if (!sketch || !mask || !logicalW || !logicalH) return;

    const mctx = mask.getContext("2d")!;
    if (!maskHasContent(mctx.getImageData(0, 0, mask.width, mask.height))) {
      setError(
        "Fill at least one garment region by clicking inside the outline first."
      );
      return;
    }

    setError(null);
    const print = await getPrint(controls.printId);
    const thumbs: VariantThumb[] = [];
    const off = document.createElement("canvas");
    const dpr = dprRef.current;
    configureHiDpiCanvas(off, logicalW, logicalH, dpr);

    for (const scale of BATCH_SCALES) {
      for (const hue of BATCH_HUES) {
        const variant: CadControls = { ...controls, scale, hue };
        renderCadToCanvas(
          off,
          sketch,
          print,
          variant,
          mask,
          logicalW,
          logicalH,
          dpr
        );
        thumbs.push({
          id: `${controls.printId}-${scale}-${hue}`,
          dataUrl: off.toDataURL("image/png"),
          scale,
          hue,
        });
      }
    }
    setVariants(thumbs);
  }

  function applyVariant(thumb: VariantThumb) {
    patchControls({ scale: thumb.scale, hue: thumb.hue });
    setShowVariants(false);
  }

  function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    triggerDownload(canvas.toDataURL("image/png"), `cad-fill-${id.slice(0, 8)}.png`);
  }

  async function handleApproveLive() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setApproving(true);
    setError(null);
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "cad",
          parentId: id,
          imageUrl: dataUrl,
          status: "approved",
          meta: {
            printId: controls.printId,
            scale: controls.scale,
            rotation: controls.rotation,
            mirrored: controls.mirrored,
            colorway: controls.hue,
            sourceSketchId: id,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to approve");
      router.push(`/minibody/${data.asset.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
      setApproving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-cream-muted">Loading…</p>;
  }

  if (!asset) {
    return <p className="text-sm text-accent-orange">Asset not found.</p>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <StageStepper current="cad" chain={chain} />

      <div className="space-y-2">
        <Link
          href={`/sketch/${id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-cream-muted transition hover:text-cream"
        >
          ← Back to Line Sketch
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">CAD Fill</h1>
        <p className="text-sm text-cream-muted">
          Click inside closed garment regions to build a silhouette mask, then
          apply a print fill.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <div className="mx-auto max-w-[640px] overflow-hidden rounded-lg border border-navy-50 bg-white">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="block h-auto w-full cursor-crosshair"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-cream-muted">{hint}</p>
            <button
              type="button"
              onClick={handleDownload}
              disabled={fillCount === 0}
              className="shrink-0 text-xs font-medium text-accent-blue transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Download
            </button>
          </div>
          {!asset.imageUrl && (
            <p className="text-sm text-accent-orange">
              This asset has no sketch image to fill.
            </p>
          )}
        </div>

        <aside className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
              Silhouette mask
            </h2>
            <p className="text-xs text-cream-muted">
              Regions filled: <span className="text-cream">{fillCount}</span>
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
              Print
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {PRINTS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => patchControls({ printId: p.id })}
                  className={[
                    "overflow-hidden rounded-md border p-1 transition",
                    controls.printId === p.id
                      ? "border-accent-blue ring-1 ring-accent-blue"
                      : "border-navy-50 hover:border-cream-muted",
                  ].join(" ")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.src}
                    alt={p.label}
                    className="aspect-square w-full object-cover"
                  />
                  <span className="mt-1 block text-center text-[10px] text-cream-muted">
                    {p.label}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
              Controls
            </h2>

            <label className="block space-y-1">
              <div className="flex justify-between text-xs text-cream-muted">
                <span>Scale</span>
                <span>{Math.round(controls.scale * 100)}%</span>
              </div>
              <input
                type="range"
                min={50}
                max={200}
                value={Math.round(controls.scale * 100)}
                onChange={(e) =>
                  patchControls({ scale: Number(e.target.value) / 100 })
                }
                className="w-full accent-accent-blue"
              />
            </label>

            <label className="block space-y-1">
              <div className="flex justify-between text-xs text-cream-muted">
                <span>Rotation</span>
                <span>{controls.rotation}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={360}
                value={controls.rotation}
                onChange={(e) =>
                  patchControls({ rotation: Number(e.target.value) })
                }
                className="w-full accent-accent-blue"
              />
            </label>

            <label className="block space-y-1">
              <div className="flex justify-between text-xs text-cream-muted">
                <span>Recolor (hue)</span>
                <span>{controls.hue}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={360}
                value={controls.hue}
                onChange={(e) =>
                  patchControls({ hue: Number(e.target.value) })
                }
                className="w-full accent-accent-orange"
              />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={controls.mirrored}
                onChange={(e) =>
                  patchControls({ mirrored: e.target.checked })
                }
                className="accent-accent-blue"
              />
              Mirror print
            </label>
          </section>

          <button
            type="button"
            onClick={() => {
              if (!showVariants) handleGenerateVariants();
              setShowVariants((v) => !v);
            }}
            disabled={!asset.imageUrl || fillCount === 0}
            className="w-full rounded-md border border-navy-50 px-3 py-2 text-sm text-cream-muted transition hover:border-cream-muted hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
          >
            {showVariants ? "Hide print variants" : "Explore print variants (optional)"}
          </button>
        </aside>
      </div>

      {error && (
        <p className="rounded-md border border-accent-orange/40 bg-accent-orange/10 px-3 py-2 text-sm text-accent-orange">
          {error}
        </p>
      )}

      {showVariants && variants.length > 0 && (
        <section className="space-y-4 border-t border-navy-50 pt-6">
          <h2 className="text-sm font-medium uppercase tracking-wider text-cream-muted">
            Print variants — click one to load it onto the canvas
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {variants.map((thumb) => (
              <button
                key={thumb.id}
                type="button"
                onClick={() => applyVariant(thumb)}
                className="overflow-hidden rounded-lg border border-navy-50 bg-white text-left transition hover:border-accent-blue"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumb.dataUrl}
                  alt={`Variant scale ${thumb.scale} hue ${thumb.hue}`}
                  className="aspect-square w-full object-contain"
                />
                <div className="px-2 py-1.5 text-[10px] text-cream-muted">
                  {Math.round(thumb.scale * 100)}% · hue {thumb.hue}°
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <ApprovalBar
        disabled={fillCount === 0 || approving}
        onApprove={handleApproveLive}
        onDiscard={resetToDefaults}
        approveLabel={approving ? "Approving…" : "Approve → Minibody"}
      />
    </div>
  );
}
