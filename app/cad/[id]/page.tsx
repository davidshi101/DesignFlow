"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StageStepper from "@/components/StageStepper";
import ApprovalBar from "@/components/ApprovalBar";
import type { Asset } from "@/lib/store";
import type { Print } from "@/lib/printStore";
import { getFullChain } from "@/lib/chain";
import { floodFillToMask, maskHasContent } from "@/lib/floodFill";

type Placement = "tile" | "single";

interface SingleRect {
  x: number; // logical px, center
  y: number;
  width: number;
  height: number;
}

interface CadLayer {
  id: string;
  printId: string | null;
  placement: Placement;
  scale: number; // tile mode only
  rotation: number; // both modes
  hue: number; // both modes
  mirrored: boolean; // both modes
  single: SingleRect; // single mode only
}

interface SketchLayout {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

// Defensive upper bound only — Gemini caps real output around 1024x1024.
const MAX_LOGICAL_DIM = 2048;
const MIN_SINGLE_SIZE = 16;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
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

/** Mirror + scale baked in; rotation is deliberately NOT baked in here — see
 * buildRotatedTileLayer, which rotates the whole repeated sheet as one image
 * instead of rotating the content inside each tile square. */
function buildPrintTile(
  print: HTMLImageElement,
  layer: CadLayer
): HTMLCanvasElement {
  const tileSize = Math.max(24, Math.round(64 * layer.scale));
  const tile = document.createElement("canvas");
  tile.width = tileSize;
  tile.height = tileSize;
  const tctx = tile.getContext("2d")!;
  tctx.translate(tileSize / 2, tileSize / 2);
  if (layer.mirrored) tctx.scale(-1, 1);
  tctx.filter = `hue-rotate(${layer.hue}deg)`;
  tctx.drawImage(print, -tileSize / 2, -tileSize / 2, tileSize, tileSize);
  return tile;
}

/**
 * Tile the pattern across an oversized square buffer, rotate that WHOLE
 * sheet as one image, then crop the centered logical-size window back out.
 * Oversizing first (with a small safety margin) guarantees the cropped
 * window stays fully covered by pattern at any rotation angle — no blank
 * corners, and no visible seams at tile boundaries since the grid itself
 * rotates coherently rather than each tile square rotating individually.
 */
function buildRotatedTileLayer(
  tile: HTMLCanvasElement,
  rotationDeg: number,
  logicalW: number,
  logicalH: number
): HTMLCanvasElement {
  const side = Math.ceil(Math.hypot(logicalW, logicalH) * 1.1) || 1;

  const sheet = document.createElement("canvas");
  sheet.width = side;
  sheet.height = side;
  const sctx = sheet.getContext("2d")!;
  const pattern = sctx.createPattern(tile, "repeat");
  if (pattern) {
    sctx.fillStyle = pattern;
    sctx.fillRect(0, 0, side, side);
  }

  const rotated = document.createElement("canvas");
  rotated.width = side;
  rotated.height = side;
  const rctx = rotated.getContext("2d")!;
  rctx.translate(side / 2, side / 2);
  rctx.rotate((rotationDeg * Math.PI) / 180);
  rctx.drawImage(sheet, -side / 2, -side / 2);

  const out = document.createElement("canvas");
  out.width = logicalW;
  out.height = logicalH;
  const octx = out.getContext("2d")!;
  octx.drawImage(
    rotated,
    (side - logicalW) / 2,
    (side - logicalH) / 2,
    logicalW,
    logicalH,
    0,
    0,
    logicalW,
    logicalH
  );
  return out;
}

/** Draw the print once at its stored position/size — already "one whole
 * picture," so no oversizing trick needed (only tiling has the seam issue). */
function renderSingleLayer(
  print: HTMLImageElement,
  layer: CadLayer,
  logicalW: number,
  logicalH: number
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = logicalW;
  out.height = logicalH;
  const ctx = out.getContext("2d")!;
  ctx.save();
  ctx.translate(layer.single.x, layer.single.y);
  if (layer.mirrored) ctx.scale(-1, 1);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.filter = `hue-rotate(${layer.hue}deg)`;
  ctx.drawImage(
    print,
    -layer.single.width / 2,
    -layer.single.height / 2,
    layer.single.width,
    layer.single.height
  );
  ctx.restore();
  return out;
}

function compositeLayer(
  ctx: CanvasRenderingContext2D,
  layerCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  logicalW: number,
  logicalH: number
) {
  const clipped = document.createElement("canvas");
  clipped.width = logicalW;
  clipped.height = logicalH;
  const cctx = clipped.getContext("2d")!;
  cctx.drawImage(layerCanvas, 0, 0);
  cctx.globalCompositeOperation = "destination-in";
  cctx.drawImage(maskCanvas, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(clipped, 0, 0, logicalW, logicalH);
  ctx.restore();
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

async function renderLayersToCanvas(
  canvas: HTMLCanvasElement,
  sketch: HTMLImageElement,
  layers: CadLayer[],
  layerMasks: Map<string, HTMLCanvasElement>,
  printImages: Map<string, HTMLImageElement>,
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

  for (const layer of layers) {
    if (!layer.printId) continue;
    const mask = layerMasks.get(layer.id);
    if (!mask) continue;
    const print = printImages.get(layer.printId);
    if (!print) continue;

    const layerCanvas =
      layer.placement === "tile"
        ? buildRotatedTileLayer(
            buildPrintTile(print, layer),
            layer.rotation,
            logicalWidth,
            logicalHeight
          )
        : renderSingleLayer(print, layer, logicalWidth, logicalHeight);

    compositeLayer(ctx, layerCanvas, mask, logicalWidth, logicalHeight);
  }

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

function layerHasFill(mask: HTMLCanvasElement | undefined): boolean {
  if (!mask) return false;
  const ctx = mask.getContext("2d")!;
  return maskHasContent(ctx.getImageData(0, 0, mask.width, mask.height));
}

function createLayer(logicalW: number, logicalH: number): CadLayer {
  const size = Math.round(Math.min(logicalW, logicalH) * 0.25);
  return {
    id: crypto.randomUUID(),
    printId: null,
    placement: "tile",
    scale: 1,
    rotation: 0,
    hue: 0,
    mirrored: false,
    single: { x: logicalW / 2, y: logicalH / 2, width: size, height: size },
  };
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
  const sketchRef = useRef<HTMLImageElement | null>(null);
  const layerMasksRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const printImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const logicalSizeRef = useRef({ w: 0, h: 0 });
  const dprRef = useRef(1);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [chain, setChain] = useState<Asset[]>([]);
  const [prints, setPrints] = useState<Print[]>([]);
  const [layers, setLayers] = useState<CadLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(
    "Add a layer, then click inside the garment outline to fill a region for it."
  );

  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? null;

  const getPrintImage = useCallback(
    async (printId: string): Promise<HTMLImageElement | null> => {
      const meta = prints.find((p) => p.id === printId);
      if (!meta) return null;
      const cached = printImagesRef.current.get(meta.src);
      if (cached) return cached;
      const img = await loadImage(meta.src);
      printImagesRef.current.set(meta.src, img);
      return img;
    },
    [prints]
  );

  const ensureSketchBuffer = useCallback((w: number, h: number) => {
    if (!sketchBufferRef.current) {
      sketchBufferRef.current = document.createElement("canvas");
    }
    const buf = sketchBufferRef.current;
    if (buf.width !== w || buf.height !== h) {
      buf.width = w;
      buf.height = h;
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
      const entries = await Promise.all(
        layers
          .filter((l) => l.printId)
          .map(
            async (l) =>
              [l.printId as string, await getPrintImage(l.printId as string)] as const
          )
      );
      const printImages = new Map(
        entries.filter((e): e is [string, HTMLImageElement] => !!e[1])
      );
      await renderLayersToCanvas(
        canvas,
        sketch,
        layers,
        layerMasksRef.current,
        printImages,
        logicalW,
        logicalH,
        dprRef.current
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Render failed");
    }
  }, [layers, getPrintImage]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [oneRes, allRes, printsRes] = await Promise.all([
          fetch(`/api/assets?id=${id}`),
          fetch("/api/assets"),
          fetch("/api/prints"),
        ]);
        const oneData = await oneRes.json();
        const allData = await allRes.json();
        const printsData = await printsRes.json();
        if (cancelled) return;

        const a: Asset | null = oneData.asset ?? null;
        setAsset(a);
        setChain(getFullChain(allData.assets ?? [], id));
        setPrints(printsData.prints ?? []);
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
          ensureSketchBuffer(logicalW, logicalH);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset, ensureSketchBuffer, paintSketchBuffer]);

  useEffect(() => {
    if (!loading && sketchRef.current) {
      redraw();
    }
  }, [loading, redraw, renderTick]);

  function patchLayer(layerId: string, patch: Partial<CadLayer>) {
    setLayers((ls) => ls.map((l) => (l.id === layerId ? { ...l, ...patch } : l)));
  }

  function patchActiveLayer(patch: Partial<CadLayer>) {
    if (!activeLayerId) return;
    patchLayer(activeLayerId, patch);
  }

  function handleAddLayer() {
    const { w, h } = logicalSizeRef.current;
    if (!w || !h) return;
    const layer = createLayer(w, h);
    const mask = document.createElement("canvas");
    mask.width = w;
    mask.height = h;
    layerMasksRef.current.set(layer.id, mask);
    setLayers((ls) => [...ls, layer]);
    setActiveLayerId(layer.id);
    setHint("Click inside an enclosed region to fill it for this layer.");
  }

  function handleRemoveLayer(layerId: string) {
    layerMasksRef.current.delete(layerId);
    setLayers((ls) => ls.filter((l) => l.id !== layerId));
    setActiveLayerId((cur) => (cur === layerId ? null : cur));
    setRenderTick((n) => n + 1);
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!activeLayerId) {
      setHint("Add or select a layer first, then click inside the garment outline.");
      return;
    }
    const canvas = canvasRef.current;
    const sketchBuf = sketchBufferRef.current;
    const mask = layerMasksRef.current.get(activeLayerId);
    const { w: logicalW, h: logicalH } = logicalSizeRef.current;
    if (!canvas || !sketchBuf || !mask || !logicalW || !logicalH) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * logicalW);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * logicalH);

    const sctx = sketchBuf.getContext("2d")!;
    const mctx = mask.getContext("2d")!;
    const source = sctx.getImageData(0, 0, sketchBuf.width, sketchBuf.height);
    const maskData = mctx.getImageData(0, 0, mask.width, mask.height);

    const added = floodFillToMask(source, maskData, x, y);
    if (added === 0) {
      setHint(
        "No fill — click a white area inside a closed garment outline (not on a black line, and not a region already filled by this layer)."
      );
      return;
    }

    mctx.putImageData(maskData, 0, 0);
    setRenderTick((n) => n + 1);
    setHint(
      "Region added to this layer. Click another enclosed area, or adjust its print/placement."
    );
    setError(null);
  }

  function resetAllLayers() {
    layerMasksRef.current.clear();
    setLayers([]);
    setActiveLayerId(null);
    setRenderTick((n) => n + 1);
    setHint("Layers cleared. Add a layer and click inside the garment to fill again.");
  }

  async function handleUploadPrint(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch("/api/prints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: file.name.replace(/\.[^.]+$/, ""),
          dataUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setPrints((ps) => [...ps, data.print]);
      patchActiveLayer({ printId: data.print.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Print upload failed");
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  function handleDragStart(e: React.PointerEvent) {
    if (!activeLayer) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { w: logicalW, h: logicalH } = logicalSizeRef.current;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startSingle = { ...activeLayer.single };
    const layerId = activeLayer.id;

    function onMove(ev: PointerEvent) {
      const dxLogical = ((ev.clientX - startClientX) / rect.width) * logicalW;
      const dyLogical = ((ev.clientY - startClientY) / rect.height) * logicalH;
      patchLayer(layerId, {
        single: {
          ...startSingle,
          x: startSingle.x + dxLogical,
          y: startSingle.y + dyLogical,
        },
      });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleResizeStart(e: React.PointerEvent) {
    if (!activeLayer) return;
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { w: logicalW, h: logicalH } = logicalSizeRef.current;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startSingle = { ...activeLayer.single };
    const layerId = activeLayer.id;

    function onMove(ev: PointerEvent) {
      const dxLogical = ((ev.clientX - startClientX) / rect.width) * logicalW;
      const dyLogical = ((ev.clientY - startClientY) / rect.height) * logicalH;
      patchLayer(layerId, {
        single: {
          ...startSingle,
          width: Math.max(MIN_SINGLE_SIZE, startSingle.width + dxLogical * 2),
          height: Math.max(MIN_SINGLE_SIZE, startSingle.height + dyLogical * 2),
        },
      });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
            layers: layers.map((l) => ({
              printId: l.printId,
              placement: l.placement,
              scale: l.scale,
              rotation: l.rotation,
              hue: l.hue,
              mirrored: l.mirrored,
              single: l.single,
            })),
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

  const canApprove = layers.some(
    (l) => l.printId && layerHasFill(layerMasksRef.current.get(l.id))
  );
  const { w: logicalW, h: logicalH } = logicalSizeRef.current;

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
          Add a layer, fill a region for it, then give that layer its own
          print and placement — tile it across the region, or place it once
          and drag/resize it by hand.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <div className="mx-auto max-w-[640px] overflow-hidden rounded-lg border border-navy-50 bg-white">
            <div className="relative">
              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                className="block h-auto w-full cursor-crosshair"
              />
              {activeLayer && activeLayer.placement === "single" && logicalW > 0 && (
                <div
                  className="absolute cursor-move border-2 border-dashed border-accent-orange bg-accent-orange/10"
                  style={{
                    left: `${
                      ((activeLayer.single.x - activeLayer.single.width / 2) /
                        logicalW) *
                      100
                    }%`,
                    top: `${
                      ((activeLayer.single.y - activeLayer.single.height / 2) /
                        logicalH) *
                      100
                    }%`,
                    width: `${(activeLayer.single.width / logicalW) * 100}%`,
                    height: `${(activeLayer.single.height / logicalH) * 100}%`,
                  }}
                  onPointerDown={handleDragStart}
                >
                  <div
                    className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-navy bg-accent-orange"
                    onPointerDown={handleResizeStart}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-cream-muted">{hint}</p>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!canApprove}
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
              Layers
            </h2>
            {layers.length === 0 ? (
              <p className="text-xs text-cream-muted">No layers yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {layers.map((l, idx) => {
                  const print = prints.find((p) => p.id === l.printId);
                  const filled = layerHasFill(layerMasksRef.current.get(l.id));
                  return (
                    <li
                      key={l.id}
                      onClick={() => setActiveLayerId(l.id)}
                      className={[
                        "flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition",
                        l.id === activeLayerId
                          ? "border-accent-blue bg-accent-blue/10"
                          : "border-navy-50 hover:border-cream-muted",
                      ].join(" ")}
                    >
                      <span className="h-6 w-6 shrink-0 overflow-hidden rounded border border-navy-50 bg-navy">
                        {print && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={print.src}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        )}
                      </span>
                      <span className="flex-1 truncate text-cream-muted">
                        Layer {idx + 1}
                        {!filled && " (empty)"}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveLayer(l.id);
                        }}
                        aria-label={`Remove layer ${idx + 1}`}
                        className="shrink-0 text-cream-muted transition hover:text-accent-orange"
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <button
              type="button"
              onClick={handleAddLayer}
              className="w-full rounded-md border border-navy-50 px-3 py-2 text-sm text-cream-muted transition hover:border-cream-muted hover:text-cream"
            >
              + Add layer
            </button>
          </section>

          {activeLayer ? (
            <>
              <section className="space-y-3">
                <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
                  Print
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => uploadInputRef.current?.click()}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-navy-50 text-cream-muted transition hover:border-accent-blue hover:text-cream"
                  >
                    <span className="text-lg leading-none">+</span>
                    <span className="text-[10px]">Upload</span>
                  </button>
                  {prints.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => patchActiveLayer({ printId: p.id })}
                      className={[
                        "overflow-hidden rounded-md border p-1 transition",
                        activeLayer.printId === p.id
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
                      <span className="mt-1 block truncate text-center text-[10px] text-cream-muted">
                        {p.label}
                      </span>
                    </button>
                  ))}
                </div>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUploadPrint}
                />
              </section>

              <section className="space-y-2">
                <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
                  Placement
                </h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => patchActiveLayer({ placement: "tile" })}
                    className={[
                      "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition",
                      activeLayer.placement === "tile"
                        ? "border-accent-blue bg-accent-blue/10 text-cream"
                        : "border-navy-50 text-cream-muted hover:border-cream-muted",
                    ].join(" ")}
                  >
                    Tile
                  </button>
                  <button
                    type="button"
                    onClick={() => patchActiveLayer({ placement: "single" })}
                    className={[
                      "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition",
                      activeLayer.placement === "single"
                        ? "border-accent-blue bg-accent-blue/10 text-cream"
                        : "border-navy-50 text-cream-muted hover:border-cream-muted",
                    ].join(" ")}
                  >
                    Single, centered
                  </button>
                </div>
                {activeLayer.placement === "single" && (
                  <p className="text-[11px] text-cream-muted">
                    Drag the box on the canvas to reposition; drag its corner
                    handle to resize.
                  </p>
                )}
              </section>

              <section className="space-y-4">
                <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
                  Controls
                </h2>

                {activeLayer.placement === "tile" && (
                  <label className="block space-y-1">
                    <div className="flex justify-between text-xs text-cream-muted">
                      <span>Scale</span>
                      <span>{Math.round(activeLayer.scale * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={50}
                      max={200}
                      value={Math.round(activeLayer.scale * 100)}
                      onChange={(e) =>
                        patchActiveLayer({ scale: Number(e.target.value) / 100 })
                      }
                      className="w-full accent-accent-blue"
                    />
                  </label>
                )}

                <label className="block space-y-1">
                  <div className="flex justify-between text-xs text-cream-muted">
                    <span>Rotation</span>
                    <span>{activeLayer.rotation}°</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={activeLayer.rotation}
                    onChange={(e) =>
                      patchActiveLayer({ rotation: Number(e.target.value) })
                    }
                    className="w-full accent-accent-blue"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between text-xs text-cream-muted">
                    <span>Recolor (hue)</span>
                    <span>{activeLayer.hue}°</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={activeLayer.hue}
                    onChange={(e) =>
                      patchActiveLayer({ hue: Number(e.target.value) })
                    }
                    className="w-full accent-accent-orange"
                  />
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={activeLayer.mirrored}
                    onChange={(e) =>
                      patchActiveLayer({ mirrored: e.target.checked })
                    }
                    className="accent-accent-blue"
                  />
                  Mirror print
                </label>
              </section>
            </>
          ) : (
            <p className="text-xs text-cream-muted">
              Add a layer to choose a print and start filling regions.
            </p>
          )}
        </aside>
      </div>

      {error && (
        <p className="rounded-md border border-accent-orange/40 bg-accent-orange/10 px-3 py-2 text-sm text-accent-orange">
          {error}
        </p>
      )}

      <ApprovalBar
        disabled={!canApprove || approving}
        onApprove={handleApproveLive}
        onDiscard={resetAllLayers}
        approveLabel={approving ? "Approving…" : "Approve → Minibody"}
      />
    </div>
  );
}
