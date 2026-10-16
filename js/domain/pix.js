// @ts-check
// =============================================================
// pix.js — Entende o Pix Copia e Cola (BR Code)
// -------------------------------------------------------------
// O "copia e cola" é um texto no padrão EMV: campos "ID + tamanho +
// valor". O app tira daí o VALOR (campo 54), o RECEBEDOR (59), a
// cidade (60), a chave Pix (26.01), a descrição (26.02) e o
// identificador (62.05), e confere o CRC16 do final (63) para não
// aceitar um código truncado ou alterado.
// Nada é enviado a lugar nenhum: o app só lê o texto.
// =============================================================

/** Lê os campos TLV de um trecho: { "00": "01", "26": "...", ... } */
export function parseTLV(text) {
  const out = {};
  let i = 0;
  while (i + 4 <= text.length) {
    const id = text.slice(i, i + 2);
    const len = Number(text.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(len)) throw new Error('Código Pix inválido.');
    out[id] = text.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  if (i !== text.length) throw new Error('Código Pix incompleto.');
  return out;
}

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), como exige o BR Code. */
export function crc16(text) {
  let crc = 0xFFFF;
  for (const ch of new TextEncoder().encode(text)) {
    crc ^= ch << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Texto do Pix Copia e Cola → { cents, name, city, key, description, txid, url, dynamic }
 * `cents` é null quando o código não traz valor (você digita).
 */
export function parsePix(input) {
  // Só quebras de linha saem: espaços fazem parte do código (ex.: nome do recebedor)
  const text = String(input || '').trim().replace(/[\r\n]+/g, '');
  if (!text.startsWith('000201')) throw new Error('Isso não parece um Pix Copia e Cola (deve começar com 000201).');
  const crcAt = text.lastIndexOf('6304');
  if (crcAt < 0 || text.length - crcAt !== 8) throw new Error('Código Pix sem a verificação final (CRC).');
  if (crc16(text.slice(0, crcAt + 4)) !== text.slice(crcAt + 4).toUpperCase()) throw new Error('Código Pix alterado ou incompleto (verificação não confere).');
  const f = parseTLV(text);
  let account = {};
  for (let id = 26; id <= 51; id++) {
    const k = String(id).padStart(2, '0');
    if (!f[k]) continue;
    const sub = parseTLV(f[k]);
    if ((sub['00'] || '').toLowerCase() === 'br.gov.bcb.pix') { account = sub; break; }
  }
  const extra = f['62'] ? parseTLV(f['62']) : {};
  const amount = f['54'] ? Math.round(Number(f['54']) * 100) : null;
  return {
    cents: Number.isFinite(amount) && amount > 0 ? amount : null,
    name: (f['59'] || '').trim(),
    city: (f['60'] || '').trim(),
    key: account['01'] || '',
    description: account['02'] || '',
    url: account['25'] || '',
    dynamic: Boolean(account['25']),
    txid: extra['05'] && extra['05'] !== '***' ? extra['05'] : '',
  };
}

/** Monta um BR Code (usado nos testes e para "cobrar" quem te deve). */
export function buildPix({ key, name, city, cents = null, txid = '***', description = '' }) {
  const tlv = (id, v) => `${id}${String(v.length).padStart(2, '0')}${v}`;
  const acc = tlv('00', 'br.gov.bcb.pix') + tlv('01', key) + (description ? tlv('02', description) : '');
  let payload = tlv('00', '01') + tlv('26', acc) + tlv('52', '0000') + tlv('53', '986')
    + (cents ? tlv('54', (cents / 100).toFixed(2)) : '') + tlv('58', 'BR')
    + tlv('59', name.slice(0, 25)) + tlv('60', city.slice(0, 15)) + tlv('62', tlv('05', txid)) + '6304';
  payload += crc16(payload);
  return payload;
}
