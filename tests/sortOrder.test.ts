import { describe, expect, it } from 'vitest';
import { byDate } from '../components/SortOrderButton';

describe('ordem por data das listas', () => {
  const items = [{ date: '2026-11-12T00:00:00.000Z' }, { date: '2026-10-01T00:00:00.000Z' }, { date: '2026-11-03T00:00:00.000Z' }];
  it('mais antigos primeiro', () => {
    expect([...items].sort(byDate('asc')).map(i => i.date.slice(0, 10))).toEqual(['2026-10-01', '2026-11-03', '2026-11-12']);
  });
  it('mais recentes primeiro', () => {
    expect([...items].sort(byDate('desc')).map(i => i.date.slice(0, 10))).toEqual(['2026-11-12', '2026-11-03', '2026-10-01']);
  });
});
