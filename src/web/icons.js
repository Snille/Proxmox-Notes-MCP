// Turns an image (from the icon set or an upload) into an embedded data: URI that fits the
// Proxmox Notes size limit. WebP when the browser can encode it, PNG otherwise.

const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35];

async function draw(blob, width, height) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  // Fit the whole image inside the box and keep its aspect ratio; the rest stays transparent.
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  context.drawImage(bitmap, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
  bitmap.close();
  return canvas;
}

/**
 * Encodes the image so the data URI is at most `budget` characters.
 * Returns { src, format, quality, length } or throws when even the lowest quality is too large.
 */
export async function embedImage(blob, { width, height, budget }) {
  const canvas = await draw(blob, width, height);
  const probe = canvas.toDataURL('image/webp', QUALITIES[0]);
  if (!probe.startsWith('data:image/webp')) {
    const png = canvas.toDataURL('image/png');
    if (png.length > budget) {
      throw new Error(`This browser cannot make WebP, and the PNG (${png.length} characters) does not fit in the ${budget} characters left`);
    }
    return { src: png, format: 'PNG', quality: null, length: png.length };
  }
  for (const quality of QUALITIES) {
    const src = quality === QUALITIES[0] ? probe : canvas.toDataURL('image/webp', quality);
    if (src.length <= budget) {
      return { src, format: 'WebP', quality, length: src.length };
    }
  }
  throw new Error(`The image does not fit in the ${budget} characters left, even at low quality. Shorten the text or use a smaller icon size.`);
}

export async function fetchIconSetImage(key) {
  const response = await fetch(`/api/icon?key=${encodeURIComponent(key)}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `The icon could not be loaded (${response.status})`);
  }
  return response.blob();
}
