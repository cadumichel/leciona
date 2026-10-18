import { describe, it, expect } from 'vitest';
import { findPreviousLesson } from '../utils/retrospective';

// Dados inventados (nenhum nome real)
const SLOTS = [
  { id: 's1', startTime: '13:30', endTime: '14:15', type: 'class', label: '1' },
  { id: 's2', startTime: '14:15', endTime: '15:00', type: 'class', label: '2' },
  { id: 's3', startTime: '15:15', endTime: '16:00', type: 'class', label: '3' }
];

const D = (d: string) => `${d}T00:00:00.000Z`;
const log = (id: string, d: string, slotId: string, subject: string, extra: any = {}) =>
  ({ id, date: D(d), schoolId: 'C', classId: 'c183', slotId, subject, homework: '', notes: '', ...extra });

const base = (): any => ({
  profile: {}, settings: { isPrivateTeacher: false }, students: [], classRecords: [], grades: [], schedules: [],
  reminders: [], customAssessments: [], gradingConfigs: [],
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
    terms: [], midYearBreak: { start: '', end: '' }, extraRecesses: [{ id: 'r', name: 'Recesso', date: '2026-10-21' }] }],
  events: [],
  logs: [log('l1', '2026-10-05', 's3', 'Conteúdo X'), log('t1', '2026-10-06', 's1', 'Da outra turma', { classId: 'c163' })]
});

// Aula atual da 183 (o diário guarda a turma da grade pelo nome)
const aula = (date: string, slotId: string, startTime: string) =>
  ({ institutionId: 'C', classId: '183', date, slotId, startTime, isPrivate: false });

describe('retrospectiva do diário', () => {
  it('mostra a aula anterior mesmo sem conteúdo, em vez de pular para o último registro', () => {
    // 05/10 (seg) teve conteúdo X; 07/10 (qua) não teve registro; aula atual: 12/10 é feriado, então 14/10 (qua) 1ª aula
    const r = findPreviousLesson(base(), aula('2026-10-14', 's1', '13:30'));
    expect(r).toEqual({ date: '2026-10-07', subject: '', homework: '', hasContent: false });
  });

  it('com conteúdo na aula anterior, mostra o conteúdo', () => {
    const doc = base();
    doc.logs.push(log('l2', '2026-10-07', 's2', 'Feudalismo', { homework: 'p. 30' }));
    const r = findPreviousLesson(doc, aula('2026-10-14', 's1', '13:30'));
    expect(r).toEqual({ date: '2026-10-07', subject: 'Feudalismo', homework: 'p. 30', hasContent: true });
  });

  it('aula seguida no mesmo dia: a anterior é a aula de antes, no mesmo dia', () => {
    const doc = base();
    doc.logs.push(log('l3', '2026-10-14', 's1', 'Reino Franco'));
    expect(findPreviousLesson(doc, aula('2026-10-14', 's2', '14:15'))).toMatchObject({ date: '2026-10-14', subject: 'Reino Franco' });
  });

  it('pula feriado, recesso e aula removida (não são aulas que aconteceram)', () => {
    const doc = base();
    // Aula de 26/10 (seg): 21/10 (qua) é recesso; 19/10 (seg) foi removida; antes, 14/10 (qua) 2ª aula
    doc.logs.push(log('rem', '2026-10-19', 's3', '', { status: 'removed' }));
    doc.logs.push(log('l4', '2026-10-14', 's2', 'Islã'));
    expect(findPreviousLesson(doc, aula('2026-10-26', 's3', '15:15'))).toMatchObject({ date: '2026-10-14', subject: 'Islã' });
  });

  it('ignora registros de outra turma e aceita registro salvo com o nome da turma', () => {
    const doc = base();
    doc.logs.push(log('l5', '2026-10-12', 's3', 'Aula de reposição', { classId: '183', type: 'extra' }));
    // 12/10 é feriado, mas há aula extra registrada nesse dia para a 183
    expect(findPreviousLesson(doc, aula('2026-10-14', 's1', '13:30'))).toMatchObject({ date: '2026-10-12', subject: 'Aula de reposição' });
  });

  it('sem aula anterior no período, não mostra retrospectiva', () => {
    const doc = base();
    doc.scheduleVersions[0].activeFrom = '2026-10-14';
    doc.calendars[0].start = '2026-10-14';
    expect(findPreviousLesson(doc, aula('2026-10-14', 's1', '13:30'))).toBeNull();
  });
});
