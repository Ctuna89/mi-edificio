// Genera el ícono de Mi Edificio (.ico con un PNG de 256 px), sin dependencias.
import zlib from 'node:zlib';
import fs from 'node:fs';
const N = 256, px = Buffer.alloc(N * N * 4);
const pon = (x, y, r, g, b, a = 255) => { const i = (y * N + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
const R = 48;   // esquinas redondeadas
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const dx = Math.max(R - x, x - (N - 1 - R), 0), dy = Math.max(R - y, y - (N - 1 - R), 0);
  if (dx * dx + dy * dy <= R * R) pon(x, y, 30, 94, 255);
}
const caja = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pon(x, y, ...c); };
caja(72, 56, 184, 208, [255, 255, 255]);                                  // edificio
for (let f = 0; f < 4; f++) for (let c = 0; c < 3; c++) caja(88 + c * 32, 72 + f * 30, 108 + c * 32, 90 + f * 30, [30, 94, 255]);   // ventanas
caja(116, 180, 140, 208, [30, 94, 255]);                                  // puerta
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const trozo = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const filas = Buffer.alloc(N * (N * 4 + 1)); for (let y = 0; y < N; y++) px.copy(filas, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', zlib.deflateSync(filas)), trozo('IEND', Buffer.alloc(0))]);
const cab = Buffer.alloc(22); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(1, 4); cab.writeUInt16LE(1, 10); cab.writeUInt16LE(32, 12); cab.writeUInt32LE(png.length, 14); cab.writeUInt32LE(22, 18);
fs.writeFileSync(process.argv[2] || 'icono.ico', Buffer.concat([cab, png]));
