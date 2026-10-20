export interface PngSize { width: number; height: number }

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from the IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): PngSize | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Number of animation frames of a texture whose .mcmeta has an `animation` object (1 when not animated or unreadable):
 * Minecraft 1.7.10 cuts a strip into square frames, `floor(height / width)`, whatever the .mcmeta's `height` says
 * (architecture §11.43 (d)).
 */
export function animationFrames(mcmeta: string, size: PngSize): number {
  let meta: unknown;
  try { meta = JSON.parse(mcmeta); } catch { return 1; }
  if (typeof meta !== 'object' || meta === null) return 1;
  const animation = (meta as { animation?: unknown }).animation;
  if (typeof animation !== 'object' || animation === null || Array.isArray(animation)) return 1;
  return size.width > 0 ? Math.max(1, Math.floor(size.height / size.width)) : 1;
}
