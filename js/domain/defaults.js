// @ts-check
// =============================================================
// defaults.js — Categorias padrão, paleta e ícones
// -------------------------------------------------------------
// • Ícones das categorias: ícones próprios (SVG do sprite, prefixo
//   "i:") desenhados dentro de um círculo da cor da categoria — iguais
//   no Windows, Android e iPhone. Emojis de cadastros antigos
//   continuam funcionando (ver ui/catIcon.js).
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

/** Emojis das versões antigas → ícone equivalente (para o visual ficar uniforme). */
export const EMOJI_ICONS = {
  '🏠': 'house', '🍽️': 'utensils', '🛒': 'shopping-cart', '🚗': 'car', '⛽': 'fuel', '🚌': 'bus', '💊': 'pill',
  '🩺': 'stethoscope', '🏋️': 'dumbbell', '🎓': 'graduation-cap', '📚': 'book-open', '🎮': 'gamepad-2', '✈️': 'plane',
  '🎬': 'clapperboard', '🎉': 'party-popper', '💳': 'credit-card', '🏦': 'landmark', '📈': 'trending-up', '💰': 'circle-dollar-sign',
  '🧾': 'receipt-text', '📱': 'smartphone', '💻': 'laptop', '🌐': 'wifi', '📺': 'tv', '👕': 'shirt', '🛍️': 'shopping-bag',
  '💄': 'sparkles', '🎁': 'gift', '👨‍👩‍👧': 'users', '🐾': 'paw-print', '💼': 'briefcase', '🧰': 'wrench', '🔧': 'wrench',
  '💡': 'lightbulb', '💧': 'droplet', '🔥': 'flame', '🏛️': 'landmark', '📄': 'file-text', '🐷': 'piggy-bank', '🎯': 'target',
  '☕': 'coffee', '🍔': 'utensils', '🍺': 'beer', '🧹': 'house', '🛡️': 'shield', '🏥': 'heart-pulse', '🎵': 'music', '🏷️': 'tag',
};

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
export const INCOME_KIND_ICONS = {
  plantao: 'stethoscope', extra: 'circle-dollar-sign', freela: 'laptop', reembolso: 'rotate-ccw', venda: 'store',
  presente: 'gift', rendimento: 'trending-up', outro: 'circle-dollar-sign',
};
