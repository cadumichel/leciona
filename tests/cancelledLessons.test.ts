import { describe, it, expect } from 'vitest';
import { getLessonDisplayItems } from '../utils/lessonStats';
import { buildLogRows, cancelledLessonsWithoutLog } from '../utils/exportRows';

// Dados inventados (nenhum nome real)
const SLOTS = [
  { id: 's1', startTime: '07:30', endTime: '08:15', type: 'class', label: '1' },
  { id: 's2', startTime: '08:15', endTime: '09:00', type: 'class', label: '2' }
];

const base = (): any => ({
  profile: {}, settings: { isPrivateTeacher: false }, students: [], classRecords: [], grades: [], schedules: [],
  reminders: [], customAssessments: [], gradingConfigs: [], logs: [],
  schools: [{ id: 'E', name: 'Escola Teste', color: '#0a0', classes: [{ id: 'c6', name: '6º Ano' }, { id: 'c7', name: '7º Ano' }],
    shifts: [{ id: 'm', name: 'Matutino', slots: SLOTS }] }],
  // Terças: 6º Ano na 1ª aula, 7º Ano na 2ª
  scheduleVersions: [{ id: 'v', activeFrom: '2026-02-01', createdAt: '', schedules: [
    { id: 'e1', dayOfWeek: 2, schoolId: 'E', shiftId: 'm', slotId: 's1', classId: '6º Ano' },
    { id: 'e2', dayOfWeek: 2, schoolId: 'E', shiftId: 'm', slotId: 's2', classId: '7º Ano' }
  ] }],
  calendars: [{ id: 'cal', schoolId: 'E', year: 2026, division: 'bimestres', start: '2026-02-10', end: '2026-12-15',
    terms: [{ name: '4º Bimestre', start: '2026-10-01', end: '2026-12-15' }], midYearBreak: { start: '', end: '' },
    extraRecesses: [{ date: '2026-10-27', name: 'Recesso da escola' }] }],
  // Terça 20/10/2026: viagem só do 6º Ano (evento guarda o código da turma)
  events: [{ id: 'ev', type: 'trip', schoolId: 'E', classId: 'c6', date: '2026-10-20T00:00:00.000Z', title: 'Viagem de estudos', blocksClasses: true }]
});

const historico = (doc: any, status: 'all' | 'pending' | 'completed' = 'all', classId = 'all') => getLessonDisplayItems(doc, {
  start: '2026-10-20', end: '2026-10-27', schoolId: 'E', classId,
  showWithContent: status !== 'pending', showWithoutContent: status !== 'completed', includeCancelledByEvent: true
});

describe('aulas canceladas por evento no histórico do Diário', () => {
  it('aparecem marcadas com o evento ao filtrar a turma; recesso continua de fora', () => {
    const items = historico(base(), 'all', '6º Ano');
    expect(items.map(i => [i.date, i.cancelledBy, i.hasContent])).toEqual([['2026-10-20', 'Viagem de estudos', false]]);
  });

  it('a outra turma do dia segue normal', () => {
    const items = historico(base());
    const doDia = items.filter(i => i.date === '2026-10-20');
    expect(doDia.map(i => [i.schedule.classId, i.cancelledBy])).toEqual([['6º Ano', 'Viagem de estudos'], ['7º Ano', undefined]]);
  });

  it('com o registro automático "Evento: X" também fica como cancelada', () => {
    const doc = base();
    doc.logs = [{ id: 'l1', date: '2026-10-20T00:00:00.000Z', schoolId: 'E', classId: '6º Ano', slotId: 's1',
      subject: 'Evento: Viagem de estudos', homework: '', notes: 'Aula substituída por evento escolar.' }];
    const items = historico(doc, 'all', '6º Ano');
    expect(items).toHaveLength(1);
    expect(items[0].cancelledBy).toBe('Viagem de estudos');
    expect(items[0].log?.id).toBe('l1');
  });

  it('não aparecem nos filtros "pendentes" e "com conteúdo"', () => {
    expect(historico(base(), 'pending', '6º Ano')).toEqual([]);
    expect(historico(base(), 'completed', '6º Ano')).toEqual([]);
  });

  it('sem a opção (Início, pendências, cronograma) continuam escondidas', () => {
    const items = getLessonDisplayItems(base(), { start: '2026-10-20', end: '2026-10-20', schoolId: 'all', classId: 'all', showWithContent: true, showWithoutContent: true });
    expect(items.map(i => i.schedule.classId)).toEqual(['7º Ano']);
  });
});

describe('aulas canceladas por evento na exportação', () => {
  it('aula sem registro vira linha "Aula cancelada"', () => {
    const doc = base();
    const extras = cancelledLessonsWithoutLog(doc);
    expect(extras.map(l => [l.classId, l.slotId, l.cancelledBy])).toEqual([['6º Ano', 's1', 'Viagem de estudos']]);
    const [row] = buildLogRows(doc, extras);
    expect(row.Turma).toBe('6º Ano');
    expect(row.Situacao).toBe('Aula cancelada: Viagem de estudos');
    expect(row.Conteudo).toBe('Evento: Viagem de estudos');
  });

  it('aula com o registro automático não duplica e ganha a situação', () => {
    const doc = base();
    doc.logs = [{ id: 'l1', date: '2026-10-20T00:00:00.000Z', schoolId: 'E', classId: '6º Ano', slotId: 's1',
      subject: 'Evento: Viagem de estudos', homework: '', notes: 'Aula substituída por evento escolar.' }];
    expect(cancelledLessonsWithoutLog(doc)).toEqual([]);
    expect(buildLogRows(doc, doc.logs)[0].Situacao).toBe('Aula cancelada: Viagem de estudos');
  });

  it('registro normal fica com a situação vazia', () => {
    const doc = base();
    const log = { id: 'l2', date: '2026-10-20T00:00:00.000Z', schoolId: 'E', classId: '7º Ano', slotId: 's2', subject: 'Revolução Francesa', homework: '', notes: '' };
    expect(buildLogRows(doc, [log as any])[0].Situacao).toBe('');
  });
});
