import sharp from 'sharp';

const MAX_WIDTH = 900;
const JPEG_QUALITY = 70;
const TILE_WIDTH = 260;
const TILE_HEIGHT = 140;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds a full-bleed SVG overlay: `text` repeated on a diagonal tile grid,
 * low-opacity, so it survives cropping and is legible but unobtrusive over
 * the underlying page render.
 */
function buildWatermarkSvg(
  width: number,
  height: number,
  text: string,
): Buffer {
  const escaped = escapeXml(text);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <pattern id="wm" width="${TILE_WIDTH}" height="${TILE_HEIGHT}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
        <text x="0" y="${TILE_HEIGHT / 2}" font-family="sans-serif" font-size="22" fill="#000000" fill-opacity="0.25">${escaped}</text>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#wm)" />
  </svg>`;
  return Buffer.from(svg);
}

/**
 * Resizes a page-render PNG to a marketing-safe preview: capped at 900px
 * wide, a diagonal repeated-text watermark composited on top, encoded as a
 * quality-70 JPEG. Never returns (or is meant to feed) a full-resolution,
 * unwatermarked image — these are public preview assets.
 */
export async function applyWatermark(
  png: Buffer,
  text: string,
): Promise<Buffer> {
  const resized = await sharp(png)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .toBuffer();

  const meta = await sharp(resized).metadata();
  const width = meta.width ?? MAX_WIDTH;
  const height = meta.height ?? width;
  const svg = buildWatermarkSvg(width, height, text);

  return sharp(resized)
    .composite([{ input: svg, tile: false }])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}
