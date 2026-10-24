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
 * An `animation` object in a `.mcmeta` that `JSON.parse` refuses. Minecraft reads `.mcmeta` with Gson's lenient parser,
 * which takes trailing commas and unquoted keys (many resource-pack files and some jar files need it).
 */
const LENIENT_ANIMATION = /[{,]\s*["']?animation["']?\s*:\s*\{/;

/** Whether the text of a `.mcmeta` (without a leading U+FEFF) holds an `animation` object, as the game reads it. */
function isAnimated(text: string): boolean {
  let meta: unknown;
  try {
    meta = JSON.parse(text);
  } catch {
    return LENIENT_ANIMATION.test(text);
  }
  if (typeof meta !== 'object' || meta === null) return false;
  const animation = (meta as { animation?: unknown }).animation;
  return typeof animation === 'object' && animation !== null && !Array.isArray(animation);
}

/**
 * Number of animation frames of a texture whose .mcmeta has an `animation` object (1 when not animated or unreadable):
 * Minecraft 1.7.10 cuts a strip into square frames, `floor(height / width)`, whatever the .mcmeta's `height` says
 * (architecture §11.43 (d)). A leading byte-order mark is dropped, and text that is not strict JSON is read as leniently
 * as the game reads it (`LENIENT_ANIMATION`).
 */
export function animationFrames(mcmeta: string, size: PngSize): number {
  if (!isAnimated(mcmeta.replace(/^\uFEFF/, ''))) return 1;
  return size.width > 0 ? Math.max(1, Math.floor(size.height / size.width)) : 1;
}
