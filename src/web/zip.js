// A small ZIP reader and writer for icon packs, so the server needs no archive library. Entries are
// stored, or deflated with the browser's CompressionStream; reading also handles deflated entries
// made by other tools. No ZIP64, no encryption.

const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 500_000_000;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function transform(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

/**
 * Builds a ZIP file. entries: [{ name, data (Uint8Array or string), deflate? }].
 * Images are best stored as they are, since PNG and WebP are already compressed.
 */
export async function writeZip(entries, now = new Date()) {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const stored = entry.deflate ? await transform(data, new CompressionStream('deflate-raw')) : data;
    const method = entry.deflate ? 8 : 0;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // file names are UTF-8
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, stored.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, stored);
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, 0x0800, true);
    header.setUint16(10, method, true);
    header.setUint16(12, time, true);
    header.setUint16(14, date, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, stored.length, true);
    header.setUint32(24, data.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(42, offset, true);
    central.push(new Uint8Array(header.buffer), name);
    offset += 30 + name.length + stored.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

/** Reads a ZIP file (Blob, ArrayBuffer or Uint8Array) into [{ name, data: Uint8Array }], folders left out. */
export async function readZip(input) {
  const buffer = input instanceof ArrayBuffer ? input
    : ArrayBuffer.isView(input) ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
      : await input.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('This is not a ZIP file');
  const count = view.getUint16(end + 10, true);
  let position = view.getUint32(end + 16, true);
  if (count > MAX_ENTRIES) throw new Error(`The ZIP file has more than ${MAX_ENTRIES} files`);
  if (position === 0xffffffff) throw new Error('ZIP64 files are not supported');
  const decoder = new TextDecoder();
  const entries = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (view.getUint32(position, true) !== 0x02014b50) throw new Error('The ZIP file is damaged');
    const flags = view.getUint16(position + 8, true);
    const method = view.getUint16(position + 10, true);
    const crc = view.getUint32(position + 16, true);
    const compressedSize = view.getUint32(position + 20, true);
    const size = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const extraLength = view.getUint16(position + 30, true);
    const commentLength = view.getUint16(position + 32, true);
    const localOffset = view.getUint32(position + 42, true);
    const name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength));
    position += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error(`${name} is encrypted`);
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error('The ZIP file unpacks to more than 500 MB');
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = bytes.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await transform(raw, new DecompressionStream('deflate-raw'));
    else throw new Error(`${name} uses a compression this reader does not know (${method})`);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`${name} is damaged`);
    entries.push({ name, data });
  }
  return entries;
}
