import { describe, it, expect } from 'vitest';
import { groupPendencies, currentTermStart } from '../utils/pendencies';

const school = { id: 'sc1', name: 'Colégio Exemplo', color: '#000', subjects: [], shifts: [], classes: [{ id: 'c1', name: 'Turma A' }, { id: 'c2', name: 'Turma B' }] };
const cal = {
  id: 'cal', schoolId: 'sc1', year: 2026, division: 'trimestres' as const,
  terms: [{ name: '1º TRI', start: '2026-02-09', end: '2026-05-15' }, { name: '2º TRI', start: '2026-05-18', end: '2026-08-28' }, { name: '3º TRI', start: '2026-08-31', end: '2026-11-27' }],
  midYearBreak: { start: '2026-07-13', end: '2026-07-24' }, extraRecesses: [], start: '2026-02-09', end: '2026-11-27',
};
const data = { schools: [school], calendars: [cal] } as any;
const item = (classId: string, date: string, start = '08:15') => ({
  id: `${classId}-${date}-${start}`, date, schedule: { id: 'x', dayOfWeek: 1, schoolId: 'sc1', shiftId: 'sh', slotId: start, classId },
  institution: school, slot: { id: start, startTime: start, endTime: '09:00', type: 'class', label: '' }, dayOfWeek: 1, hasContent: false, isPast: true,
}) as any;

describe('pendências do Diário', () => {
  it('período atual: termo em que estamos, ou o último que já começou (entre períodos)', () => {
    expect(currentTermStart(data, 'sc1', '2026-11-04')).toEqual({ start: '2026-08-31', name: '3º TRI' });
    expect(currentTermStart(data, 'sc1', '2026-08-30')).toEqual({ start: '2026-05-18', name: '2º TRI' });
    expect(currentTermStart(data, 'outra', '2026-11-04')).toBeNull();
  });

  it('separa período atual e anteriores, agrupa por turma e ordena', () => {
    const r = groupPendencies(data, [
      item('Turma A', '2026-09-02'), item('Turma B', '2026-10-01'), item('Turma B', '2026-11-02'), item('Turma A', '2026-06-01'),
    ], '2026-11-04');
    expect(r.currentLabel).toBe('3º TRI');
    expect(r.current.map(g => [g.className, g.items.length])).toEqual([['Turma B', 2], ['Turma A', 1]]);
    expect(r.current[0].items.map(i => i.date)).toEqual(['2026-11-02', '2026-10-01']);
    expect(r.older.map(g => [g.className, g.items.length])).toEqual([['Turma A', 1]]);
  });

  it('escola sem calendário: tudo conta como atual', () => {
    const r = groupPendencies({ schools: [school], calendars: [] } as any, [item('Turma A', '2025-03-01')], '2026-11-04');
    expect(r.current).toHaveLength(1);
    expect(r.older).toHaveLength(0);
    expect(r.currentLabel).toBeNull();
  });
});
