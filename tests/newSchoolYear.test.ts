import { describe, it, expect } from 'vitest';
import {
  shiftDateToYear, splitTerms, suggestNextYear, defaultPlan, buildNewSchoolYear, withYear, summarizeCurrentYear
} from '../utils/newSchoolYear';

const C183 = 'c183-0000-4000-8000-000000000000';
const C184 = 'c184-0000-4000-8000-000000000000';
const COLD = 'cold-0000-4000-8000-000000000000';

const data2026: any = {
  profile: { name: 'Cadu', subjects: ['História'], setupCompleted: true },
  settings: { themeColor: '#2563eb', showQuickStartGuide: true },
  schools: [
    { id: 'S1', name: 'Cônsul', color: '#000', subjects: [], shifts: [{ id: 'v', name: 'Vespertino', slots: [{ id: 's1', startTime: '13:30', endTime: '14:15', type: 'class', label: '1ª' }] }],
      classes: [{ id: C183, name: '183' }, { id: C184, name: '184' }, { id: COLD, name: '173', deleted: true }] },
    { id: 'S2', name: 'Escola que saiu', color: '#111', subjects: [], shifts: [], classes: [{ id: 'x', name: 'X' }] },
    { id: 'S3', name: 'Escola excluída', deleted: true, color: '#222', subjects: [], shifts: [], classes: [] }
  ],
  students: [{ id: 'P1', name: 'Particular', subject: 'História', color: '#333', startDate: '2026-03-01', schedules: [], payments: [{ id: 'pay', date: '2026-04-01', amount: 100 }] }],
  classRecords: [{ id: 'r', schoolId: 'S1', classId: C183, students: [{ id: 'a', name: 'Ana' }] }],
  schedules: [],
  scheduleVersions: [
    { id: 'v1', activeFrom: '2026-02-04', createdAt: '', name: 'Versão 2026', schedules: [{ id: 'old', dayOfWeek: 1, schoolId: 'S1', shiftId: 'v', slotId: 's1', classId: '183' }] },
    { id: 'v2', activeFrom: '2026-02-27', createdAt: '', name: 'Versão 2026', schedules: [
      { id: 'e1', dayOfWeek: 2, schoolId: 'S1', shiftId: 'v', slotId: 's1', classId: '183' },
      { id: 'e2', dayOfWeek: 3, schoolId: 'S1', shiftId: 'v', slotId: 's1', classId: '184' },
      { id: 'e3', dayOfWeek: 4, schoolId: 'S1', shiftId: 'v', slotId: 's1', classId: 'window' },
      { id: 'e4', dayOfWeek: 5, schoolId: 'S2', shiftId: 'm', slotId: 'z', classId: 'X' }
    ] }
  ],
  logs: [{ id: 'L1', date: '2026-10-13T00:00:00.000Z', schoolId: 'S1', classId: '183', slotId: 's1', subject: 'Aula', homework: '', notes: '' }],
  events: [{ id: 'P', date: '2026-10-20T00:00:00.000Z', schoolId: 'S1', classId: C183, type: 'test', title: 'Prova', description: '', blocksClasses: false }],
  calendars: [{ id: 'cal', schoolId: 'S1', year: 2026, division: 'trimestres', start: '2026-02-09', end: '2026-12-10',
    terms: [{ name: '1º Trimestre', start: '2026-02-09', end: '2026-05-08' }, { name: '2º Trimestre', start: '2026-05-11', end: '2026-08-21' }, { name: '3º Trimestre', start: '2026-08-24', end: '2026-12-10' }],
    midYearBreak: { start: '2026-07-13', end: '2026-07-24' }, extraRecesses: [{ id: 'carnaval', name: 'Carnaval', date: '2026-02-17' }] }],
  reminders: [{ id: 'R-old', date: '2026-03-23', title: 'velho' }, { id: 'R-new', date: '2027-02-01', title: 'reunião pedagógica' }],
  grades: [{ id: 'g', studentId: 'a', assessmentId: 'P', value: 8 }],
  customAssessments: [], gradingConfigs: [],
  _deleted: { algo: 1 }
};

describe('datas do novo ano', () => {
  it('leva a data para o ano seguinte', () => {
    expect(shiftDateToYear('2026-02-09', 2027)).toBe('2027-02-09');
    expect(shiftDateToYear('2028-02-29', 2029)).toBe('2029-02-28');
  });
  it('divide em trimestres e bimestres sem buracos', () => {
    const t = splitTerms('2027-02-01', '2027-12-10', 'trimestres');
    expect(t).toHaveLength(3);
    expect(t[0].start).toBe('2027-02-01');
    expect(t[2].end).toBe('2027-12-10');
    expect(splitTerms('2027-02-01', '2027-12-10', 'bimestres')).toHaveLength(4);
  });
  it('sugere o ano seguinte ao último calendário', () => expect(suggestNextYear(data2026)).toBe(2027));
});

describe('plano padrão', () => {
  it('mantém escolas ativas e turmas ativas, com o calendário de 2026 trazido para 2027', () => {
    const plan = defaultPlan(data2026);
    expect(plan.year).toBe(2027);
    expect(plan.schools.map(s => s.schoolId)).toEqual(['S1', 'S2']);
    expect(plan.schools[0].classes.map(c => c.name)).toEqual(['183', '184']);
    expect(plan.schools[0].calendar.start).toBe('2027-02-09');
    expect(plan.schools[0].calendar.terms[1]).toEqual({ name: '2º Trimestre', start: '2027-05-11', end: '2027-08-21' });
    expect(plan.schools[0].calendar.midYearBreak).toEqual({ start: '2027-07-13', end: '2027-07-24' });
  });
  it('trocar o ano recalcula o calendário e mantém as escolhas de turmas', () => {
    const plan = defaultPlan(data2026);
    plan.schools[0].classes[1].keep = false;
    const p2 = withYear(data2026, plan, 2028);
    expect(p2.schools[0].calendar.start).toBe('2028-02-09');
    expect(p2.schools[0].classes[1].keep).toBe(false);
  });
});

describe('buildNewSchoolYear', () => {
  const plan = defaultPlan(data2026);
  plan.schools[1].keep = false;                       // escola que saiu
  plan.schools[0].classes[1].name = '184 A';          // turma renomeada
  const now = new Date('2026-12-20T12:00:00-03:00');
  const out = buildNewSchoolYear(data2026, plan, now);

  it('mantém perfil, configurações e só as escolas escolhidas', () => {
    expect(out.profile.name).toBe('Cadu');
    expect(out.schools.map(s => s.name)).toEqual(['Cônsul']);
    expect(out.schools[0].shifts).toHaveLength(1);
  });

  it('mantém o código das turmas, aplica o novo nome e descarta turmas excluídas', () => {
    expect(out.schools[0].classes).toEqual([{ id: C183, name: '183' }, { id: C184, name: '184 A' }]);
  });

  it('grade: copia a versão em vigor como rascunho do novo ano, com nomes atualizados', () => {
    expect(out.scheduleVersions).toHaveLength(1);
    const v = out.scheduleVersions[0];
    expect(v.activeFrom).toBe('2027-01-01');
    expect(v.schedules.map(e => e.classId)).toEqual(['183', '184 A', 'window']);
  });

  it('começa do zero: aulas, avaliações, notas, listas e lembretes antigos', () => {
    expect(out.logs).toEqual([]);
    expect(out.events).toEqual([]);
    expect(out.grades).toEqual([]);
    expect(out.classRecords).toEqual([]);
    expect(out.reminders.map(r => r.id)).toEqual(['R-new']);
  });

  it('calendário de 2027 sem os recessos de 2026', () => {
    expect(out.calendars).toHaveLength(1);
    expect(out.calendars[0]).toMatchObject({ schoolId: 'S1', year: 2027, start: '2027-02-09', extraRecesses: [] });
  });

  it('alunos particulares continuam, sem o histórico de pagamentos', () => {
    expect(out.students[0].name).toBe('Particular');
    expect(out.students[0].payments).toEqual([]);
  });

  it('marca a virada e zera as lápides', () => {
    expect(out._schoolYear).toBe(2027);
    expect(out._yearResetAt).toBe(now.toISOString());
    expect(out._deleted).toBeUndefined();
  });

  it('dados ficam pequenos', () => {
    expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(data2026).length);
  });

  it('resumo do ano atual', () => {
    expect(summarizeCurrentYear(data2026)).toMatchObject({ logs: 1, events: 1, grades: 1, rosters: 1, reminders: 2 });
  });

  it('sem copiar a grade: começa em branco', () => {
    const p = { ...defaultPlan(data2026), keepSchedule: false };
    expect(buildNewSchoolYear(data2026, p, now).scheduleVersions).toEqual([]);
  });
});
