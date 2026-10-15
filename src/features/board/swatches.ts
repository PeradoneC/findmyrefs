// Approximate color swatches from an image's pixels, computed locally in the app.
// Remote images can only be read when the host allows cross-origin access; otherwise
// we report that swatches are unavailable instead of guessing.

/** Quantizes RGBA pixel data into the `count` most common colors (hex). */
export function dominantColors(data: Uint8ClampedArray | number[], count = 5, step = 4): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += 4 * step) {
    const a = data[i + 3] ?? 0;
    if (a < 128) continue;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    // 4 bits per channel.
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  const sorted = [...buckets.values()].sort((x, y) => y.n - x.n);
  const out: string[] = [];
  for (const c of sorted) {
    const color = { r: c.r / c.n, g: c.g / c.n, b: c.b / c.n };
    // Skip colors that are nearly identical to one already chosen.
    if (out.some((h) => distance(h, color) < 28)) continue;
    out.push(`#${hex(color.r)}${hex(color.g)}${hex(color.b)}`);
    if (out.length >= count) break;
  }
  return out;
}

function distance(hexColor: string, c: { r: number; g: number; b: number }): number {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  return Math.hypot(r - c.r, g - c.g, b - c.b);
}

export async function extractSwatches(src: string, count = 5): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("The image could not be loaded"));
    img.src = src;
  });
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(img, 0, 0, size, size);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    throw new Error("This image's host does not allow reading its colors");
  }
  return dominantColors(data, count, 1);
}
