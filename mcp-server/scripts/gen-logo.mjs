// One-off generator: builds a 64x64 placeholder PNG and prints its base64.
import zlib from "node:zlib";

const W = 64, H = 64;
const rows = [];
for (let y = 0; y < H; y++) {
  const row = Buffer.alloc(1 + W * 4);
  row[0] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    // brand blue background (#2563eb) with three white "text lines" (blog outline motif)
    let r = 37, g = 99, b = 235, a = 255;
    const bar =
      x >= 12 && x <= 52 &&
      ((y >= 16 && y <= 23) || (y >= 30 && y <= 37) || (y >= 44 && y <= 51 && x <= 42));
    if (bar) { r = 255; g = 255; b = 255; }
    const o = 1 + x * 4;
    row[o] = r; row[o + 1] = g; row[o + 2] = b; row[o + 3] = a;
  }
  rows.push(row);
}
const raw = Buffer.concat(rows);
const idat = zlib.deflateSync(raw, { level: 9 });

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type: RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);
console.log(JSON.stringify({ bytes: png.length, base64: png.toString("base64") }));
