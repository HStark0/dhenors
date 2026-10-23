// @ts-check
// =============================================================
// defaults.js — Categorias padrão, paleta e ícones
// -------------------------------------------------------------
// • Ícones das categorias: ícones próprios (SVG do sprite, prefixo
//   "i:") desenhados dentro de um círculo da cor da categoria — iguais
//   no Windows, Android e iPhone. Emojis de cadastros antigos viram
//   o ícone equivalente ao abrir os dados (toIconValue).
// • Paleta SEM vermelho e âmbar: essas cores ficam reservadas para os
//   estados (vermelho = atrasada, âmbar = vence logo, violeta =
//   orçamento estourado). Assim "Saúde" não parece "atrasada".
// =============================================================

export const CATEGORY_COLORS = [
  '#2563EB', '#059669', '#7C3AED', '#0891B2', '#DB2777', '#65A30D',
  '#4F46E5', '#0D9488', '#9333EA', '#0369A1', '#15803D', '#475569',
  '#C026D3', '#1D4ED8', '#047857', '#6D28D9',
];

/** Cores antigas que se confundiam com os estados (trocadas ao abrir dados do formato antigo). */
export const LEGACY_STATE_COLORS = ['#D97706', '#DC2626', '#EA580C', '#CA8A04', '#BE123C'];

/** Ícones disponíveis para categorias (nomes do sprite em ui/icons.js). */
export const CATEGORY_ICONS = [
  'i:house', 'i:utensils', 'i:shopping-cart', 'i:car', 'i:fuel', 'i:bus', 'i:pill', 'i:heart-pulse', 'i:dumbbell',
  'i:graduation-cap', 'i:book-open', 'i:gamepad-2', 'i:plane', 'i:clapperboard', 'i:party-popper', 'i:tv',
  'i:shopping-bag', 'i:gift', 'i:paw-print', 'i:baby', 'i:briefcase', 'i:receipt-text', 'i:landmark', 'i:trending-up',
  'i:tag', 'i:smartphone', 'i:laptop', 'i:wifi', 'i:shirt', 'i:wrench', 'i:lightbulb', 'i:droplet', 'i:flame',
  'i:coffee', 'i:beer', 'i:music', 'i:building-2', 'i:hammer', 'i:scissors', 'i:stethoscope', 'i:piggy-bank',
  'i:shield', 'i:circle-dollar-sign', 'i:hand-heart', 'i:sprout', 'i:credit-card', 'i:wallet', 'i:users',
];

/**
 * Emojis das versões antigas → ícone equivalente. O app não mostra emoji
 * em lugar nenhum: os cadastros antigos são convertidos ao abrir os dados
 * (ver toIconValue). As chaves ficam escritas como escapes Unicode.
 */
const EMOJI_LIST = {
  '\u{1F3E0}': 'house', '\u{1F37D}\u{FE0F}': 'utensils', '\u{1F6D2}': 'shopping-cart', '\u{1F697}': 'car',
  '\u{26FD}': 'fuel', '\u{1F68C}': 'bus', '\u{1F48A}': 'pill', '\u{1FA7A}': 'stethoscope',
  '\u{1F3CB}\u{FE0F}': 'dumbbell', '\u{1F393}': 'graduation-cap', '\u{1F4DA}': 'book-open', '\u{1F3AE}': 'gamepad-2',
  '\u{2708}\u{FE0F}': 'plane', '\u{1F3AC}': 'clapperboard', '\u{1F389}': 'party-popper', '\u{1F4B3}': 'credit-card',
  '\u{1F3E6}': 'landmark', '\u{1F4C8}': 'trending-up', '\u{1F4B0}': 'circle-dollar-sign', '\u{1F9FE}': 'receipt-text',
  '\u{1F4F1}': 'smartphone', '\u{1F4BB}': 'laptop', '\u{1F310}': 'wifi', '\u{1F4FA}': 'tv',
  '\u{1F455}': 'shirt', '\u{1F6CD}\u{FE0F}': 'shopping-bag', '\u{1F484}': 'sparkles', '\u{1F381}': 'gift',
  '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}': 'users', '\u{1F43E}': 'paw-print', '\u{1F4BC}': 'briefcase', '\u{1F9F0}': 'wrench',
  '\u{1F527}': 'wrench', '\u{1F4A1}': 'lightbulb', '\u{1F4A7}': 'droplet', '\u{1F525}': 'flame',
  '\u{1F3DB}\u{FE0F}': 'landmark', '\u{1F4C4}': 'file-text', '\u{1F437}': 'piggy-bank', '\u{1F3AF}': 'target',
  '\u{2615}': 'coffee', '\u{1F354}': 'utensils', '\u{1F37A}': 'beer', '\u{1F9F9}': 'house',
  '\u{1F6E1}\u{FE0F}': 'shield', '\u{1F3E5}': 'heart-pulse', '\u{1F3B5}': 'music', '\u{1F3F7}\u{FE0F}': 'tag',
  '\u{1F3D6}\u{FE0F}': 'tree-palm', '\u{1F48D}': 'heart', '\u{1F476}': 'baby', '\u{1FAD9}': 'inbox',
};
const stripVS = (s) => String(s).replace(/\uFE0F/g, '');
/** Emoji (com ou sem o seletor de variação) → nome do ícone do sprite. */
export const EMOJI_ICONS = Object.fromEntries(Object.entries(EMOJI_LIST).flatMap(([k, v]) => [[k, v], [stripVS(k), v]]));

/** Valor de ícone guardado → sempre "i:nome" (emoji antigo vira o ícone equivalente; desconhecido, o padrão). */
export function toIconValue(value, fallback = 'i:tag') {
  const s = String(value || '');
  if (/^i:[a-z0-9-]+$/.test(s)) return s;
  const name = EMOJI_ICONS[s] || EMOJI_ICONS[stripVS(s)];
  return name ? `i:${name}` : fallback;
}

/** group: necessidades (needs), desejos (wants) ou poupança/investimento (savings) — regra 50/30/20. */
export const DEFAULT_CATEGORIES = [
  { name: 'Moradia', icon: 'i:house', group: 'needs', subcategories: [
    'Aluguel', 'Financiamento imobiliário', 'Condomínio', 'Energia elétrica',
    'Água e saneamento', 'Gás', 'Internet', 'Manutenção', 'Reformas e melhorias',
    'Móveis e utensílios', 'Seguro residencial', 'Serviços domésticos'] },
  { name: 'Alimentação', icon: 'i:utensils', group: 'needs', subcategories: [
    'Supermercado - Essenciais', 'Supermercado - Supérfluos', 'Restaurantes',
    'Delivery', 'Lanches e cafés', 'Bebidas', 'Suplementação'] },
  { name: 'Transporte', icon: 'i:car', group: 'needs', subcategories: [
    'Combustível', 'Transporte público', 'Apps de mobilidade', 'Manutenção do veículo',
    'Seguro veicular', 'IPVA e licenciamento', 'Estacionamento', 'Pedágios',
    'Multas de trânsito', 'Financiamento de veículo'] },
  { name: 'Saúde e bem-estar', icon: 'i:heart-pulse', group: 'needs', subcategories: [
    'Plano de saúde', 'Consultas', 'Exames', 'Medicamentos', 'Terapias',
    'Academia', 'Odontologia', 'Estética'] },
  { name: 'Educação', icon: 'i:graduation-cap', group: 'needs', subcategories: [
    'Mensalidade', 'Cursos', 'Pós-graduação', 'Certificações', 'Livros',
    'Material', 'Idiomas', 'Eventos e congressos'] },
  { name: 'Lazer e viagens', icon: 'i:plane', group: 'wants', subcategories: [
    'Jogos', 'Viagens - Transporte', 'Viagens - Hospedagem', 'Eventos',
    'Cinema e teatro', 'Hobbies', 'Passeios'] },
  { name: 'Assinaturas', icon: 'i:tv', group: 'wants', subcategories: [
    'Streaming', 'Softwares e apps', 'Armazenamento em nuvem', 'Clubes de assinatura'] },
  { name: 'Compras pessoais', icon: 'i:shopping-bag', group: 'wants', subcategories: [
    'Roupas', 'Eletrônicos', 'Acessórios', 'Cuidados pessoais', 'Presentes',
    'Compras por impulso'] },
  { name: 'Família e pets', icon: 'i:paw-print', group: 'needs', subcategories: [
    'Filhos', 'Pensão', 'Apoio familiar', 'Pets - Ração', 'Pets - Veterinário'] },
  { name: 'Trabalho', icon: 'i:briefcase', group: 'needs', subcategories: [
    'Equipamentos', 'Ferramentas e softwares', 'Uniformes e EPIs', 'Conselho/anuidade',
    'Deslocamento profissional'] },
  { name: 'Impostos e taxas', icon: 'i:receipt-text', group: 'needs', subcategories: [
    'IPTU', 'Imposto de renda', 'INSS', 'Taxas', 'Cartório'] },
  { name: 'Financeiro', icon: 'i:landmark', group: 'needs', subcategories: [
    'Tarifas bancárias', 'Juros', 'Multas por atraso', 'IOF', 'Cartão de crédito',
    'Empréstimos', 'Renegociações'] },
  { name: 'Investimentos', icon: 'i:trending-up', group: 'savings', subcategories: [
    'Renda fixa', 'Renda variável', 'Fundos imobiliários', 'Previdência', 'Reserva de emergência'] },
  { name: 'Outros', icon: 'i:tag', group: 'wants', subcategories: ['Diversos', 'Ajustes'] },
];

/** Grupo da regra 50/30/20 pelo NOME (para categorias de dados no formato antigo). */
export function groupOfCategory(name) {
  const n = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/invest|reserva|poupan|previd/.test(n)) return 'savings';
  if (/lazer|viage|assinat|compras|outros|delivery|restaur|hobby|presente/.test(n)) return 'wants';
  return 'needs';
}

export const GROUP_LABELS = { needs: 'Necessidades', wants: 'Desejos', savings: 'Poupança e investimentos' };

/** Tipos de receita (além do salário). */
export const INCOME_KIND_LABELS = {
  plantao: 'Plantão', extra: 'Renda extra', freela: 'Freela', reembolso: 'Reembolso', venda: 'Venda',
  presente: 'Presente', rendimento: 'Rendimento', outro: 'Outra receita',
};
