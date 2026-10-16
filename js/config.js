// =============================================================
// config.js — Conexão com a nuvem (Supabase) e serviços externos
// -------------------------------------------------------------
// Cole aqui a URL do projeto e a chave pública ("anon" ou
// "publishable") que aparecem no Supabase em:
//   Project Settings → API (ou "Connect").
// Essa chave é PÚBLICA por natureza: quem protege os dados são o
// login e as regras do banco (supabase/schema.sql) — e, no Dhenors,
// a criptografia com a sua frase secreta.
//
// Deixe em branco para configurar pelo próprio app (Ajustes → Nuvem).
//
// vapidPublicKey: chave PÚBLICA das notificações push (opcional).
//   Gere com `npx web-push generate-vapid-keys` e publique a Edge
//   Function supabase/functions/daily-reminders. Sem ela, o app usa
//   só os lembretes ao abrir e o calendário (.ics).
//
// brapiToken: token gratuito de https://brapi.dev (opcional) para
//   cotações de ações, FIIs e ETFs. Sem ele, algumas cotações
//   funcionam (ativos de teste) e o resto você atualiza à mão.
// =============================================================

export const CLOUD_CONFIG = {
  url: 'https://ftyagpdnvmllduhlrvef.supabase.co',
  anonKey: 'sb_publishable_8lJK-xkt6l-T9P238_bTpg_SeE0b6GN',
  vapidPublicKey: '',
};

export const MARKET_CONFIG = {
  brapiToken: '',
};
