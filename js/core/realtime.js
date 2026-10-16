// =============================================================
// realtime.js — Aviso instantâneo de mudança na nuvem (Supabase Realtime)
// -------------------------------------------------------------
// Fala o protocolo do Realtime (Phoenix Channels) direto no
// WebSocket, sem bibliotecas. Assina as mudanças da SUA linha em
// dhenors_state: quando outro aparelho salva, chega um aviso e o
// app baixa a versão nova na hora (em vez de esperar a consulta
// periódica). O conteúdo continua criptografado; o aviso só diz
// "mudou".
//
// Requer: a tabela na publicação `supabase_realtime`
// (supabase/schema.sql já faz isso).
// =============================================================

const HEARTBEAT_MS = 25_000;

export class RealtimeClient {
  /**
   * @param {object} o
   * @param {string} o.url      URL do projeto (https://xxx.supabase.co)
   * @param {string} o.apiKey   chave pública
   * @param {() => string} o.token  access_token atual (renovado pelo app)
   * @param {string} o.userId
   * @param {Function} o.onChange   chamado quando a linha muda
   * @param {Function} [o.onStatus] 'connecting' | 'live' | 'closed'
   */
  constructor({ url, apiKey, token, userId, onChange, onStatus = () => {} }) {
    Object.assign(this, { url, apiKey, token, userId, onChange, onStatus });
    this.ws = null;
    this.ref = 0;
    this.timer = 0;
    this.retry = 0;
    this.stopped = false;
    this.status = 'closed';
  }

  get live() { return this.status === 'live'; }

  start() {
    this.stopped = false;
    if (!('WebSocket' in globalThis)) return;
    const wsURL = `${this.url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(this.apiKey)}&vsn=1.0.0`;
    this.setStatus('connecting');
    let ws;
    try { ws = new WebSocket(wsURL); } catch { return this.reconnect(); }
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.retry = 0;
      this.send({
        topic: `realtime:dhenors-${this.userId}`,
        event: 'phx_join',
        payload: {
          config: {
            broadcast: { self: false },
            presence: { key: '' },
            postgres_changes: [{ event: '*', schema: 'public', table: 'dhenors_state', filter: `user_id=eq.${this.userId}` }],
          },
          access_token: this.token(),
        },
      });
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        this.send({ topic: 'phoenix', event: 'heartbeat', payload: {} });
        // token renovado? avisa o servidor para a assinatura não expirar
        this.send({ topic: `realtime:dhenors-${this.userId}`, event: 'access_token', payload: { access_token: this.token() } });
      }, HEARTBEAT_MS);
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.event === 'phx_reply' && msg.payload?.status === 'ok' && String(msg.topic).startsWith('realtime:')) this.setStatus('live');
      if (msg.event === 'phx_reply' && msg.payload?.status === 'error') this.setStatus('closed');
      if (msg.event === 'postgres_changes' || msg.event === 'UPDATE' || msg.event === 'INSERT') this.onChange(msg.payload);
      if (msg.event === 'system' && msg.payload?.status === 'error') this.setStatus('closed');
    });
    ws.addEventListener('close', () => { clearInterval(this.timer); this.setStatus('closed'); this.reconnect(); });
    ws.addEventListener('error', () => { try { ws.close(); } catch { /* ignora */ } });
  }

  send(msg) {
    if (this.ws?.readyState !== 1) return;
    this.ws.send(JSON.stringify({ ...msg, ref: String(++this.ref) }));
  }

  reconnect() {
    if (this.stopped) return;
    // espera crescente: 2s, 4s, 8s… até 1 min
    const wait = Math.min(60_000, 2000 * 2 ** this.retry++);
    setTimeout(() => { if (!this.stopped) this.start(); }, wait);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    try { this.ws?.close(); } catch { /* ignora */ }
    this.ws = null;
    this.setStatus('closed');
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s);
  }
}
