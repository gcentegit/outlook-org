import { describe, expect, it } from 'vitest';

import { countDecidedByRule } from './rules';

const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T10:00:00Z`);

describe('countDecidedByRule', () => {
  it('cuenta solo la decisión vigente de cada correo, sin fallos técnicos y con origen regla', () => {
    const counts = countDecidedByRule([
      // Correo 1: la decisión antigua era de r1; la vigente, de r2.
      {
        messageId: 'm1',
        createdAt: at(1),
        degraded: false,
        decision: { source: 'rule', ruleId: 'r1' },
      },
      {
        messageId: 'm1',
        createdAt: at(2),
        degraded: false,
        decision: { source: 'rule', ruleId: 'r2' },
      },
      {
        messageId: 'm2',
        createdAt: at(1),
        degraded: false,
        decision: { source: 'rule', ruleId: 'r2' },
      },
      // Con fallo técnico no cuenta.
      {
        messageId: 'm3',
        createdAt: at(1),
        degraded: true,
        decision: { source: 'rule', ruleId: 'r1' },
      },
      // Decidido por el hilo o sin regla: no cuenta.
      {
        messageId: 'm4',
        createdAt: at(1),
        degraded: false,
        decision: { source: 'thread', ruleId: null },
      },
      { messageId: 'm5', createdAt: at(1), degraded: false, decision: null },
    ]);
    expect(Object.fromEntries(counts)).toEqual({ r2: 2 });
  });
});
