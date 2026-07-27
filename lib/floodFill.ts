/**
 * Queue-based BFS flood fill over ImageData.
 * Fills connected "white" pixels into a mask (union — ORs into existing mask).
 */

export function isWhitePixel(
  data: Uint8ClampedArray,
  index: number,
  threshold = 200
): boolean {
  const r = data[index];
  const g = data[index + 1];
  const b = data[index + 2];
  const a = data[index + 3];
  if (a < 128) return false;
  return r >= threshold && g >= threshold && b >= threshold;
}

/**
 * Flood-fill from (sx, sy) on `source` (sketch pixels).
 * Writes opaque white into `mask` for every connected white pixel.
 * Returns number of pixels added (0 if seed wasn't white / already done).
 */
export function floodFillToMask(
  source: ImageData,
  mask: ImageData,
  sx: number,
  sy: number,
  threshold = 200
): number {
  const { width: w, height: h } = source;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return 0;

  const src = source.data;
  const msk = mask.data;
  const start = (sy * w + sx) * 4;

  if (!isWhitePixel(src, start, threshold)) return 0;
  // Already in mask — still OK to re-run, but skip if seed already masked
  if (msk[start + 3] > 128) {
    // Seed already filled; nothing new from this click unless we still BFS
    // for consistency treat as no-op when seed already masked
    return 0;
  }

  const visited = new Uint8Array(w * h);
  // Queue as flat [x,y,x,y,...] with head index (true BFS)
  const queue: number[] = [sx, sy];
  let head = 0;
  visited[sy * w + sx] = 1;
  let filled = 0;

  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    const i = (y * w + x) * 4;

    if (!isWhitePixel(src, i, threshold)) continue;

    // Mark mask (opaque white)
    msk[i] = 255;
    msk[i + 1] = 255;
    msk[i + 2] = 255;
    msk[i + 3] = 255;
    filled++;

    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (visited[ni]) continue;
      visited[ni] = 1;
      queue.push(nx, ny);
    }
  }

  return filled;
}

export function maskHasContent(mask: ImageData): boolean {
  const d = mask.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] > 0) return true;
  }
  return false;
}

export function clearMask(mask: ImageData): void {
  mask.data.fill(0);
}
