"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StageStepper from "@/components/StageStepper";
import ApprovalBar from "@/components/ApprovalBar";
import Toggle from "@/components/Toggle";
import AssetThumbPicker from "@/components/AssetThumbPicker";
import type { Asset } from "@/lib/store";
import type { Print } from "@/lib/printStore";
import { getAncestorChain, getFullChain, startFromHref } from "@/lib/chain";
import {
  floodClearMask,
  floodFillToMask,
  isWhitePixel,
  maskHasContent,
} from "@/lib/floodFill";
import { triggerDownload } from "@/lib/download";

type Placement = "tile" | "single";
type MaskMode = "fill" | "brush" | "erase";

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
const DEFAULT_BRUSH_SIZE = 40;

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

/** Maps a pointer event's client coordinates to logical (drawing-space)
 * canvas coordinates — same ratio math used everywhere else in this file
 * (click-to-fill, single-placement drag/resize). */
function clientToLogical(
  canvas: HTMLCanvasElement,
  logicalW: number,
  logicalH: number,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * logicalW,
    y: ((clientY - rect.top) / rect.height) * logicalH,
  };
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

/** r,g,b in 0–255 → h,s,l with h in [0,1), s/l in [0,1]. */
function rgbToHsl(
  r: number,
  g: number,
  b: number
): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
      break;
  }
  return { h, s, l };
}

/** h in [0,1), s/l in [0,1] → r,g,b in 0–255. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/**
 * Recolor in place. CSS `hue-rotate` is a no-op on grayscale (Black / White /
 * Word mark have no chroma to rotate), so we remap pixels instead:
 * chromatic → same sat/lightness at the new hue; mid-gray → saturated tint;
 * near-black → a visible saturated color (so solid Black fills actually change);
 * near-white left alone (stays "no ink" under multiply compositing).
 * hue === 0 means leave the print unchanged.
 */
function applyRecolor(canvas: HTMLCanvasElement, hue: number): void {
  if (!hue) return;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const targetH = ((hue % 360) + 360) % 360 / 360;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const { s, l } = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    let outS = s;
    let outL = l;
    if (s < 0.08) {
      if (l > 0.95) continue; // keep white
      outS = 1;
      outL = l < 0.08 ? 0.42 : l; // lift pure black into a visible color
    }
    const [r, g, b] = hslToRgb(targetH, outS, outL);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
}

/** Mirror + scale baked in; rotation is deliberately NOT baked in here — see
 * buildRotatedTileLayer, which rotates the whole repeated sheet as one image
 * instead of rotating the content inside each tile square. */
function buildPrintTile(
  print: HTMLImageElement,
  layer: CadLayer
): HTMLCanvasElement {
  const tileSize = Math.max(8, Math.round(64 * layer.scale));
  const tile = document.createElement("canvas");
  tile.width = tileSize;
  tile.height = tileSize;
  const tctx = tile.getContext("2d")!;
  tctx.translate(tileSize / 2, tileSize / 2);
  if (layer.mirrored) tctx.scale(-1, 1);
  tctx.drawImage(print, -tileSize / 2, -tileSize / 2, tileSize, tileSize);
  // Reset transform before putImageData-based recolor (image data is
  // always in device/backing-store space, not the current CTM).
  tctx.setTransform(1, 0, 0, 1, 0, 0);
  applyRecolor(tile, layer.hue);
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
  ctx.drawImage(
    print,
    -layer.single.width / 2,
    -layer.single.height / 2,
    layer.single.width,
    layer.single.height
  );
  ctx.restore();
  applyRecolor(out, layer.hue);
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

  // source-over so layer order matters (higher Layer N covers lower ones).
  // multiply was commutative — reordering looked identical.
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
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
  dpr: number,
  garmentClip: HTMLCanvasElement | null
) {
  const ctx = getHiDpiContext(canvas, dpr);
  const layout = fitSketch(logicalWidth, logicalHeight, sketch);

  ctx.clearRect(0, 0, logicalWidth, logicalHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, logicalWidth, logicalHeight);
  ctx.drawImage(sketch, layout.sx, layout.sy, layout.sw, layout.sh);

  // Array order: index 0 = bottom, last = top (highest Layer N on top).
  for (const layer of layers) {
    if (!layer.printId) continue;
    const print = printImages.get(layer.printId);
    if (!print) continue;

    // Single: always clip to the garment silhouette so the CAD can move
    // freely and anything past the outline is cut off. Tile: use the
    // per-layer flood/brush mask as before.
    const mask =
      layer.placement === "single"
        ? garmentClip
        : layerMasks.get(layer.id);
    if (!mask) continue;

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

/**
 * Mask of white pixels enclosed by the garment outline (not the page
 * background). Built by flood-filling exterior white from the edges, then
 * keeping interior white — used to clip Single placements that spill outside.
 */
function buildGarmentClipMask(sketchBuf: HTMLCanvasElement): HTMLCanvasElement {
  const w = sketchBuf.width;
  const h = sketchBuf.height;
  const sctx = sketchBuf.getContext("2d")!;
  const source = sctx.getImageData(0, 0, w, h);
  const exterior = new ImageData(w, h);

  const seeds: Array<[number, number]> = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
    [Math.floor(w / 2), 0],
    [0, Math.floor(h / 2)],
    [w - 1, Math.floor(h / 2)],
    [Math.floor(w / 2), h - 1],
  ];
  for (const [x, y] of seeds) {
    floodFillToMask(source, exterior, x, y);
  }

  const mask = document.createElement("canvas");
  mask.width = w;
  mask.height = h;
  const out = mask.getContext("2d")!.createImageData(w, h);
  const src = source.data;
  const ext = exterior.data;
  const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    if (ext[i + 3] > 128) continue;
    if (!isWhitePixel(src, i)) continue;
    dst[i] = 255;
    dst[i + 1] = 255;
    dst[i + 2] = 255;
    dst[i + 3] = 255;
  }
  mask.getContext("2d")!.putImageData(out, 0, 0);
  return mask;
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
  const garmentClipRef = useRef<HTMLCanvasElement | null>(null);
  const layerMasksRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const printImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadCadInputRef = useRef<HTMLInputElement>(null);
  const logicalSizeRef = useRef({ w: 0, h: 0 });
  const dprRef = useRef(1);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [allAssets, setAllAssets] = useState<Asset[]>([]);
  const [chain, setChain] = useState<Asset[]>([]);
  const [backHref, setBackHref] = useState(`/sketch/${id}`);
  const [prints, setPrints] = useState<Print[]>([]);
  const [layers, setLayers] = useState<CadLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(
    "Click inside the garment outline to fill a region for Layer 1."
  );
  const [uploadParentId, setUploadParentId] = useState("");
  const [uploadingCad, setUploadingCad] = useState(false);
  const [showCadLibrary, setShowCadLibrary] = useState(false);
  const [showPrintLibrary, setShowPrintLibrary] = useState(false);
  const [maskMode, setMaskMode] = useState<MaskMode>("fill");
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  /** Screen-space brush preview (null when pointer is off-canvas or in Fill). */
  const [brushCursor, setBrushCursor] = useState<{
    x: number;
    y: number;
    scale: number;
  } | null>(null);

  const activeLayer = layers.find((l) => l.id === activeLayerId) ?? null;
  const cadLibrary = allAssets
    .filter((a) => a.stage === "cad" && a.status === "approved")
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  const selectedCad = activeLayer?.printId
    ? cadLibrary.find((a) => a.id === activeLayer.printId) ??
      allAssets.find(
        (a) => a.id === activeLayer.printId && a.stage === "cad"
      ) ??
      null
    : null;

  /** Resolve a layer fill image from the CAD library (preferred), with a
   * fallback to the legacy print swatch store for older layers. */
  const getPrintImage = useCallback(
    async (fillId: string): Promise<HTMLImageElement | null> => {
      const cad = allAssets.find((a) => a.id === fillId && a.stage === "cad");
      const src = cad?.imageUrl ?? prints.find((p) => p.id === fillId)?.src;
      if (!src) return null;
      const cached = printImagesRef.current.get(src);
      if (cached) return cached;
      const img = await loadImage(src);
      printImagesRef.current.set(src, img);
      return img;
    },
    [allAssets, prints]
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
        dprRef.current,
        garmentClipRef.current
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
        const allAssetsList: Asset[] = allData.assets ?? [];
        setAsset(a);
        setAllAssets(allAssetsList);
        setChain(getFullChain(allAssetsList, id));
        setPrints(printsData.prints ?? []);

        if (a?.stage === "cad") {
          // Back always means "the Line Sketch that led here," even after
          // one or more rounds of re-editing a previous fill (a cad→cad
          // chain) — walk ancestors past any intermediate cad assets to the
          // nearest real sketch.
          const ancestry = a.parentId
            ? getAncestorChain(allAssetsList, a.parentId)
            : [];
          const sketchAncestor = [...ancestry]
            .reverse()
            .find((x) => x.stage === "sketch");
          setBackHref(sketchAncestor ? `/sketch/${sketchAncestor.id}` : "/");
        } else {
          setBackHref(`/sketch/${id}`);
        }
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

  // Loads whatever image this id points to as the editable base — a sketch
  // (blank garment, normal fresh-fill case) or a previously-filled cad asset
  // (reached via "← Back" from Minibody, or opened from the library) — both
  // are just "the picture to keep filling," so the same setup path covers
  // both: the prior fill visibly carries over since it's the loaded image,
  // and it's still fully editable (add more layers, adjust, etc.).
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
          if (sketchBufferRef.current) {
            garmentClipRef.current = buildGarmentClipMask(sketchBufferRef.current);
          }

          if (layers.length === 0) {
            const layer = createLayer(logicalW, logicalH);
            const mask = document.createElement("canvas");
            mask.width = logicalW;
            mask.height = logicalH;
            layerMasksRef.current.set(layer.id, mask);
            setLayers([layer]);
            setActiveLayerId(layer.id);
          }

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

  /** direction "up" = toward top of stack (higher Layer number). */
  function handleMoveLayer(layerId: string, direction: "up" | "down") {
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === layerId);
      if (i < 0) return ls;
      const j = direction === "up" ? i + 1 : i - 1;
      if (j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setRenderTick((n) => n + 1);
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    // Single placement uses the garment clip automatically — Fill clicks
    // only apply to Tile layers' flood masks.
    if (activeLayer?.placement === "single") {
      setHint(
        "Drag the CAD box to move it. Anything past the garment outline is cut off."
      );
      return;
    }
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

    const mctx = mask.getContext("2d")!;
    const maskData = mctx.getImageData(0, 0, mask.width, mask.height);
    const maskIdx = (y * mask.width + x) * 4;

    // Clicking an already-filled spot removes that connected fill instead
    // of adding more — a toggle, so Fill mode can also undo mistakes.
    if (maskData.data[maskIdx + 3] > 128) {
      const cleared = floodClearMask(maskData, x, y);
      if (cleared > 0) {
        mctx.putImageData(maskData, 0, 0);
        setRenderTick((n) => n + 1);
        setHint(
          "Region removed from this layer. Click an enclosed area to fill it, or a filled one to remove it."
        );
        setError(null);
      }
      return;
    }

    const sctx = sketchBuf.getContext("2d")!;
    const source = sctx.getImageData(0, 0, sketchBuf.width, sketchBuf.height);
    const added = floodFillToMask(source, maskData, x, y);
    if (added === 0) {
      setHint(
        "No fill — click a white area inside a closed garment outline (not on a black line)."
      );
      return;
    }

    mctx.putImageData(maskData, 0, 0);
    setRenderTick((n) => n + 1);
    setHint(
      "Region added to this layer. Click a filled area to remove it, or another enclosed area to add more."
    );
    setError(null);
  }

  function updateBrushCursor(e: React.PointerEvent<HTMLCanvasElement>) {
    if (maskMode === "fill") {
      setBrushCursor(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const { w } = logicalSizeRef.current;
    setBrushCursor({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      scale: w > 0 ? rect.width / w : 1,
    });
  }

  /** Stamp a circular hole into the mask (clip + clearRect). More reliable
   * than destination-out for continuous erase strokes across browsers. */
  function eraseMaskAt(
    mctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number
  ) {
    mctx.save();
    mctx.beginPath();
    mctx.arc(x, y, radius, 0, Math.PI * 2);
    mctx.clip();
    mctx.clearRect(x - radius - 1, y - radius - 1, radius * 2 + 2, radius * 2 + 2);
    mctx.restore();
  }

  /** Brush/Erase: freeform painting onto the same mask flood-fill writes to
   * — a continuous stroke (not just discrete stamps) via lineTo, so fast
   * pointer movement doesn't leave gaps. Erase punches holes via clip+clear. */
  function handleMaskPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (maskMode === "fill") return;
    if (!activeLayerId) {
      setHint("Add or select a layer first, then paint its mask.");
      return;
    }
    const canvas = canvasRef.current;
    const mask = layerMasksRef.current.get(activeLayerId);
    const { w: logicalW, h: logicalH } = logicalSizeRef.current;
    if (!canvas || !mask || !logicalW || !logicalH) return;
    e.preventDefault();
    updateBrushCursor(e);

    const mctx = mask.getContext("2d")!;
    const erasing = maskMode === "erase";
    const radius = brushSize / 2;

    mctx.lineCap = "round";
    mctx.lineJoin = "round";
    mctx.lineWidth = brushSize;
    mctx.strokeStyle = "#ffffff";
    mctx.fillStyle = "#ffffff";
    mctx.globalCompositeOperation = "source-over";

    let last = clientToLogical(canvas, logicalW, logicalH, e.clientX, e.clientY);
    if (erasing) {
      eraseMaskAt(mctx, last.x, last.y, radius);
    } else {
      mctx.beginPath();
      mctx.arc(last.x, last.y, radius, 0, Math.PI * 2);
      mctx.fill();
    }
    setRenderTick((n) => n + 1);

    function onMove(ev: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      setBrushCursor({
        x: ev.clientX - rect.left,
        y: ev.clientY - rect.top,
        scale: logicalW > 0 ? rect.width / logicalW : 1,
      });
      const pt = clientToLogical(canvas!, logicalW, logicalH, ev.clientX, ev.clientY);
      if (erasing) {
        // Stamp along the segment so fast moves don't leave gaps
        const dist = Math.hypot(pt.x - last.x, pt.y - last.y);
        const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.4)));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          eraseMaskAt(
            mctx,
            last.x + (pt.x - last.x) * t,
            last.y + (pt.y - last.y) * t,
            radius
          );
        }
      } else {
        mctx.beginPath();
        mctx.moveTo(last.x, last.y);
        mctx.lineTo(pt.x, pt.y);
        mctx.stroke();
      }
      last = pt;
      setRenderTick((n) => n + 1);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setHint(
        erasing
          ? "Erased from this layer's mask. Switch back to Fill/Brush to keep editing."
          : "Painted this layer's mask. Switch to Fill to click-fill an enclosed region instead."
      );
      setError(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function handleUploadFillCad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "cad",
          status: "approved",
          parentId: null,
          imageUrl: dataUrl,
          meta: {
            source: "library-upload",
            label: file.name.replace(/\.[^.]+$/, ""),
            fileName: file.name,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      const asset = data.asset as Asset;
      setAllAssets((prev) => [asset, ...prev]);
      patchActiveLayer({ printId: asset.id });
      setShowPrintLibrary(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "CAD upload failed");
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function handleUploadCad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCad(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
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
      // Stay on CAD Fill with the uploaded fill as the working canvas.
      router.push(`/cad/${data.asset.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploadingCad(false);
    } finally {
      if (uploadCadInputRef.current) uploadCadInputRef.current.value = "";
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

  async function handleContinue() {
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
          status: "pending",
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
      router.push(startFromHref(data.asset as Asset));
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

  // Iterating on a previously-filled cad asset already has a valid image to
  // continue with even before touching anything new this visit.
  const canApprove =
    asset.stage === "cad" ||
    layers.some(
      (l) =>
        !!l.printId &&
        (l.placement === "single" ||
          layerHasFill(layerMasksRef.current.get(l.id)))
    );
  const { w: logicalW, h: logicalH } = logicalSizeRef.current;
  const sketchOptions = allAssets.filter(
    (a) => a.stage === "sketch" && a.status === "approved"
  );
  const previousCads = cadLibrary.filter((a) => a.id !== id);
  const paintPopupOpen = maskMode === "brush" || maskMode === "erase";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <StageStepper current="cad" chain={chain} />

      <div className="space-y-0.5">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-cream-muted transition hover:text-cream"
        >
          ← Back
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">CAD Fill</h1>
        <p className="text-sm text-cream-muted">
          {asset.stage === "cad"
            ? "Picking up your previous fill — add layers, adjust, or continue as-is."
            : "Mask a region, pick a CAD, tune placement — then continue to Minibody."}
        </p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-2">
          <div
            className={
              paintPopupOpen
                ? "fixed inset-0 z-50 flex flex-col bg-navy/95 p-4 sm:p-6"
                : "mx-auto w-fit"
            }
            {...(paintPopupOpen
              ? {
                  role: "dialog" as const,
                  "aria-modal": true as const,
                  "aria-label": "Mask paint tools",
                }
              : {})}
          >
            {paintPopupOpen ? (
              <div className="mx-auto mb-4 flex w-full max-w-6xl flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-cream">
                    {maskMode === "erase" ? "Erase mask" : "Brush mask"}
                  </h2>
                  <p className="text-xs text-cream-muted">
                    Paint on a larger canvas, then Done when finished.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex gap-1">
                    {(
                      [
                        { key: "fill", label: "Fill" },
                        { key: "brush", label: "Brush" },
                        { key: "erase", label: "Erase" },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => {
                          setMaskMode(m.key);
                          if (m.key === "fill") setBrushCursor(null);
                        }}
                        className={[
                          "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                          maskMode === m.key
                            ? "border-accent-blue bg-accent-blue/10 text-cream"
                            : "border-navy-50 text-cream-muted hover:border-cream-muted",
                        ].join(" ")}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <label className="flex min-w-[12rem] items-center gap-2 text-xs text-cream-muted">
                    <span className="shrink-0">Brush size</span>
                    <input
                      type="range"
                      min={8}
                      max={160}
                      value={brushSize}
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                      className="w-40 accent-accent-blue"
                    />
                    <span className="shrink-0">{brushSize}px</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setBrushCursor(null);
                      setMaskMode("fill");
                    }}
                    className="rounded-md bg-accent-blue px-3 py-1.5 text-xs font-semibold text-navy transition hover:brightness-110"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
                  CAD fill
                </h2>
                <button
                  type="button"
                  disabled={!canApprove}
                  onClick={handleDownload}
                  className="text-xs font-medium text-accent-blue transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Download
                </button>
              </div>
            )}
            <div
              className={
                paintPopupOpen
                  ? "mx-auto flex min-h-0 w-full max-w-6xl flex-1 items-center justify-center"
                  : "overflow-hidden rounded-lg border border-navy-50 bg-white"
              }
            >
              <div
                className={
                  paintPopupOpen
                    ? "relative max-h-full max-w-full overflow-hidden rounded-lg border border-navy-50 bg-white shadow-lg"
                    : "relative"
                }
              >
                <canvas
                  ref={canvasRef}
                  onClick={maskMode === "fill" ? handleCanvasClick : undefined}
                  onPointerDown={
                    maskMode !== "fill" ? handleMaskPointerDown : undefined
                  }
                  onPointerMove={
                    maskMode !== "fill" ? updateBrushCursor : undefined
                  }
                  onPointerLeave={() => setBrushCursor(null)}
                  className={[
                    // Height-capped (not width-capped) so tall portrait source
                    // images can't balloon the page past one laptop screen —
                    // width follows automatically to preserve aspect ratio.
                    paintPopupOpen
                      ? "block max-h-[min(80vh,56rem)] w-auto"
                      : "block max-h-[min(50vh,28rem)] w-auto",
                    maskMode === "fill" ? "cursor-crosshair" : "cursor-none",
                  ].join(" ")}
                />
                {brushCursor && maskMode !== "fill" && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute rounded-full border-[1.5px] border-black"
                    style={{
                      left: brushCursor.x,
                      top: brushCursor.y,
                      width: brushSize * brushCursor.scale,
                      height: brushSize * brushCursor.scale,
                      transform: "translate(-50%, -50%)",
                      boxShadow: "0 0 0 1px rgba(255,255,255,0.95)",
                    }}
                  />
                )}
                {activeLayer &&
                  activeLayer.placement === "single" &&
                  logicalW > 0 && (
                    <div
                      className="absolute cursor-move border-2 border-dashed border-accent-blue bg-accent-blue/10"
                      style={{
                        left: `${
                          ((activeLayer.single.x -
                            activeLayer.single.width / 2) /
                            logicalW) *
                          100
                        }%`,
                        top: `${
                          ((activeLayer.single.y -
                            activeLayer.single.height / 2) /
                            logicalH) *
                          100
                        }%`,
                        width: `${
                          (activeLayer.single.width / logicalW) * 100
                        }%`,
                        height: `${
                          (activeLayer.single.height / logicalH) * 100
                        }%`,
                      }}
                      onPointerDown={handleDragStart}
                    >
                      <div
                        className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full border border-navy bg-accent-blue"
                        onPointerDown={handleResizeStart}
                      />
                    </div>
                  )}
              </div>
            </div>
          </div>
          <p className="text-xs text-cream-muted">{hint}</p>

          {activeLayerId && !paintPopupOpen && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-navy-50 p-3">
              <div className="flex gap-1">
                {(
                  [
                    { key: "fill", label: "Fill" },
                    { key: "brush", label: "Brush" },
                    { key: "erase", label: "Erase" },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => {
                      setMaskMode(m.key);
                      if (m.key === "fill") setBrushCursor(null);
                    }}
                    className={[
                      "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                      maskMode === m.key
                        ? "border-accent-blue bg-accent-blue/10 text-cream"
                        : "border-navy-50 text-cream-muted hover:border-cream-muted",
                    ].join(" ")}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!asset.imageUrl && (
            <p className="text-sm text-accent-orange">
              This asset has no sketch image to fill.
            </p>
          )}

          {error && (
            <p className="rounded-md border border-accent-orange/40 bg-accent-orange/10 px-3 py-2 text-sm text-accent-orange">
              {error}
            </p>
          )}

          <ApprovalBar
            disabled={!canApprove || approving}
            onContinue={handleContinue}
            continueLabel={approving ? "Saving…" : "Continue to Minibody →"}
          />
        </div>

        <aside className="max-h-[calc(100vh-10rem)] space-y-3 overflow-y-auto pr-1">
          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
              Layers
            </h2>
            <p className="text-[11px] text-cream-muted">
              Highest number sits on top. Use ↑ / ↓ to reorder.
            </p>
            {layers.length === 0 ? (
              <p className="text-xs text-cream-muted">No layers yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {[...layers]
                  .map((l, idx) => ({ l, idx }))
                  .reverse()
                  .map(({ l, idx }) => {
                  const fillCad = allAssets.find(
                    (a) => a.id === l.printId && a.stage === "cad"
                  );
                  const legacyPrint = prints.find((p) => p.id === l.printId);
                  const thumbSrc = fillCad?.imageUrl || legacyPrint?.src;
                  const filled =
                    l.placement === "single"
                      ? !!l.printId
                      : layerHasFill(layerMasksRef.current.get(l.id));
                  const isTop = idx === layers.length - 1;
                  const isBottom = idx === 0;
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
                      <span className="flex shrink-0 flex-col gap-0.5">
                        <button
                          type="button"
                          disabled={isTop}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveLayer(l.id, "up");
                          }}
                          aria-label={`Move layer ${idx + 1} up`}
                          className="leading-none text-cream-muted transition hover:text-cream disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={isBottom}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveLayer(l.id, "down");
                          }}
                          aria-label={`Move layer ${idx + 1} down`}
                          className="leading-none text-cream-muted transition hover:text-cream disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </span>
                      <span className="h-6 w-6 shrink-0 overflow-hidden rounded border border-navy-50 bg-navy">
                        {thumbSrc && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbSrc}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        )}
                      </span>
                      <span className="flex-1 truncate text-cream-muted">
                        Layer {idx + 1}
                        {isTop ? " · top" : ""}
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
                  CAD
                </h2>
                {selectedCad && (
                  <div className="flex items-center gap-2 rounded-md border border-accent-blue/40 bg-accent-blue/5 p-2">
                    {selectedCad.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedCad.imageUrl}
                        alt=""
                        className="h-10 w-10 rounded border border-navy-50 object-cover"
                      />
                    )}
                    <span className="truncate text-xs text-cream">
                      {typeof selectedCad.meta?.label === "string"
                        ? selectedCad.meta.label
                        : `CAD ${selectedCad.id.slice(0, 8)}`}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPrintLibrary((v) => !v)}
                    className="rounded-md border border-navy-50 px-3 py-1.5 text-xs font-medium text-cream-muted transition hover:border-cream-muted hover:text-cream"
                  >
                    {showPrintLibrary
                      ? "Hide CAD Library"
                      : "Search CAD Library"}
                  </button>
                  <button
                    type="button"
                    onClick={() => uploadInputRef.current?.click()}
                    className="rounded-md border border-dashed border-navy-50 px-3 py-1.5 text-xs font-medium text-cream-muted transition hover:border-accent-blue hover:text-cream"
                  >
                    + Upload CAD
                  </button>
                </div>
                {showPrintLibrary && (
                  <div className="max-h-52 overflow-y-auto rounded-md border border-navy-50 bg-navy-100/40 p-2">
                    {cadLibrary.length === 0 ? (
                      <p className="px-2 py-6 text-center text-[11px] text-cream-muted">
                        No CADs in the library yet — upload one to get started.
                      </p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {cadLibrary.map((cad) => {
                          const selected = activeLayer.printId === cad.id;
                          const label =
                            typeof cad.meta?.label === "string"
                              ? cad.meta.label
                              : cad.id.slice(0, 8);
                          return (
                            <button
                              key={cad.id}
                              type="button"
                              onClick={() => {
                                patchActiveLayer({ printId: cad.id });
                                setShowPrintLibrary(false);
                              }}
                              title={label}
                              className={[
                                "group flex flex-col gap-1 rounded-md p-1 text-left transition",
                                selected
                                  ? "bg-accent-blue/15 ring-2 ring-accent-blue"
                                  : "hover:bg-navy-50/60",
                              ].join(" ")}
                            >
                              <div
                                className={[
                                  "aspect-square overflow-hidden rounded border bg-white",
                                  selected
                                    ? "border-accent-blue"
                                    : "border-navy-50",
                                ].join(" ")}
                              >
                                {cad.imageUrl && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={cad.imageUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                )}
                              </div>
                              <span className="line-clamp-2 px-0.5 text-center text-[10px] leading-tight text-cream-muted group-hover:text-cream">
                                {label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleUploadFillCad}
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
                    onClick={() => {
                      patchActiveLayer({ placement: "single" });
                      setHint(
                        "Drag the CAD box anywhere on the garment. Spill past the outline is cut off."
                      );
                    }}
                    className={[
                      "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition",
                      activeLayer.placement === "single"
                        ? "border-accent-blue bg-accent-blue/10 text-cream"
                        : "border-navy-50 text-cream-muted hover:border-cream-muted",
                    ].join(" ")}
                  >
                    Single
                  </button>
                </div>
                {activeLayer.placement === "single" && (
                  <p className="text-[11px] text-cream-muted">
                    Drag the box to move, corner handle to resize. Anything
                    outside the garment outline is clipped.
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
                      <span>CAD size</span>
                      <span>{Math.round(activeLayer.scale * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={400}
                      value={Math.round(activeLayer.scale * 100)}
                      onChange={(e) =>
                        patchActiveLayer({ scale: Number(e.target.value) / 100 })
                      }
                      className="w-full accent-accent-blue"
                    />
                    <p className="text-[11px] text-cream-muted">
                      Smaller = more, denser repeats; larger = fewer, bigger
                      repeats.
                    </p>
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
                    <span>Recolor</span>
                    <span>{activeLayer.hue === 0 ? "original" : `${activeLayer.hue}°`}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={activeLayer.hue}
                    onChange={(e) =>
                      patchActiveLayer({ hue: Number(e.target.value) })
                    }
                    className="w-full accent-accent-blue"
                  />
                </label>

                <Toggle
                  checked={activeLayer.mirrored}
                  onChange={(mirrored) => patchActiveLayer({ mirrored })}
                  label="Mirror CAD"
                />
              </section>
            </>
          ) : (
            <p className="text-xs text-cream-muted">
              Add a layer to choose a CAD and start filling regions.
            </p>
          )}
        </aside>
      </div>

      <section className="space-y-3 rounded-lg border border-navy-50 p-4">
        <h2 className="text-sm font-medium text-cream">
          Use your own CAD fill
        </h2>
        <p className="text-xs text-cream-muted">
          Upload a filled sketch, or search the CAD library to reopen one.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center">
            <span className="rounded-md bg-accent-blue px-3 py-2 text-sm font-semibold text-navy transition hover:brightness-110">
              {uploadingCad ? "Uploading…" : "Choose CAD Fill"}
            </span>
            <input
              ref={uploadCadInputRef}
              type="file"
              accept="image/*"
              disabled={uploadingCad}
              onChange={handleUploadCad}
              className="sr-only"
            />
          </label>
          {previousCads.length > 0 && (
            <button
              type="button"
              disabled={uploadingCad}
              onClick={() => setShowCadLibrary((v) => !v)}
              className="rounded-md border border-navy-50 px-3 py-2 text-sm font-medium text-cream-muted transition hover:border-cream-muted hover:text-cream disabled:opacity-40"
            >
              {showCadLibrary ? "Hide CAD Library" : "Search CAD Library"}
            </button>
          )}
        </div>
        {showCadLibrary && previousCads.length > 0 && (
          <AssetThumbPicker
            assets={previousCads}
            disabled={uploadingCad}
            onSelect={(nextId) => {
              if (!nextId) return;
              router.push(`/cad/${nextId}`);
            }}
          />
        )}
        {sketchOptions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-cream-muted">
              When uploading, optionally link to a line sketch
            </p>
            <AssetThumbPicker
              assets={sketchOptions}
              selectedId={uploadParentId || null}
              allowNone
              noneLabel="Standalone"
              disabled={uploadingCad}
              onSelect={(nextId) => setUploadParentId(nextId ?? "")}
            />
          </div>
        )}
      </section>
    </div>
  );
}
