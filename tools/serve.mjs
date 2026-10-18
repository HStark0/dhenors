// =============================================================
// tools/serve.mjs — Servidor estático mínimo (sem dependências)
// -------------------------------------------------------------
// Uso: node tools/serve.mjs [porta]   (padrão 5173)
// Escuta só em 127.0.0.1; para abrir no celular da rede: HOST=0.0.0.0
// Serve a pasta do projeto com os tipos certos (módulos ES, manifest,
// fontes) e sem cache, para desenvolver e rodar os testes e2e.
// =============================================================

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.md': 'text/markdown; charset=utf-8',
};

http.createServer((req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Endereço inválido');
    return;
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(join(root, path));
  // Nada de arquivos/pastas ocultos (.git, .env…) nem node_modules
  const hidden = file.slice(root.length).split(/[\\/]+/).some((part) => part.startsWith('.') || part === 'node_modules');
  if (!(file === root || file.startsWith(root + sep)) || hidden || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Não encontrado');
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    // frame-ancestors só vale em cabeçalho (a <meta> CSP ignora)
    'Content-Security-Policy': "frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file).pipe(res);
}).listen(port, host, () => console.log(`Dhenors em http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
