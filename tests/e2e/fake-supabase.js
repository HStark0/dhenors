// Supabase de mentira para os testes de ponta a ponta: responde, na
// memória, às mesmas rotas que o app usa (Auth, REST das tabelas
// dhenors_* e Storage). Assim os testes passam pelo login, pela frase
// secreta, pela criptografia e pelo envio de verdade — sem rede.
import { CLOUD_CONFIG } from '../../js/config.js';

const HOST = new URL(CLOUD_CONFIG.url).host;

/** Filtros do PostgREST usados pelo app: eq., in.(…), lt., is. */
function matches(row, params) {
  for (const [col, raw] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(col)) continue;
    const [op, ...rest] = raw.split('.');
    const v = rest.join('.');
    const cell = row[col];
    if (op === 'eq' && String(cell) !== v) return false;
    if (op === 'in' && !v.replace(/^\(|\)$/g, '').split(',').includes(String(cell))) return false;
    if (op === 'lt' && !(String(cell) < v || Number(cell) < Number(v))) return false;
    if (op === 'is' && String(cell ?? 'null') !== v) return false;
  }
  return true;
}

export function createFakeSupabase() {
  const db = { users: [], tokens: new Map(), tables: { dhenors_state: [], dhenors_chunks: [], dhenors_versions: [], dhenors_devices: [], dhenors_push: [] }, files: new Map(), feedback: [] };
  let n = 0;

  const session = (user) => {
    const access = `tok-${++n}`;
    db.tokens.set(access, user);
    return { access_token: access, refresh_token: `ref-${n}`, expires_in: 3600, token_type: 'bearer', user: { id: user.id, email: user.email } };
  };
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: body == null ? '' : JSON.stringify(body) });

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const path = url.pathname;
    const body = () => { try { return JSON.parse(req.postData() || 'null'); } catch { return null; } };

    // ---------- Auth ----------
    if (path === '/auth/v1/signup') {
      const { email, password } = body();
      if (db.users.some((u) => u.email === email)) return json(route, 400, { msg: 'User already registered' });
      const user = { id: crypto.randomUUID(), email, password };
      db.users.push(user);
      return json(route, 200, session(user));
    }
    if (path === '/auth/v1/token') {
      const b = body();
      if (url.searchParams.get('grant_type') === 'password') {
        const user = db.users.find((u) => u.email === b.email && u.password === b.password);
        return user ? json(route, 200, session(user)) : json(route, 400, { error_description: 'Invalid login credentials' });
      }
      const user = db.users[0];
      return json(route, 200, session(user));
    }
    if (path.startsWith('/auth/v1/')) return json(route, 200, {});

    // ---------- Fale conosco (Edge Function send-feedback) ----------
    if (path === '/functions/v1/send-feedback') {
      if (method === 'OPTIONS') return route.fulfill({ status: 204 });
      db.feedback.push(body());
      return json(route, 200, { ok: true });
    }

    // ---------- Storage ----------
    if (path.startsWith('/storage/v1/object/')) {
      const key = path.replace('/storage/v1/object/', '');
      if (method === 'POST' || method === 'PUT') { db.files.set(key, req.postDataBuffer()); return json(route, 200, { Key: key }); }
      if (method === 'DELETE') { db.files.delete(key); return json(route, 200, {}); }
      const data = db.files.get(key);
      return data ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: data }) : json(route, 400, { error: 'not_found', message: 'Object not found' });
    }

    // ---------- REST ----------
    const table = path.replace('/rest/v1/', '');
    const rows = db.tables[table];
    if (!rows) return json(route, 404, { message: `Could not find the table ${table}` });
    const params = [...url.searchParams];
    const prefer = req.headers().prefer || '';
    if (method === 'GET') {
      let out = rows.filter((r) => matches(r, params));
      if (url.searchParams.get('order') === 'version.desc') out = [...out].sort((a, b) => b.version - a.version);
      const limit = Number(url.searchParams.get('limit'));
      if (limit) out = out.slice(0, limit);
      return json(route, 200, structuredClone(out));
    }
    if (method === 'POST') {
      const list = [].concat(body());
      const created = [];
      for (const item of list) {
        const row = { created_at: new Date().toISOString(), ...item };
        if (table === 'dhenors_state' && rows.some((r) => r.user_id === row.user_id)) return json(route, 409, { code: '23505', message: 'duplicate key' });
        if (url.searchParams.get('on_conflict')) {
          const keys = url.searchParams.get('on_conflict').split(',');
          const i = rows.findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (i >= 0) { rows[i] = { ...rows[i], ...row }; created.push(rows[i]); continue; }
        }
        rows.push(row);
        created.push(row);
      }
      return prefer.includes('return=representation') ? json(route, 201, created) : json(route, 201, null);
    }
    if (method === 'PATCH') {
      const patch = body();
      const hit = rows.filter((r) => matches(r, params));
      for (const r of hit) Object.assign(r, patch);
      return prefer.includes('return=representation') ? json(route, 200, hit) : json(route, 204, null);
    }
    if (method === 'DELETE') {
      db.tables[table] = rows.filter((r) => !matches(r, params));
      return json(route, 204, null);
    }
    return json(route, 405, { message: 'método' });
  }

  /** Liga o servidor de mentira na página (HTTP e o WebSocket do tempo real). */
  async function attach(page) {
    await page.route((u) => u.host === HOST, handle);
    await page.routeWebSocket((u) => u.host === HOST, () => { /* tempo real mudo: o app usa a consulta periódica */ });
  }

  return { db, attach };
}
