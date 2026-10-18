// Fale conosco: validação no app e no servidor, assunto e corpo do e-mail.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateFeedback, feedbackSubject, FEEDBACK_AREAS, FEEDBACK_TYPES, FEEDBACK_LIMITS } from '../js/domain/feedback.js';
import { validate, subject, html, text, AREAS, TYPES, LIMITS, FILE_TYPES, FILE_EXT, matchesType, fileName, parseObject, clientIp } from '../supabase/functions/send-feedback/email.js';

const ok = {
  name: 'Maria Souza', email: 'Maria@Exemplo.com ', area: 'Conta / Perfil', type: 'feedback',
  title: 'Gostei muito', message: 'O painel ficou ótimo, parabéns!', rating: 5,
};
const fields = (r) => r.errors.map((e) => e.field);

test('app: tudo certo passa e limpa os dados (e-mail em minúsculas)', () => {
  const r = validateFeedback(ok);
  assert.equal(r.ok, true);
  assert.equal(r.data.email, 'maria@exemplo.com');
  assert.equal(r.data.rating, 5);
});

test('app: obrigatórios, nome completo e e-mail inválido', () => {
  assert.deepEqual(fields(validateFeedback({})), ['name', 'email', 'area', 'type', 'title', 'message']);
  assert.deepEqual(fields(validateFeedback({ ...ok, name: 'Maria' })), ['name']);
  for (const email of ['maria', 'maria@', 'maria@exemplo', 'ma ria@exemplo.com']) assert.deepEqual(fields(validateFeedback({ ...ok, email })), ['email'], email);
  assert.deepEqual(fields(validateFeedback({ ...ok, area: 'Qualquer' })), ['area']);
  assert.deepEqual(fields(validateFeedback({ ...ok, message: 'curta' })), ['message']);
});

test('app: reclamação exige a descrição detalhada do problema', () => {
  const r = validateFeedback({ ...ok, type: 'reclamacao', details: '' });
  assert.deepEqual(fields(r), ['details']);
  assert.equal(validateFeedback({ ...ok, type: 'reclamacao', details: 'Cliquei em salvar e apareceu erro 500 na tela.' }).ok, true);
  // fora da reclamação, o campo é ignorado
  assert.equal(validateFeedback({ ...ok, type: 'sugestao', details: 'x' }).data.details, '');
});

test('app: nota de 1 a 5 e anexo só imagem/PDF até 5 MB', () => {
  assert.deepEqual(fields(validateFeedback({ ...ok, rating: 7 })), ['rating']);
  assert.equal(validateFeedback({ ...ok, rating: '' }).data.rating, null);
  assert.deepEqual(fields(validateFeedback({ ...ok, file: { name: 'a.exe', type: 'application/x-msdownload', size: 10 } })), ['file']);
  assert.deepEqual(fields(validateFeedback({ ...ok, file: { name: 'a.png', type: 'image/png', size: 6 * 1024 * 1024 } })), ['file']);
  assert.equal(validateFeedback({ ...ok, file: { name: 'a.pdf', type: 'application/pdf', size: 1000 } }).ok, true);
});

test('assunto: "[NOVO FEEDBACK] - Área - Nome" (sugestão e reclamação no feminino)', () => {
  assert.equal(feedbackSubject({ type: 'feedback', area: 'Interface / Design', name: 'Maria Souza' }), '[NOVO FEEDBACK] - Interface / Design - Maria Souza');
  assert.equal(subject({ type: 'reclamacao', area: 'Conta / Perfil', name: 'João Lima' }), '[NOVA RECLAMAÇÃO] - Conta / Perfil - João Lima');
  assert.equal(subject({ type: 'sugestao', area: 'Outro', name: 'Ana\r\nBcc: x@y.com' }), '[NOVA SUGESTÃO] - Outro - Ana Bcc: x@y.com', 'quebra de linha não injeta cabeçalho');
});

test('app e servidor usam as mesmas áreas, tipos e limites', () => {
  assert.deepEqual(AREAS, FEEDBACK_AREAS);
  assert.deepEqual(Object.keys(TYPES), FEEDBACK_TYPES.map((t) => t.value));
  for (const k of ['name', 'title', 'message', 'details', 'messageMin', 'detailsMin', 'fileBytes']) assert.equal(LIMITS[k], FEEDBACK_LIMITS[k], k);
  assert.deepEqual(FILE_TYPES, FEEDBACK_LIMITS.fileTypes);
  assert.deepEqual(Object.keys(FILE_EXT), FILE_TYPES, 'cada tipo aceito tem extensão');
});

test('servidor: recusa o que o app recusaria e confere o anexo', () => {
  assert.equal(validate({ ...ok, email: 'x' }).field, 'email');
  assert.equal(validate({ ...ok, type: 'reclamacao', details: 'curto' }).field, 'details');
  assert.equal(validate({ ...ok, attachment: { name: 'a.png', type: 'image/png', data: 'não é base64!' } }).field, 'file');
  const big = 'A'.repeat(Math.ceil((6 * 1024 * 1024 * 4) / 3));
  assert.equal(validate({ ...ok, attachment: { name: 'a.png', type: 'image/png', data: big } }).field, 'file');
  const r = validate({ ...ok, attachment: { name: '../../x?.png', type: 'image/png', data: 'iVBORw0KGgo=' } });
  assert.equal(r.ok, true);
  assert.equal(r.data.attachment.name, '.._.._x_.png');
});

test('servidor: nome completo igual ao app (nome e sobrenome)', () => {
  assert.equal(validate({ ...ok, name: 'Maria' }).field, 'name');
  assert.equal(validate({ ...ok, name: 'Al' }).field, 'name');
  assert.equal(validate({ ...ok, name: '  Maria   Souza ' }).data.name, 'Maria Souza');
  // o app e o servidor concordam
  for (const name of ['Maria', 'Jo', 'Ana Li', 'x'.repeat(81) + ' y']) {
    assert.equal(validate({ ...ok, name }).ok, validateFeedback({ ...ok, name }).ok, name);
  }
});

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const SIG = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0, 0, 0x10],
  'image/gif': [...Buffer.from('GIF89a')],
  'image/webp': [...Buffer.from('RIFF'), 0x24, 0, 0, 0, ...Buffer.from('WEBPVP8 ')],
  'application/pdf': [...Buffer.from('%PDF-1.7\n')],
};

test('servidor: anexo precisa ter a assinatura do tipo informado', () => {
  for (const [type, bytes] of Object.entries(SIG)) {
    assert.equal(matchesType(type, b64(bytes)), true, type);
    const r = validate({ ...ok, attachment: { name: 'arquivo', type, data: b64(bytes) } });
    assert.equal(r.ok, true, type);
    assert.equal(r.data.attachment.type, type);
  }
  // "PNG" que na verdade é um executável (MZ) ou um HTML
  assert.equal(validate({ ...ok, attachment: { name: 'a.png', type: 'image/png', data: b64([0x4d, 0x5a, 0x90, 0, 3, 0]) } }).field, 'file');
  assert.equal(validate({ ...ok, attachment: { name: 'a.pdf', type: 'application/pdf', data: b64([...Buffer.from('<html><script>')]) } }).field, 'file');
  // RIFF sem "WEBP" (ex.: WAV) não passa como WEBP
  assert.equal(matchesType('image/webp', b64([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WAVE')])), false);
  // tipo trocado: PDF declarado como PNG
  assert.equal(matchesType('image/png', b64(SIG['application/pdf'])), false);
  assert.equal(validate({ ...ok, attachment: 'texto' }).field, 'file');
});

test('servidor: nome do anexo sempre com a extensão do tipo real', () => {
  assert.equal(fileName('virus.exe', 'image/png'), 'virus.png');
  assert.equal(fileName('foto.JPEG', 'image/jpeg'), 'foto.JPEG');
  assert.equal(fileName('foto.jpg', 'image/jpeg'), 'foto.jpg');
  assert.equal(fileName('boleto', 'application/pdf'), 'boleto.pdf');
  assert.equal(fileName('', 'image/gif'), 'anexo.gif');
  assert.equal(fileName('a.pdf.html', 'application/pdf'), 'a.pdf.pdf');
  assert.equal(fileName('lin\r\nha.webp', 'image/webp'), 'lin__ha.webp');
  const r = validate({ ...ok, attachment: { name: 'relatorio.svg', type: 'image/png', data: b64(SIG['image/png']) } });
  assert.equal(r.data.attachment.name, 'relatorio.png');
});

test('servidor: corpo precisa ser um objeto JSON', () => {
  for (const raw of ['null', '42', '"texto"', '[1,2]', 'true', '{quebrado', '']) assert.equal(parseObject(raw), null, raw);
  assert.deepEqual(parseObject('{"name":"Maria Souza"}'), { name: 'Maria Souza' });
  assert.equal(validate(null).ok, false);
});

test('servidor: IP vem do x-real-ip ou do ÚLTIMO x-forwarded-for', () => {
  const h = (map) => (k) => map[k] ?? null;
  assert.equal(clientIp(h({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })), '9.9.9.9');
  assert.equal(clientIp(h({ 'x-forwarded-for': '1.1.1.1 (inventado), 2.2.2.2' })), '2.2.2.2');
  assert.equal(clientIp(h({})), 'desconhecido');
});

test('e-mail em HTML: campos organizados, texto escapado e bloco da reclamação', () => {
  const { data } = validate({ ...ok, type: 'reclamacao', title: '<script>alert(1)</script>', details: 'Linha 1\nLinha 2 com <b>tag</b>', meta: { version: '3.5.0', device: 'Android · Chrome', route: '#/contas' } });
  const body = html(data, new Date('2026-10-18T12:00:00Z'));
  assert.ok(!body.includes('<script>'), 'nada do usuário vira HTML');
  assert.match(body, /&lt;script&gt;/);
  assert.match(body, /Descrição detalhada do problema/);
  assert.match(body, /Linha 1<br>Linha 2 com &lt;b&gt;tag&lt;\/b&gt;/);
  assert.match(body, /mailto:maria@exemplo\.com/);
  assert.match(body, /App 3\.5\.0 · Android · Chrome/);
  assert.match(text(data), /Mensagem:\nO painel ficou ótimo/);
  const fb = html(validate(ok).data);
  assert.match(fb, /★★★★★ \(5\/5\)/);
  assert.ok(!fb.includes('Descrição detalhada'));
});
