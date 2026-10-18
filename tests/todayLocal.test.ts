import { describe, it, expect } from 'vitest';
import { todayLocal } from '../utils';

describe('data de hoje no fuso do aparelho', () => {
  it('depois das 21h em Brasília continua sendo hoje (a data de Londres já é amanhã)', () => {
    const noite = new Date('2026-10-18T23:30:00-03:00');
    expect(noite.toISOString().split('T')[0]).toBe('2026-10-19');
    expect(todayLocal(noite)).toBe('2026-10-18');
  });
});
