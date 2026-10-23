import { describe, it, expect } from 'vitest';
import { applyScheduleDecisions, nextVersionStart, planScheduleChange } from '../utils/scheduleChange';
import { getLessonDisplayItems } from '../utils/lessonStats';
import { DayOfWeek, ScheduleEntry } from '../types';

// Dados inventados no formato real: horários com códigos aleatórios, turma pelo nome na grade
// e pelo código no diário e nas avaliações.
const S1 = 'f9a1-primeira', S2 = '0b22-segunda', S3 = '7c33-terceira';
const D = (d: string) => `${d}T00:00:00.000Z`;
const e = (id: string, dow: number, slotId: string, classId = '183'): ScheduleEntry => ({ id, dayOfWeek: dow as DayOfWeek, schoolId: 'C', shiftId: 'cv', slotId, classId });
const log = (id: string, d: string, slotId: string, subject = 'conteúdo', extra: any = {}) =>
  ({ id, date: D(d), schoolId: 'C', classId: 'c183', slotId, subject, homework: '', notes: '', ...extra });

const base = (): any => ({
  profile: {}, settings: {}, students: [], classRecords: [], grades: [], schedules: [], reminders: [],
  customAssessments: [], gradingConfigs: [],
  schools: [{ id: 'C', name: 'Cônsul', color: '#f00', classes: [{ id: 'c183', name: '183' }, { id: 'c163', name: '163' }],
    shifts: [{ id: 'cv', name: 'Vespertino', slots: [
      { id: S1, startTime: '13:30', endTime: '14:15', type: 'class', label: '1ª' },
      { id: S2, startTime: '14:15', endTime: '15:00', type: 'class', label: '2ª' },
      { id: S3, startTime: '15:15', endTime: '16:00', type: 'class', label: '3ª' }] }] }],
  scheduleVersions: [],
  calendars: [{ id: 'cal', schoolId: 'C', year: 2026, division: 'trimestres', start: '2026-02-10', end: '2026-12-15',
    terms: [], midYearBreak: { start: '', end: '' }, extraRecesses: [] }],
  events: [], logs: []
});

describe('nova versão do horário: o que muda a partir da data', () => {
  it('aulas seguidas que mudam de horário: segue a ordem, sem colisão, avaliação leva o registro junto', () => {
    // Antes: 183 na segunda, 1ª e 2ª aula. Nova grade (19/10): 2ª e 3ª aula
    const doc = base();
    doc.logs = [
      log('antes', '2026-10-12', S1, 'Antes da mudança'),
      log('L1', '2026-10-26', S1, 'Avaliação: P3'),
      log('L2', '2026-10-26', S2, 'Planejamento da 2ª aula')
    ];
    doc.events = [{ id: 'P3', type: 'test', date: D('2026-10-26'), schoolId: 'C', classId: 'c183', slotId: S1, title: 'P3', description: '', blocksClasses: false }];
    const p = planScheduleChange(doc, [e('a', 1, S1), e('b', 1, S2)], [e('a', 1, S2), e('b', 1, S3)], '2026-10-19');

    expect(p.orphans.map(l => l.id)).toEqual(['L1', 'L2']); // "antes" nunca entra
    expect(p.orphanEvents.map(x => x.id)).toEqual(['P3']);
    expect(p.suggestions.L1).toMatchObject({ type: 'MOVE', targetDate: '2026-10-26', targetSlotId: S2, targetTime: { startTime: '14:15' } });
    expect(p.suggestions.P3).toMatchObject({ type: 'MOVE', targetDate: '2026-10-26', targetSlotId: S2 });
    expect(p.suggestions.L2).toMatchObject({ type: 'MOVE', targetDate: '2026-10-26', targetSlotId: S3 });
    expect(p.notes).toEqual({});
  });

  it('mudança de dia: vai para o dia novo da mesma semana', () => {
    // Antes: segunda e quarta (1ª aula). Nova: terça (1ª) e quinta (2ª)
    const doc = base();
    doc.logs = [log('seg', '2026-10-19', S1), log('qua', '2026-10-21', S1)];
    const p = planScheduleChange(doc, [e('a', 1, S1), e('b', 3, S1)], [e('a', 2, S1), e('b', 4, S2)], '2026-10-19');
    expect(p.suggestions.seg).toMatchObject({ targetDate: '2026-10-20', targetSlotId: S1 });
    expect(p.suggestions.qua).toMatchObject({ targetDate: '2026-10-22', targetSlotId: S2 });
  });

  it('sem sugestão (com aviso) quando cairia em feriado, antes da mudança ou faltam aulas', () => {
    const doc = base();
    doc.logs = [
      log('feriado', '2026-11-03', S1),   // terça → segunda 02/11 (Finados)
      log('antes', '2026-10-23', S1),     // sexta → segunda 19/10, antes da mudança (21/10)
    ];
    const p1 = planScheduleChange(doc, [e('a', 2, S1)], [e('a', 1, S1)], '2026-10-21');
    expect(p1.notes.feriado).toMatch(/02\/11\/2026, feriado \(Finados\)/);
    expect(p1.suggestions.feriado.type).toBe('EXTRA');

    const p2 = planScheduleChange(doc, [e('a', 5, S1)], [e('a', 1, S1)], '2026-10-21');
    expect(p2.notes.antes).toMatch(/antes da data da mudança/);

    const doc3 = base();
    doc3.logs = [log('x1', '2026-10-26', S1), log('x2', '2026-10-26', S2)];
    const p3 = planScheduleChange(doc3, [e('a', 1, S1), e('b', 1, S2)], [e('a', 1, S3)], '2026-10-19');
    expect(p3.suggestions.x1).toMatchObject({ type: 'MOVE', targetSlotId: S3 });
    expect(p3.notes.x2).toMatch(/menos aulas/);
  });

  it('não mexe no que é da versão seguinte, em outras turmas nem na 2ª chamada sem aula', () => {
    const doc = base();
    doc.logs = [log('dentro', '2026-10-26', S1), log('depois', '2026-11-16', S1), log('outra', '2026-10-26', S2, 'x', { classId: 'c163' })];
    doc.events = [{ id: 'sc', kind: 'second_call', type: 'test', date: D('2026-10-28'), schoolId: 'C', classId: 'c183', title: '2ª chamada', description: '', blocksClasses: false }];
    const p = planScheduleChange(doc, [e('a', 1, S1), e('o', 1, S2, '163')], [e('a', 1, S3), e('o', 1, S2, '163')], '2026-10-19', '2026-11-09');
    expect(p.orphans.map(l => l.id)).toEqual(['dentro']);
    expect(p.orphanEvents).toEqual([]);
  });

  it('nunca coloca dois registros no mesmo horário', () => {
    // Antes: 1ª e 3ª aula; nova: 2ª e 3ª. Pela ordem: 1ª → 2ª e 3ª → 3ª (o registro da 3ª fica)
    const doc = base();
    doc.logs = [log('move', '2026-10-26', S1), log('fica', '2026-10-26', S3)];
    const ok = planScheduleChange(doc, [e('a', 1, S1), e('b', 1, S3)], [e('a', 1, S3), e('b', 1, S2)], '2026-10-19');
    expect(ok.suggestions.move).toMatchObject({ targetSlotId: S2 });
    expect(ok.orphans.map(l => l.id)).toEqual(['move']);
    // Registro avulso (não estava na grade antiga) ocupando o destino → sem sugestão
    doc.logs = [log('move', '2026-10-26', S1), log('avulso', '2026-10-26', S2)];
    const p = planScheduleChange(doc, [e('a', 1, S1)], [e('a', 1, S2)], '2026-10-19');
    expect(p.notes.move).toMatch(/Já há outro registro/);
  });

  it('próxima versão: onde a análise de uma versão para', () => {
    const doc = base();
    doc.scheduleVersions = [
      { id: 'v1', activeFrom: '2026-02-01', schedules: [] }, { id: 'v2', activeFrom: '2026-08-03', schedules: [] },
      { id: 'v3', activeFrom: '2026-10-19', schedules: [] }];
    expect(nextVersionStart(doc, '2026-08-03')).toBe('2026-10-19');
    expect(nextVersionStart(doc, '2026-10-19')).toBeUndefined();
  });
});

describe('nova versão do horário: gravar as decisões', () => {
  const cenario = () => {
    // Nova grade a partir de 19/10: 183 sai da 1ª e 2ª aula de segunda e vai para 2ª e 3ª
    const doc = base();
    doc.logs = [
      log('antes', '2026-10-12', S1, 'Antes da mudança'),
      log('aval', '2026-10-26', S1, 'Avaliação: P3'),
      log('plan', '2026-10-26', S2, 'Planejamento')
    ];
    doc.events = [
      { id: 'P3', type: 'test', date: D('2026-10-26'), schoolId: 'C', classId: 'c183', slotId: S1, title: 'P3', description: '', blocksClasses: false },
      { id: 'REC', type: 'test', kind: 'recovery', parentId: 'P3', date: D('2026-11-09'), schoolId: 'C', classId: 'c183', slotId: S2, title: 'REC P3', description: '', blocksClasses: false }
    ];
    doc.grades = [{ id: 'g', studentId: 'a', assessmentId: 'P3', value: 7 }];
    const antiga = [e('a', 1, S1), e('b', 1, S2)];
    const nova = [e('a', 1, S2), e('b', 1, S3)];
    doc.scheduleVersions = [{ id: 'v1', activeFrom: '2026-02-01', createdAt: '', schedules: antiga }, { id: 'v2', activeFrom: '2026-10-19', createdAt: '', schedules: nova }];
    return { doc, plan: planScheduleChange(doc, antiga, nova, '2026-10-19') };
  };

  it('aceitando as sugestões: tudo vai para a aula certa, nada antes da mudança é tocado e o Diário mostra certo', () => {
    const { doc, plan } = cenario();
    const r = applyScheduleDecisions(doc, plan, Object.values(plan.suggestions));
    const byId = (id: string) => r.logs.find(l => l.id === id)!;
    expect(byId('antes')).toEqual(doc.logs[0]);
    expect(byId('aval')).toMatchObject({ date: D('2026-10-26'), slotId: S2, startTime: '14:15' });
    expect(byId('plan')).toMatchObject({ date: D('2026-10-26'), slotId: S3 });
    expect(r.events.find(x => x.id === 'P3')).toMatchObject({ date: D('2026-10-26'), slotId: S2 });
    expect(r.events.find(x => x.id === 'REC')).toMatchObject({ date: D('2026-11-09'), slotId: S3 }); // a REC também segue a ordem

    // No Diário (com a grade nova a partir de 19/10), cada registro aparece na sua aula
    const items = getLessonDisplayItems({ ...doc, logs: r.logs, events: r.events } as any, { start: '2026-10-26', end: '2026-10-26', schoolId: 'C', classId: 'all' });
    expect(items.map(i => [i.slot.id, i.log?.subject])).toEqual([[S2, 'Avaliação: P3'], [S3, 'Planejamento']]);
  });

  it('"manter como extra" vira aula extra que aparece no Diário; a prova no contraturno tira o seu registro automático', () => {
    const { doc, plan } = cenario();
    const r = applyScheduleDecisions(doc, plan, [
      { logId: 'plan', type: 'EXTRA' },
      { logId: 'P3', type: 'EXTRA' } // a prova fica na data, no contraturno; o "Avaliação: P3" sai do diário
    ], () => 'novo-horario');
    expect(r.logs.find(l => l.id === 'plan')).toMatchObject({ type: 'extra', date: D('2026-10-26'), slotId: 'novo-horario', startTime: '14:15', endTime: '15:00' });
    expect(r.logs.find(l => l.id === 'aval')).toBeUndefined();
    expect(r.events.find(x => x.id === 'P3')).not.toHaveProperty('slotId');
    const items = getLessonDisplayItems({ ...doc, logs: r.logs, events: r.events } as any, { start: '2026-10-26', end: '2026-10-26', schoolId: 'C', classId: 'all' });
    // Não some do Diário (no mesmo horário de uma aula da turma, aparece nessa aula)
    expect(items.some(i => i.log?.subject === 'Planejamento')).toBe(true);
  });

  it('prova levada a uma atividade fixa: fica no horário e o registro automático sai do diário', () => {
    const { doc, plan } = cenario();
    const r = applyScheduleDecisions(doc, plan, [
      { logId: 'P3', type: 'MOVE', targetDate: '2026-10-26', targetSlotId: S1, targetTime: { startTime: '13:30', endTime: '14:15' }, daySlot: true, toActivity: true }
    ]);
    expect(r.events.find(x => x.id === 'P3')).toMatchObject({ slotId: S1 });
    expect(r.logs.find(l => l.id === 'aval')).toBeUndefined();
  });

  it('"outra aula neste dia": a prova vai para o horário escolhido e o registro vira aula extra nele', () => {
    const { doc, plan } = cenario();
    const r = applyScheduleDecisions(doc, plan, [
      { logId: 'P3', type: 'MOVE', targetDate: '2026-10-26', targetSlotId: S1, targetTime: { startTime: '13:30', endTime: '14:15' }, daySlot: true }
    ]);
    expect(r.events.find(x => x.id === 'P3')).toMatchObject({ date: D('2026-10-26'), slotId: S1 });
    expect(r.logs.find(l => l.id === 'aval')).toMatchObject({ type: 'extra', date: D('2026-10-26'), slotId: S1, startTime: '13:30' });
    const items = getLessonDisplayItems({ ...doc, logs: r.logs, events: r.events } as any, { start: '2026-10-26', end: '2026-10-26', schoolId: 'C', classId: 'all' });
    expect(items.some(i => i.isExtra && i.log?.subject === 'Avaliação: P3' && i.slot.startTime === '13:30')).toBe(true);
  });

  it('"excluir a avaliação" apaga de verdade: a prova, a REC ligada, as notas e o registro "Avaliação:"', () => {
    const { doc, plan } = cenario();
    const r = applyScheduleDecisions(doc, plan, [{ logId: 'P3', type: 'DELETE' }]);
    expect(r.events.map(x => x.id)).toEqual([]);
    expect(r.grades).toEqual([]);
    expect(r.logs.map(l => l.id)).toEqual(['antes', 'plan']);
  });
});
