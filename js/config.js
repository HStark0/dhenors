// =============================================================
// config.js — Conexão com a nuvem (Supabase)
// -------------------------------------------------------------
// Cole aqui a URL do projeto e a chave pública ("anon" ou
// "publishable") que aparecem no Supabase em:
//   Project Settings → API (ou "Connect").
// Essa chave é PÚBLICA por natureza: quem protege os dados são o
// login e as regras do banco (supabase/schema.sql) — e, no Dhenors,
// a criptografia com a sua frase secreta.
//
// Deixe em branco para configurar pelo próprio app (Ajustes → Nuvem).
// =============================================================

export const CLOUD_CONFIG = {
  url: 'https://ftyagpdnvmllduhlrvef.supabase.co',
  anonKey: 'sb_publishable_8lJK-xkt6l-T9P238_bTpg_SeE0b6GN',
};
