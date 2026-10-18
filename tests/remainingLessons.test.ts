import { describe, it, expect } from 'vitest';
import { countRemainingLessons } from '../utils/remainingLessons';
import { aulasRestantes } from '../connector/consultas';

// Dados inventados (nenhum nome real)
const SLOTS = [
  { id: 's1', startTime: '13:30', endTime: '14:15', type: 'class', label: '1' },
  { id: 's2', startTime: '14:15', endTime: '15:00', type: 'class', label: '2' },
  { id: 's3', startTime: '15:15', endTime: '16:00', type: 'class', label: '3' }
];

const base = (): any => ({
  profile: {}, settings: { isPrivateTeacher: false }, students: [], classRecords: [], grades: [], schedules: [],
  reminders: [], customAssessments: [], gradingConfigs: [], logs: [],
  schools: [{ id: 'C', name: 'Cônsul', color: '#f00', classes: [{ id: 'c183', name: '183' }, { id: 'c163', name: '163' }],
    shifts: [{ id: 'cv', name: 'Vespertino', slots: SLOTS }] }],
  // 183: segunda (3ª aula) e quarta (1ª e 2ª aulas seguidas); 163: terça
  scheduleVersions: [{ id: 'v', activeFrom: '2026-02-01', createdAt: '', schedules: [
    { id: 'e1', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's3', classId: '183' },
    { id: 'e2', dayOfWeek: 3, schoolId: 'C', shiftId: 'cv', slotId: 's1', classId: '183' },
    { id: 'e3', dayOfWeek: 3, schoolId: 'C', shiftId: 'cv', slotId: 's2', classId: '183' },
    { id: 'e4', dayOfWeek: 2, schoolId: 'C', shiftId: 'cv', slotId: 's1', classId: '163' }
  ] }],
  calendars: [{ id: 'cal', schoolId: 'C', year: 2026, division: 'trimestres', start: '2026-02-10', end: '2026-12-15',
    terms: [
      { name: '2º Trimestre', start: '2026-05-18', end: '2026-09-04' },
      { name: '3º Trimestre', start: '2026-09-08', end: '2026-10-30' }
    ],
    midYearBreak: { start: '', end: '' }, extraRecesses: [{ id: 'r', name: 'Recesso', date: '2026-10-21' }] }],
  events: [{ id: 'p3', type: 'test', schoolId: 'C', classId: 'c183', slotId: 's3', date: '2026-10-26T00:00:00.000Z', title: 'P3' }]
});

describe('aulas que faltam até o fim do período', () => {
  it('na janela do Diário: conta as aulas depois da atual, sem feriado e recesso, com aulas seguidas separadas', () => {
    // Quarta 14/10, 1ª aula. Faltam: 14/10 2ª aula, 19/10, (21/10 recesso), 26/10, 28/10 1ª e 2ª → 5
    const r = countRemainingLessons(base(), { schoolId: 'C', classId: '183', date: '2026-10-14', afterStartTime: '13:30' })!;
    expect(r.count).toBe(5);
    expect(r.dates).toEqual(['2026-10-14', '2026-10-19', '2026-10-26', '2026-10-28', '2026-10-28']);
    expect(r.term.name).toBe('3º Trimestre');
    // P3 em 26/10 (3ª aula): antes dela, 14/10 2ª aula e 19/10
    expect(r.nextAssessment).toEqual({ title: 'P3', date: '2026-10-26', lessonsBefore: 2 });
  });

  it('última aula do período: zero', () => {
    const r = countRemainingLessons(base(), { schoolId: 'C', classId: '183', date: '2026-10-28', afterStartTime: '14:15' })!;
    expect(r.count).toBe(0);
    expect(r.nextAssessment).toBeUndefined();
  });

  it('sem calendário com períodos, não mostra nada', () => {
    const doc = base();
    doc.calendars = [];
    expect(countRemainingLessons(doc, { schoolId: 'C', classId: '183', date: '2026-10-14' })).toBeNull();
  });

  it('no Claude: de hoje (inclusive) até o fim do período ou até uma data', () => {
    const r = aulasRestantes(base(), { turma: '183', hoje: '2026-10-14' });
    expect(r).toMatchObject({ escola: 'Cônsul', turma: '183', periodo: '3º Trimestre', ate: '2026-10-30', aulas: 6,
      proximaAvaliacao: { titulo: 'P3', dataBR: '26/10/2026', aulasAntes: 3 } });
    expect(r.datas[0]).toBe('quarta 14/10/2026');
    expect(aulasRestantes(base(), { turma: '183', hoje: '2026-10-14', ate: '2026-10-19' }).aulas).toBe(3);
    expect(() => aulasRestantes({ ...base(), calendars: [] }, { turma: '183', hoje: '2026-10-14' })).toThrow(/não tem bimestres/);
  });
});
