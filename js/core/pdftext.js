// =============================================================
// pdftext.js — Extrai o TEXTO de um PDF, linha a linha
// -------------------------------------------------------------
// Leitor enxuto (~300 linhas, sem bibliotecas) pensado para
// holerites e extratos gerados por sistemas: lê objetos e object
// streams, descompacta FlateDecode (DecompressionStream do próprio
// navegador), decodifica fontes (ToUnicode, Differences, WinAnsi) e
// monta as linhas pela posição do texto na página.
//
// Não lê PDFs escaneados (imagem) nem protegidos por senha — nesses
// casos o app oferece colar o texto.
// =============================================================

const latin1 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return s;
};

/** Descompacta lendo tudo o que der (alguns geradores gravam o checksum errado). */
async function readAll(format, bytes) {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks = [];
  let ok = true;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch { ok = false; }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return { ok, out };
}

async function inflate(bytes) {
  const z = await readAll('deflate', bytes);
  if (z.ok) return z.out;
  const raw = await readAll('deflate-raw', bytes.subarray(2)); // sem o cabeçalho zlib
  return raw.out.length >= z.out.length ? raw.out : z.out;
}

// ---------- Objetos ----------

export function readObjects(src) {
  const objs = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(src))) {
    const start = re.lastIndex;
    const end = src.indexOf('endobj', start);
    if (end < 0) break;
    const body = src.slice(start, end);
    const si = body.search(/\bstream(\r\n|\n|\r)/);
    if (si >= 0 && body.lastIndexOf('>>', si) >= 0) {
      const eol = body.slice(si + 6, si + 8).startsWith('\r\n') ? 2 : 1;
      let dataEnd = body.lastIndexOf('endstream');
      if (dataEnd < 0) dataEnd = body.length;
      let e = start + dataEnd;
      while (e > start && (src[e - 1] === '\n' || src[e - 1] === '\r')) e--;
      objs.set(Number(m[1]), { dict: body.slice(0, si), streamStart: start + si + 6 + eol, streamEnd: e });
    } else {
      objs.set(Number(m[1]), { dict: body.trim() });
    }
    re.lastIndex = end + 6;
  }
  return objs;
}

const refNum = (s) => { const m = /^\s*(\d+)\s+\d+\s+R/.exec(s || ''); return m ? Number(m[1]) : null; };

/** Valor de uma chave no dicionário (texto bruto): "/Contents 5 0 R" → "5 0 R" */
function dictValue(dict, key) {
  const re = new RegExp(`/${key}(?![A-Za-z0-9])\\s*`);
  const m = re.exec(dict);
  if (!m) return null;
  const i = m.index + m[0].length;
  const c = dict[i];
  if (c === '<' && dict[i + 1] === '<') return balanced(dict, i, '<<', '>>');
  if (c === '[') return balanced(dict, i, '[', ']');
  const rest = dict.slice(i);
  const ref = /^\d+\s+\d+\s+R/.exec(rest);
  if (ref) return ref[0];
  const tok = /^(\/[^\s/<>[\]()]+|[^\s/<>[\]()]+)/.exec(rest);
  return tok ? tok[0] : null;
}

function balanced(s, i, open, close) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s.startsWith(open, j)) { depth++; j += open.length - 1; } else if (s.startsWith(close, j)) {
      depth--; j += close.length - 1;
      if (!depth) return s.slice(i, j + 1);
    }
  }
  return s.slice(i);
}

// ---------- Fontes ----------

const GLYPHS = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'",
  parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '-', period: '.', slash: '/',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
  colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[',
  backslash: '\\', bracketright: ']', underscore: '_', braceleft: '{', bar: '|', braceright: '}', degree: '°',
  ordmasculine: 'º', ordfeminine: 'ª', endash: '–', emdash: '—', quoteright: '’', quoteleft: '‘', bullet: '•',
  controlHT: ' ', nbspace: ' ', section: '§', paragraph: '¶', copyright: '©', registered: '®',
};
const ACCENTS = { acute: '́', grave: '̀', circumflex: '̂', tilde: '̃', dieresis: '̈', cedilla: '̧', ring: '̊' };

function glyphToChar(name) {
  if (GLYPHS[name]) return GLYPHS[name];
  if (/^[A-Za-z]$/.test(name)) return name;
  const u = /^uni([0-9A-Fa-f]{4})$/.exec(name);
  if (u) return String.fromCharCode(parseInt(u[1], 16));
  const acc = /^([A-Za-z])(acute|grave|circumflex|tilde|dieresis|cedilla|ring)$/.exec(name);
  if (acc) return (acc[1] + ACCENTS[acc[2]]).normalize('NFC');
  return '';
}

function parseCMap(text) {
  const map = new Map();
  const hex = (h) => parseInt(h, 16);
  const toStr = (h) => {
    let s = '';
    for (let i = 0; i < h.length; i += 4) s += String.fromCharCode(hex(h.slice(i, i + 4)));
    return s;
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(hex(m[1]), toStr(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      const lo = hex(m[1]);
      const hi = hex(m[2]);
      if (m[4]) {
        const base = hex(m[4]);
        for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCharCode(base + c - lo));
      } else {
        const items = [...m[5].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => toStr(x[1]));
        items.forEach((s, k) => map.set(lo + k, s));
      }
    }
  }
  return map;
}

// ---------- Conteúdo da página ----------

function tokenize(s) {
  const out = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') {
      let depth = 1;
      let str = '';
      i++;
      while (i < n && depth) {
        const ch = s[i];
        if (ch === '\\') {
          const nx = s[i + 1];
          const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
          if (nx in esc) { str += esc[nx]; i += 2; continue; }
          if (/[0-7]/.test(nx)) {
            const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))[0];
            str += String.fromCharCode(parseInt(oct, 8));
            i += 1 + oct.length;
            continue;
          }
          if (nx === '\r' || nx === '\n') { i += nx === '\r' && s[i + 2] === '\n' ? 3 : 2; continue; }
          i++;
          continue;
        }
        if (ch === '(') depth++;
        if (ch === ')') { depth--; if (!depth) { i++; break; } }
        str += ch;
        i++;
      }
      out.push({ t: 'str', v: str });
      continue;
    }
    if (c === '<' && s[i + 1] !== '<') {
      const end = s.indexOf('>', i);
      const h = s.slice(i + 1, end).replace(/\s/g, '');
      let str = '';
      for (let k = 0; k < h.length; k += 2) str += String.fromCharCode(parseInt((h.slice(k, k + 2) + '0').slice(0, 2), 16));
      out.push({ t: 'str', v: str, hex: true });
      i = end + 1;
      continue;
    }
    if (c === '<' && s[i + 1] === '<') { out.push({ t: 'op', v: '<<' }); i += 2; continue; }
    if (c === '>' && s[i + 1] === '>') { out.push({ t: 'op', v: '>>' }); i += 2; continue; }
    if (c === '[' || c === ']') { out.push({ t: c }); i++; continue; }
    if (c === '/') {
      const m = /^\/[^\s/<>[\]()%{}]*/.exec(s.slice(i, i + 128));
      out.push({ t: 'name', v: m[0].slice(1) });
      i += m[0].length;
      continue;
    }
    const m = /^[^\s/<>[\]()%{}]+/.exec(s.slice(i, i + 64));
    if (!m) { i++; continue; }
    const w = m[0];
    i += w.length;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) out.push({ t: 'num', v: Number(w) });
    else if (w === 'BI') {
      // imagem embutida: pula até EI
      const ei = s.indexOf('EI', i);
      i = ei < 0 ? n : ei + 2;
    } else out.push({ t: 'op', v: w });
  }
  return out;
}

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const ID = [1, 0, 0, 1, 0, 0];

export function runContent(content, fonts) {
  const items = [];
  const toks = tokenize(content);
  let stack = [];
  let ctm = ID;
  const saved = [];
  let tm = ID;
  let tlm = ID;
  let font = null;
  let size = 10;
  let leading = 0;

  const decode = (str) => {
    if (!font) return str;
    let out = '';
    if (font.twoByte) {
      for (let k = 0; k + 1 < str.length; k += 2) {
        const code = (str.charCodeAt(k) << 8) | str.charCodeAt(k + 1);
        out += font.map.get(code) ?? '';
      }
      return out;
    }
    for (let k = 0; k < str.length; k++) {
      const code = str.charCodeAt(k);
      out += font.map.get(code) ?? (font.map.size ? '' : String.fromCharCode(code));
    }
    return out;
  };
  const show = (text) => {
    if (!text) return;
    const m = mul(tm, ctm);
    const scale = Math.hypot(m[2], m[3]) || 1;
    items.push({ x: m[4], y: m[5], s: text, size: size * scale });
    // avanço aproximado (largura média de 0,5 em)
    tm = mul([1, 0, 0, 1, text.length * size * 0.5, 0], tm);
  };
  const nextLine = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; };

  for (const tk of toks) {
    if (tk.t !== 'op') { stack.push(tk); continue; }
    const nums = stack.filter((x) => x.t === 'num').map((x) => x.v);
    switch (tk.v) {
      case 'q': saved.push(ctm); break;
      case 'Q': ctm = saved.pop() || ID; break;
      case 'cm': if (nums.length >= 6) ctm = mul(nums.slice(-6), ctm); break;
      case 'BT': tm = ID; tlm = ID; break;
      case 'Tf': {
        const name = [...stack].reverse().find((x) => x.t === 'name');
        font = name ? fonts.get(name.v) || null : null;
        size = nums.length ? nums[nums.length - 1] : size;
        break;
      }
      case 'TL': leading = nums[0] ?? leading; break;
      case 'Td': nextLine(nums[0] || 0, nums[1] || 0); break;
      case 'TD': leading = -(nums[1] || 0); nextLine(nums[0] || 0, nums[1] || 0); break;
      case 'Tm': if (nums.length >= 6) { tlm = nums.slice(-6); tm = tlm; } break;
      case 'T*': nextLine(0, -leading); break;
      case 'Tj': { const s = stack.find((x) => x.t === 'str'); if (s) show(decode(s.v)); break; }
      case "'": { nextLine(0, -leading); const s = stack.find((x) => x.t === 'str'); if (s) show(decode(s.v)); break; }
      case '"': { nextLine(0, -leading); const s = stack.find((x) => x.t === 'str'); if (s) show(decode(s.v)); break; }
      case 'TJ': {
        let text = '';
        for (const x of stack) {
          if (x.t === 'str') text += decode(x.v);
          else if (x.t === 'num' && x.v < -200) text += ' ';
        }
        show(text);
        break;
      }
      default: break;
    }
    stack = [];
  }
  return items;
}

// ---------- Montagem das linhas ----------

function toLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, it.size * 0.35));
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  return rows.map((r) => {
    const parts = r.items.sort((a, b) => a.x - b.x);
    let line = '';
    let lastEnd = null;
    for (const p of parts) {
      if (lastEnd != null) {
        const gap = p.x - lastEnd;
        line += gap > p.size * 1.5 ? '   ' : gap > p.size * 0.15 ? ' ' : '';
      }
      line += p.s;
      lastEnd = p.x + p.s.length * p.size * 0.5;
    }
    return line.replace(/\s+$/, '');
  }).filter((l) => l.trim());
}

// ---------- API ----------

/** Lê o PDF e devolve o texto (linhas na ordem da página). */
export async function pdfToText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const src = latin1(bytes);
  if (!src.startsWith('%PDF')) throw new Error('Arquivo não é um PDF.');
  if (/\/Encrypt\s/.test(src)) throw new Error('PDF protegido por senha.');
  const objs = readObjects(src);

  const streamCache = new Map();
  const getStream = async (num) => {
    if (streamCache.has(num)) return streamCache.get(num);
    const o = objs.get(num);
    if (!o || o.streamStart == null) return '';
    let data = bytes.subarray(o.streamStart, o.streamEnd);
    const filter = dictValue(o.dict, 'Filter') || '';
    if (/FlateDecode/.test(filter)) {
      try { data = await inflate(data); } catch { data = new Uint8Array(); }
    } else if (filter && !/^\s*\[\s*\]\s*$/.test(filter)) {
      data = new Uint8Array(); // outros filtros (imagens etc.): ignorados
    }
    const text = latin1(data);
    streamCache.set(num, text);
    return text;
  };

  // Object streams (PDF 1.5+): objetos compactados dentro de outros
  for (const [num, o] of [...objs]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const text = await getStream(num);
    const n = Number(dictValue(o.dict, 'N'));
    const first = Number(dictValue(o.dict, 'First'));
    const head = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k < n; k++) {
      const id = head[k * 2];
      const off = head[k * 2 + 1];
      const next = k + 1 < n ? head[(k + 1) * 2 + 1] : text.length - first;
      if (!objs.has(id)) objs.set(id, { dict: text.slice(first + off, first + next).trim() });
    }
  }

  const resolve = (v) => {
    const r = refNum(v);
    return r != null ? objs.get(r)?.dict || '' : v || '';
  };

  // Páginas, na ordem da árvore /Pages
  const pages = [];
  const walk = (num, inherited, seen = new Set()) => {
    if (seen.has(num)) return;
    seen.add(num);
    const o = objs.get(num);
    if (!o) return;
    const res = dictValue(o.dict, 'Resources') || inherited;
    if (/\/Type\s*\/Pages\b/.test(o.dict)) {
      const kids = dictValue(o.dict, 'Kids') || '';
      for (const m of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(m[1]), res, seen);
    } else if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push({ num, dict: o.dict, resources: res });
  };
  const rootRef = refNum((/\/Root\s+(\d+\s+\d+\s+R)/.exec(src) || [])[1]);
  const pagesRef = rootRef != null ? refNum(dictValue(objs.get(rootRef)?.dict || '', 'Pages')) : null;
  if (pagesRef != null) walk(pagesRef, null);
  if (!pages.length) {
    for (const [num, o] of objs) if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push({ num, dict: o.dict, resources: dictValue(o.dict, 'Resources') });
  }

  const lines = [];
  for (const page of pages) {
    const resDict = resolve(page.resources);
    const fontDict = resolve(dictValue(resDict, 'Font'));
    const fonts = new Map();
    for (const m of fontDict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      const f = objs.get(Number(m[2]))?.dict || '';
      const map = new Map();
      const tu = refNum(dictValue(f, 'ToUnicode'));
      if (tu != null) for (const [k, v] of parseCMap(await getStream(tu))) map.set(k, v);
      if (!map.size) {
        const enc = resolve(dictValue(f, 'Encoding'));
        const diff = dictValue(enc, 'Differences');
        if (diff) {
          let code = 0;
          for (const t of diff.slice(1, -1).match(/\d+|\/[^\s/[\]]+/g) || []) {
            if (/^\d+$/.test(t)) code = Number(t);
            else { const ch = glyphToChar(t.slice(1)); if (ch) map.set(code, ch); code++; }
          }
        }
      }
      fonts.set(m[1], { map, twoByte: /\/Subtype\s*\/Type0/.test(f) });
    }
    const contents = dictValue(page.dict, 'Contents') || '';
    let content = '';
    for (const m of contents.matchAll(/(\d+)\s+\d+\s+R/g)) content += `${await getStream(Number(m[1]))}\n`;
    lines.push(...toLines(runContent(content, fonts)));
  }
  return lines.join('\n');
}
