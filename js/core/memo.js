// @ts-check
// =============================================================
// memo.js — Cache de cálculos por versão do estado
// -------------------------------------------------------------
// Toda alteração gera um NOVO objeto de estado (store.commit faz
// uma cópia). Então dá para guardar o resultado de um cálculo
// enquanto o objeto for o mesmo: o sino, o Painel e a Agenda pedem
// computeMonth do mesmo mês várias vezes por desenho e agora só o
// primeiro pedido calcula. O WeakMap solta a memória sozinho quando
// o estado antigo deixa de existir.
// =============================================================

/**
 * memoByState(fn) → função com o mesmo uso, que guarda o resultado
 * por (estado, argumentos). Os argumentos precisam ser texto/número.
 * O resultado é compartilhado: quem chama não deve alterá-lo.
 */
export function memoByState(fn) {
  const cache = new WeakMap();
  const wrapped = (state, ...args) => {
    if (!state || typeof state !== 'object') return fn(state, ...args);
    let byArgs = cache.get(state);
    if (!byArgs) { byArgs = new Map(); cache.set(state, byArgs); }
    const key = args.map((a) => (a == null ? '' : typeof a === 'object' ? JSON.stringify(a) : String(a))).join('|');
    if (byArgs.has(key)) return byArgs.get(key);
    const value = fn(state, ...args);
    byArgs.set(key, value);
    return value;
  };
  wrapped.uncached = fn;
  return wrapped;
}
