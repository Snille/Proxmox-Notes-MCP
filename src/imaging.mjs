import sharp from 'sharp';

// Drawing icons on the server, for MCP, where there is no browser to do it. It does what the web
// GUI does in src/web/library.js: trim the transparent border of a generated image, draw it inside
// the icon box keeping its proportions, and encode WebP plus smaller copies at lower quality.

export const ICON_QUALITY = 0.85;
export const VARIANT_QUALITIES = [0.65, 0.45];
const PREVIEW_SIZE = 192;

/** Crops the transparent border off an image, keeping a small margin. Returns a PNG buffer. */
export async function trimTransparent(buffer, margin = 0.02) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * channels;
    for (let x = 0; x < width; x++) {
      if (data[row + x * channels + 3] > 16) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        bottom = y;
      }
    }
  }
  if (right < 0) return sharp(buffer).png().toBuffer();
  const pad = Math.round(Math.max(right - left, bottom - top) * margin);
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  return sharp(buffer).extract({ left, top, width: right - left + 1, height: bottom - top + 1 }).png().toBuffer();
}

const fitted = (buffer, width, height) => sharp(buffer)
  .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });

/**
 * Draws the image inside a width × height box and encodes WebP, plus the smaller copies (only
 * those that really are smaller), in the form IconStore.add takes.
 */
export async function drawIcon(buffer, { width, height }) {
  const encode = quality => fitted(buffer, width, height).webp({ quality: Math.round(quality * 100) }).toBuffer();
  const webp = await encode(ICON_QUALITY);
  const variants = [];
  let smallest = webp.length;
  for (const quality of VARIANT_QUALITIES) {
    const variant = await encode(quality);
    if (variant.length < smallest) {
      variants.push({ quality, webp: variant.toString('base64') });
      smallest = variant.length;
    }
  }
  return { webp: webp.toString('base64'), quality: ICON_QUALITY, variants, width, height };
}

/** A small WebP of an image, for an assistant to look at before it chooses one. */
export async function preview(buffer, size = PREVIEW_SIZE) {
  return fitted(buffer, size, size).webp({ quality: 70 }).toBuffer();
}
