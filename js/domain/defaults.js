// =============================================================
// defaults.js — Categorias padrão e paleta de cores
// -------------------------------------------------------------
// Ícones são emojis: não pesam nada e funcionam offline.
// =============================================================

export const CATEGORY_COLORS = [
  '#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2',
  '#DB2777', '#65A30D', '#EA580C', '#4F46E5', '#0D9488', '#9333EA',
  '#CA8A04', '#475569', '#BE123C', '#15803D',
];

export const CATEGORY_ICONS = [
  '🏠', '🍽️', '🛒', '🚗', '⛽', '🚌', '💊', '🩺', '🏋️', '🎓', '📚', '🎮',
  '✈️', '🎬', '🎉', '💳', '🏦', '📈', '💰', '🧾', '📱', '💻', '🌐', '📺',
  '👕', '🛍️', '💄', '🎁', '👨‍👩‍👧', '🐾', '💼', '🧰', '🔧', '💡', '💧', '🔥',
  '🏛️', '📄', '🐷', '🎯', '☕', '🍔', '🍺', '🧹', '🛡️', '🏥', '🎵', '🏷️',
];

export const DEFAULT_CATEGORIES = [
  { name: 'Moradia', icon: '🏠', subcategories: [
    'Aluguel', 'Financiamento imobiliário', 'Condomínio', 'Energia elétrica',
    'Água e saneamento', 'Gás', 'Internet', 'Manutenção', 'Reformas e melhorias',
    'Móveis e utensílios', 'Seguro residencial', 'Serviços domésticos'] },
  { name: 'Alimentação', icon: '🍽️', subcategories: [
    'Supermercado - Essenciais', 'Supermercado - Supérfluos', 'Restaurantes',
    'Delivery', 'Lanches e cafés', 'Bebidas', 'Suplementação'] },
  { name: 'Transporte', icon: '🚗', subcategories: [
    'Combustível', 'Transporte público', 'Apps de mobilidade', 'Manutenção do veículo',
    'Seguro veicular', 'IPVA e licenciamento', 'Estacionamento', 'Pedágios',
    'Multas de trânsito', 'Financiamento de veículo'] },
  { name: 'Saúde e bem-estar', icon: '🩺', subcategories: [
    'Plano de saúde', 'Consultas', 'Exames', 'Medicamentos', 'Terapias',
    'Academia', 'Odontologia', 'Estética'] },
  { name: 'Educação', icon: '🎓', subcategories: [
    'Mensalidade', 'Cursos', 'Pós-graduação', 'Certificações', 'Livros',
    'Material', 'Idiomas', 'Eventos e congressos'] },
  { name: 'Lazer e viagens', icon: '🎮', subcategories: [
    'Jogos', 'Viagens - Transporte', 'Viagens - Hospedagem', 'Eventos',
    'Cinema e teatro', 'Hobbies', 'Passeios'] },
  { name: 'Assinaturas', icon: '📺', subcategories: [
    'Streaming', 'Softwares e apps', 'Armazenamento em nuvem', 'Clubes de assinatura'] },
  { name: 'Compras pessoais', icon: '🛍️', subcategories: [
    'Roupas', 'Eletrônicos', 'Acessórios', 'Cuidados pessoais', 'Presentes',
    'Compras por impulso'] },
  { name: 'Família e pets', icon: '🐾', subcategories: [
    'Filhos', 'Pensão', 'Apoio familiar', 'Pets - Ração', 'Pets - Veterinário'] },
  { name: 'Trabalho', icon: '💼', subcategories: [
    'Equipamentos', 'Ferramentas e softwares', 'Uniformes e EPIs', 'Conselho/anuidade',
    'Deslocamento profissional'] },
  { name: 'Impostos e taxas', icon: '🧾', subcategories: [
    'IPTU', 'Imposto de renda', 'INSS', 'Taxas', 'Cartório'] },
  { name: 'Financeiro', icon: '🏦', subcategories: [
    'Tarifas bancárias', 'Juros', 'Multas por atraso', 'IOF', 'Cartão de crédito',
    'Empréstimos', 'Renegociações'] },
  { name: 'Investimentos', icon: '📈', subcategories: [
    'Renda fixa', 'Renda variável', 'Fundos imobiliários', 'Previdência', 'Reserva de emergência'] },
  { name: 'Outros', icon: '🏷️', subcategories: ['Diversos', 'Ajustes'] },
];
