// Estado vazio para os testes, criado "há muito tempo": os testes montam
// históricos em meses fixos (2026-01, 2026-10…) e não podem depender do
// relógio real — o app só conta a partir do mês em que a conta foi criada
// (ver js/domain/tracking.js).

import { createEmptyState } from '../js/domain/schema.js';

export const LONG_AGO = '2020-01-01T00:00:00.000Z';

export function emptyState() {
  const s = createEmptyState();
  s.createdAt = LONG_AGO;
  return s;
}
