import { describe, it, expect } from 'vitest';
import { getLessonDisplayItems } from '../utils/lessonStats';

// Dados inventados (nenhum nome real)
const SLOTS = [
  { id: 's1', startTime: '07:30', endTime: '08:15', type: 'class', label: '1' },
  { id: 's2', startTime: '08:15', endTime: '09:00', type: 'class', label: '2' }
];
const base = (logs: any[]): any => ({
  profile: {}, settings: { isPrivateTeacher: false }, students: [], classRecords: [], grades: [], schedules: [],
  reminders: [], customAssessments: [], gradingConfigs: [], events: [], calendars: [], logs,
  schools: [{ id: 'E', name: 'Escola Teste', color: '#0a0', classes: [{ id: 'c6', name: '6º Ano' }], shifts: [{ id: 'm', name: 'Matutino', slots: SLOTS }] }],
  // Terças: 6º Ano nas duas primeiras aulas
  scheduleVersions: [{ id: 'v', activeFrom: '2026-02-01', createdAt: '', schedules: [
    { id: 'e1', dayOfWeek: 2, schoolId: 'E', shiftId: 'm', slotId: 's1', classId: '6º Ano' },
    { id: 'e2', dayOfWeek: 2, schoolId: 'E', shiftId: 'm', slotId: 's2', classId: '6º Ano' }
  ] }]
});
const todas = (doc: any) => getLessonDisplayItems(doc, { start: '2026-10-19', end: '2026-10-28', schoolId: 'all', classId: 'all', showWithContent: true, showWithoutContent: true });
const log = (id: string, date: string, slotId: string, over: any = {}) => ({ id, date, schoolId: 'E', classId: 'c6', slotId, subject: 'Conteúdo', homework: '', notes: '', ...over });

describe('aulas do período: registros agrupados por dia', () => {
  it('cada aula encontra o registro do seu dia e horário (e só ele)', () => {
    const items = todas(base([
      log('a', '2026-10-20T00:00:00.000Z', 's1'),
      log('b', '2026-10-27T00:00:00.000Z', 's2'),
      log('c', '2026-10-20', 's2') // data sem a parte da hora
    ]));
    expect(items.map(i => [i.date, i.schedule.slotId, i.log?.id, i.hasContent])).toEqual([
      ['2026-10-20', 's1', 'a', true], ['2026-10-20', 's2', 'c', true],
      ['2026-10-27', 's1', undefined, false], ['2026-10-27', 's2', 'b', true]
    ]);
  });

  it('registro "regular" já ligado a uma aula da grade não aparece em dobro; aula extra aparece uma vez', () => {
    const items = todas(base([
      log('a', '2026-10-20T00:00:00.000Z', 's1', { type: 'regular' }),
      log('x', '2026-10-21T00:00:00.000Z', 'extra-1', { type: 'extra', startTime: '10:00', endTime: '10:45' })
    ]));
    expect(items.filter(i => i.log?.id === 'a')).toHaveLength(1);
    expect(items.filter(i => i.log?.id === 'x').map(i => i.isExtra)).toEqual([true]);
  });

  it('um ano de diário (1.500 registros) é calculado rápido', () => {
    const logs: any[] = [];
    for (let t = new Date('2025-11-18T12:00:00'); logs.length < 1500; t.setDate(t.getDate() + 1)) {
      const d = t.toLocaleDateString('en-CA');
      for (let k = 0; k < 6; k++) logs.push(log('l' + logs.length, d + 'T00:00:00.000Z', k < 2 ? 's' + (k + 1) : 'outro' + k));
    }
    const doc = base(logs);
    const t0 = performance.now();
    const items = getLessonDisplayItems(doc, { start: '2025-11-18', end: '2026-11-17', schoolId: 'all', classId: 'all', showWithContent: true, showWithoutContent: true });
    const ms = performance.now() - t0;
    expect(items.length).toBeGreaterThan(50);
    expect(ms).toBeLessThan(200); // folga grande: aqui leva poucos ms; antes passava de 50 ms
  });
});
