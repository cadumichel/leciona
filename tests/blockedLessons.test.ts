import { describe, it, expect } from 'vitest';
import { getLessonDisplayItems, deriveStatsFromLessons, getNoLessonReason } from '../utils/lessonStats';
import { buildTodayTimeline, todayLessonStatus } from '../utils/dashboardWeb';

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
    terms: [{ name: '4º Bimestre', start: '2026-10-01', end: '2026-12-15' }], midYearBreak: { start: '', end: '' }, extraRecesses: [] }],
  // Terça 13/10/2026: evento da escola toda que suspende as aulas
  events: [{ id: 'ev', type: 'other', schoolId: 'E', date: '2026-10-13T00:00:00.000Z', title: 'Dia do Professor', blocksClasses: true }]
});

const DIA = '2026-10-13';

describe('aulas em dia de evento que suspende aula', () => {
  it('não aparecem nas aulas do dia nem contam como pendentes', () => {
    const items = getLessonDisplayItems(base(), { start: DIA, end: DIA, schoolId: 'all', classId: 'all', showWithContent: true, showWithoutContent: true });
    expect(items).toEqual([]);
    expect(deriveStatsFromLessons(items).pending).toBe(0);

    // Sem o evento, as duas aulas ficariam pendentes (dia passado sem registro)
    const semEvento = { ...base(), events: [] };
    const normais = getLessonDisplayItems(semEvento, { start: DIA, end: DIA, schoolId: 'all', classId: 'all', showWithContent: true, showWithoutContent: true });
    expect(deriveStatsFromLessons(normais).pending).toBe(2);
  });

  it('o cartão do Diário mostra "Sem aula" com o nome do evento, também com registro vazio ou o automático "Evento: X"', () => {
    const doc = base();
    expect(getNoLessonReason(doc, DIA, 'E', 'm', '6º Ano')).toBe('Dia do Professor');
    expect(getNoLessonReason(doc, DIA, 'E', 'm', '6º Ano', { subject: '', homework: '', notes: '' } as any)).toBe('Dia do Professor');
    const automatico = { subject: 'Evento: Dia do Professor', homework: '', notes: 'Aula substituída por evento escolar.' } as any;
    expect(getNoLessonReason(doc, DIA, 'E', 'm', '6º Ano', automatico)).toBe('Dia do Professor');
    // Se o professor escreveu algo, vale o registro dele
    expect(getNoLessonReason(doc, DIA, 'E', 'm', '6º Ano', { subject: 'Revisão', homework: '', notes: '' } as any)).toBeNull();
    // Outro dia: aula normal
    expect(getNoLessonReason(doc, '2026-10-20', 'E', 'm', '6º Ano')).toBeNull();
    // Feriado nacional também
    expect(getNoLessonReason(doc, '2026-10-12', 'E', 'm', '6º Ano')).toBeTruthy();
  });

  it('evento de uma turma só bloqueia a aula dela (evento guarda o código, grade guarda o nome)', () => {
    const doc = base();
    doc.events = [{ id: 'ev', type: 'trip', schoolId: 'E', classId: 'c6', date: '2026-10-13T00:00:00.000Z', title: 'Passeio', blocksClasses: true }];
    const items = getLessonDisplayItems(doc, { start: DIA, end: DIA, schoolId: 'all', classId: 'all', showWithContent: true, showWithoutContent: true });
    expect(items.map(i => i.schedule.classId)).toEqual(['7º Ano']);
    expect(getNoLessonReason(doc, DIA, 'E', 'm', '6º Ano')).toBe('Passeio');
    expect(getNoLessonReason(doc, DIA, 'E', 'm', '7º Ano')).toBeNull();
  });

  it('no Início, as aulas do dia aparecem como suspensas, não pendentes', () => {
    const aulas = buildTodayTimeline(base(), DIA).flatMap(g => g.lessons);
    expect(aulas.length).toBe(2);
    expect(aulas.map(l => todayLessonStatus(l, 23 * 60))).toEqual(['blocked', 'blocked']);
  });
});
