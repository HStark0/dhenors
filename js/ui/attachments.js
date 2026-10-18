// =============================================================
// attachments.js — Anexos: foto do comprovante ou do boleto
// -------------------------------------------------------------
// • Ficam na NUVEM (Supabase Storage, bucket "dhenors-files"), nunca
//   no aparelho. Cada arquivo é cifrado aqui (AES-GCM) com uma chave
//   própria e aleatória; a chave vai no lançamento (`k`), que por sua
//   vez viaja cifrado com a frase secreta. O Supabase só vê bytes
//   ilegíveis — e trocar a frase não exige recifrar os anexos.
// • Fotos são reduzidas (até 1600 px, JPEG) para ocupar pouco.
// • Não vão para o backup em arquivo (seriam pesados demais).
// =============================================================

import { encryptBytes, decryptBytes, toB64, fromB64, importRawKey, exportRawKey } from '../core/crypto.js';
import { cloud } from '../core/cloud.js';
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

/** Cifra com uma chave nova e envia → chave (base64) para guardar no lançamento. */
async function upload(id, bytes) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const { iv, data } = await encryptBytes(bytes, key);
  const packed = new Uint8Array(iv.length + data.length);
  packed.set(iv, 0);
  packed.set(data, iv.length);
  await cloud.putFile(id, packed);
  return toB64(await exportRawKey(key));
}

/** Guarda um arquivo na nuvem e devolve o resumo para o lançamento: { id, name, type, size, k } */
export async function saveAttachment(file) {
  if (file.size > MAX_BYTES * 2) throw new Error('Arquivo grande demais (máx. 16 MB).');
  if (!cloud.linked) throw new Error('Entre na sua conta para anexar arquivos.');
  const f = await shrink(file);
  const id = newId();
  const k = await upload(id, new Uint8Array(await f.arrayBuffer()));
  return { id, name: f.name, type: f.type, size: f.size, k };
}

/**
 * Sobe um anexo que estava guardado no aparelho (versões anteriores),
 * mantendo o mesmo id → chave (base64).
 */
export const uploadExisting = (id, bytes) => upload(id, bytes);

/** URL temporária para mostrar/baixar o anexo (lembre de revogar). */
export async function attachmentURL(att) {
  if (!att?.k) return null; // ficou num aparelho que ainda não entrou na conta desde a 3.5
  const packed = await cloud.getFile(att.id);
  const key = await importRawKey(fromB64(att.k));
  const bytes = await decryptBytes({ iv: packed.subarray(0, 12), data: packed.subarray(12) }, key);
  return URL.createObjectURL(new Blob([bytes], { type: att.type || 'application/octet-stream' }));
}

/** Apaga da nuvem (melhor esforço: se falhar, o arquivo fica órfão, ilegível sem a chave). */
export function removeAttachment(id) {
  cloud.deleteFile(id).catch(() => {});
}

/** Abre o seletor de arquivos (câmera no celular). */
export function pickFiles({ accept = 'image/*,application/pdf', multiple = true, capture = false } = {}) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    if (capture) input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => resolve([...(input.files || [])]));
    input.click();
  });
}
