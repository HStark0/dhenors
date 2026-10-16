// =============================================================
// attachments.js — Anexos: foto do comprovante ou do boleto
// -------------------------------------------------------------
// • Ficam SÓ neste aparelho (IndexedDB, loja "files"): não vão para
//   a nuvem nem para o backup (seriam pesados demais). O backup
//   avisa isso.
// • Fotos são reduzidas (até 1600 px, JPEG) para ocupar pouco.
// • Com PIN ligado, o arquivo é guardado CIFRADO com a mesma chave.
// =============================================================

import { putFile, getFile, deleteFile, listFileIds } from '../core/storage.js';
import { encryptBytes, decryptBytes } from '../core/crypto.js';
import { store } from '../core/store.js';
import { newId } from '../domain/schema.js';

const MAX_SIDE = 1600;
const MAX_BYTES = 8 * 1024 * 1024;

/** Reduz uma imagem grande (mantém PDF e outros arquivos como estão). */
async function shrink(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || !globalThis.createImageBitmap) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900_000) return file;
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

/** Guarda um arquivo e devolve o resumo para o lançamento: { id, name, type, size } */
export async function saveAttachment(file) {
  if (file.size > MAX_BYTES * 2) throw new Error('Arquivo grande demais (máx. 16 MB).');
  const f = await shrink(file);
  const id = newId();
  const bytes = new Uint8Array(await f.arrayBuffer());
  const key = store.currentKey;
  if (key) {
    const { iv, data } = await encryptBytes(bytes, key);
    await putFile(id, { name: f.name, type: f.type, size: f.size, iv, data, enc: true });
  } else {
    await putFile(id, { name: f.name, type: f.type, size: f.size, data: new Blob([bytes], { type: f.type }) });
  }
  return { id, name: f.name, type: f.type, size: f.size };
}

/** URL temporária para mostrar/baixar o anexo (lembre de revogar). */
export async function attachmentURL(id) {
  const rec = await getFile(id);
  if (!rec) return null;
  let blob = rec.data;
  if (rec.enc) {
    if (!store.currentKey) throw new Error('Desbloqueie o app para ver o anexo.');
    blob = new Blob([await decryptBytes({ iv: rec.iv, data: rec.data }, store.currentKey)], { type: rec.type });
  }
  return URL.createObjectURL(blob);
}

export const removeAttachment = (id) => deleteFile(id);

// PIN trocado/ligado/desligado: recifra os anexos com a chave nova
store.onRekey(async (oldKey, newKey) => {
  for (const id of await listFileIds()) {
    const rec = await getFile(id);
    if (!rec) continue;
    let bytes;
    if (rec.enc) {
      if (!oldKey) continue;
      bytes = await decryptBytes({ iv: rec.iv, data: rec.data }, oldKey);
    } else {
      bytes = new Uint8Array(await rec.data.arrayBuffer());
    }
    if (newKey) {
      const { iv, data } = await encryptBytes(bytes, newKey);
      await putFile(id, { name: rec.name, type: rec.type, size: rec.size, iv, data, enc: true });
    } else {
      await putFile(id, { name: rec.name, type: rec.type, size: rec.size, data: new Blob([bytes], { type: rec.type }) });
    }
  }
});

/** Abre o seletor de arquivos (câmera no celular). */
export function pickFiles({ accept = 'image/*,application/pdf', multiple = true, capture = false } = {}) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    if (capture) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => resolve([...(input.files || [])]));
    input.click();
  });
}
