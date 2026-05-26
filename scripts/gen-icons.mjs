// Generates the app icons from one shared design — no native deps, just zlib.
// Run with `node scripts/gen-icons.mjs` after changing the design below.
//
// Design: full-bleed lime gradient with the ◗ brand half-disc in dark ink.
// Output: public/{icon.svg, favicon-32.png, icon-192.png, icon-512.png,
//                 apple-touch-icon.png}

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(OUT, { recursive: true });

const LIME = [184, 242, 74];
const DEEP = [143, 212, 0];
const INK = [17, 20, 12];
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// True if the sample point is inside the ◗ glyph (right half-disc).
function inGlyph(x, y, N) {
  const cx = 0.42 * N;
  const cy = 0.5 * N;
  const r = 0.3 * N;
  const dx = x - cx;
  const dy = y - cy;
  return dx >= 0 && dx * dx + dy * dy <= r * r;
}

function renderRGBA(N) {
  const s = 4; // supersample for smooth glyph edges
  const buf = Buffer.alloc(N * N * 4);
  for (let oy = 0; oy < N; oy++) {
    for (let ox = 0; ox < N; ox++) {
      let rr = 0, gg = 0, bb = 0;
      for (let sy = 0; sy < s; sy++) {
        for (let sx = 0; sx < s; sx++) {
          const x = ox + (sx + 0.5) / s;
          const y = oy + (sy + 0.5) / s;
          const t = (x + y) / (2 * (N - 1));
          let r, g, b;
          if (inGlyph(x, y, N)) {
            [r, g, b] = INK;
          } else {
            r = lerp(LIME[0], DEEP[0], t);
            g = lerp(LIME[1], DEEP[1], t);
            b = lerp(LIME[2], DEEP[2], t);
          }
          rr += r; gg += g; bb += b;
        }
      }
      const n = s * s;
      const i = (oy * N + ox) * 4;
      buf[i] = Math.round(rr / n);
      buf[i + 1] = Math.round(gg / n);
      buf[i + 2] = Math.round(bb / n);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

// ── minimal PNG encoder (8-bit RGBA) ────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(N, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0);
  ihdr.writeUInt32BE(N, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = compression/filter/interlace = 0
  const stride = N * 4;
  const raw = Buffer.alloc((stride + 1) * N);
  for (let y = 0; y < N; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b8f24a"/>
      <stop offset="1" stop-color="#8fd400"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <path d="M215 102 A154 154 0 0 1 215 410 Z" fill="#11140c"/>
</svg>
`;

for (const [name, size] of [
  ["favicon-32.png", 32],
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
]) {
  writeFileSync(join(OUT, name), encodePNG(size, renderRGBA(size)));
  console.log("wrote", name, `${size}x${size}`);
}
writeFileSync(join(OUT, "icon.svg"), SVG);
console.log("wrote icon.svg");
