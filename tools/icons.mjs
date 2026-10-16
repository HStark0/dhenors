// =============================================================
// tools/icons.mjs — Gera os ícones monocromáticos (Android 13+)
// -------------------------------------------------------------
// O Android 13 pinta o ícone "monochrome" com a cor do tema do
// aparelho. Ele precisa ser uma silhueta: branco onde há desenho,
// transparente no resto. Este script lê assets/icons/icon-512.png,
// transforma em silhueta e grava 512 e 192 px — sem bibliotecas
// (decodificador/encoder PNG mínimo com o zlib do Node).
//
// Uso: node tools/icons.mjs
// =============================================================

import { readFile, writeFile } from 'node:fs/promises';
import { inflateSync, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- PNG ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

/** PNG 8 bits (RGB, RGBA, cinza, cinza+alfa ou paleta) → { width, height, rgba } */
export function decodePNG(buf) {
  let pos = 8;
  let width = 0, height = 0, depth = 0, color = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; color = data[9];
      if (data[12] !== 0) throw new Error('PNG entrelaçado não suportado');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error('Só PNG de 8 bits por canal');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = v & 0xFF;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let r, g, b, al = 255;
    if (color === 6) [r, g, b, al] = [pixels[s], pixels[s + 1], pixels[s + 2], pixels[s + 3]];
    else if (color === 2) [r, g, b] = [pixels[s], pixels[s + 1], pixels[s + 2]];
    else if (color === 0) r = g = b = pixels[s];
    else if (color === 4) { r = g = b = pixels[s]; al = pixels[s + 1]; } else {
      const k = pixels[s];
      [r, g, b] = [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2]];
      al = trns && k < trns.length ? trns[k] : 255;
    }
    rgba.set([r, g, b, al], i * 4);
  }
  return { width, height, rgba };
}

export function encodePNG({ width, height, rgba }) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Silhueta branca: o fundo opaco (cor do canto) vira transparente e o
 * desenho vira branco. Se o ícone já tem transparência, usa o alfa.
 */
export function silhouette({ width, height, rgba }) {
  const out = Buffer.alloc(rgba.length);
  const bg = [rgba[0], rgba[1], rgba[2], rgba[3]];
  const opaqueBg = bg[3] > 200;
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    let alpha;
    if (opaqueBg) {
      const dist = Math.abs(rgba[p] - bg[0]) + Math.abs(rgba[p + 1] - bg[1]) + Math.abs(rgba[p + 2] - bg[2]);
      alpha = Math.max(0, Math.min(255, (dist - 40) * 3));
    } else alpha = rgba[p + 3];
    out.set([255, 255, 255, alpha], p);
  }
  return { width, height, rgba: out };
}

/** Reduz a imagem (média de área). */
export function resize(img, size) {
  const { width, height, rgba } = img;
  const out = Buffer.alloc(size * size * 4);
  const sx = width / size, sy = height / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) {
        for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
          const p = (yy * width + xx) * 4;
          for (let k = 0; k < 4; k++) acc[k] += rgba[p + k];
          n++;
        }
      }
      out.set(acc.map((v) => Math.round(v / Math.max(1, n))), (y * size + x) * 4);
    }
  }
  return { width: size, height: size, rgba: out };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const src = decodePNG(await readFile(join(root, 'assets/icons/icon-512.png')));
  const mono = silhouette(src);
  await writeFile(join(root, 'assets/icons/icon-monochrome-512.png'), encodePNG(mono));
  await writeFile(join(root, 'assets/icons/icon-monochrome-192.png'), encodePNG(resize(mono, 192)));
  console.log('Ícones monocromáticos gerados (512 e 192 px).');
}
