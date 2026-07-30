import sharp from "sharp";

/**
 * Crop near-white / near-transparent margins from a CAD fill swatch.
 * Library CADs are usually exported with a large empty canvas around the print —
 * trimming makes tiles/single placement and thumbnails sit edge-to-edge.
 */
export async function trimWhitespace(buffer: Buffer): Promise<Buffer> {
  try {
    const trimmed = await sharp(buffer)
      .trim({
        // JPEG/export near-white backgrounds need a looser match than pure #fff.
        threshold: 30,
      })
      .png()
      .toBuffer();
    return trimmed;
  } catch {
    // All-one-color images make sharp.trim throw — keep original.
    return buffer;
  }
}

/** Meta sources that are standalone CAD fill swatches (not pipeline canvas exports). */
export function shouldTrimCadMeta(meta: Record<string, unknown> | undefined): boolean {
  const source = typeof meta?.source === "string" ? meta.source : "";
  return (
    source === "library-upload" ||
    source === "library-import" ||
    source === "upload-direct"
  );
}
