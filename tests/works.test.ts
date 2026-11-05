import { describe, it, expect } from 'vitest';
import {
  missingWorkAlerts, pendingDeliveriesForClass, planWorkSessionLogs, removeWorkSessionLogs, workCountsByClass,
  worksAtLesson, worksRequired
} from '../utils/works';
import { scheduleNoticeShort, scheduleNotices, scheduleNoticeText } from '../utils/scheduleNotice';

// Dados inventados (nenhum nome real)
const SLOTS = [
  { id: 's1', startTime: '13:30', endTime: '14:15', type: 'class', label: '1' },
  { id: 's2', startTime: '14:15', endTime: '15:00', type: 'class', label: '2' }
];

const base = (): any => ({
  profile: {}, settings: { isPrivateTeacher: false }, students: [], classRecords: [], grades: [], schedules: [],
  reminders: [], customAssessments: [], gradingConfigs: [], logs: [],
  schools: [{ id: 'C', name: 'Escola A', color: '#f00', worksPerTerm: 2,
    classes: [{ id: 'c183', name: '183' }, { id: 'c163', name: '163' }],
    shifts: [{ id: 'cv', name: 'Vespertino', slots: SLOTS }] }],
  // 183: segunda (1ª aula); 163: quarta (2ª aula)
  scheduleVersions: [{ id: 'v', activeFrom: '2026-02-01', createdAt: '', schedules: [
    { id: 'e1', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's1', classId: '183' },
    { id: 'e2', dayOfWeek: 3, schoolId: 'C', shiftId: 'cv', slotId: 's2', classId: '163' }
  ] }],
  calendars: [{ id: 'cal', schoolId: 'C', year: 2026, division: 'trimestres', start: '2026-02-10', end: '2026-12-18',
    terms: [{ name: '3º Trimestre', start: '2026-09-08', end: '2026-12-18' }],
    midYearBreak: { start: '', end: '' }, extraRecesses: [{ id: 'r', name: 'Recesso', date: '2026-11-16' }] }],
  events: []
});

const work = (extra: any = {}) => ({
  id: 'w1', type: 'work', schoolId: 'C', classId: 'c183', slotId: 's1', date: '2026-11-30T00:00:00.000Z',
  title: 'Revolução Francesa', description: '', blocksClasses: false, ...extra
});

describe('aviso de 1 semana para marcar a avaliação', () => {
  it('aparece 7 dias antes da última aula até o prazo e destaca o dia da aula-limite', () => {
    const doc = base();
    // Prova segunda 30/11 → prazo 23/11 (segunda, aula da 183) = aula-limite
    doc.events.push({ ...work(), id: 'p', type: 'test', title: 'P4' });
    expect(scheduleNotices(doc, '2026-11-15')).toEqual([]);
    const soon = scheduleNotices(doc, '2026-11-17');
    expect(soon).toHaveLength(1);
    expect(soon[0]).toMatchObject({ status: 'soon', limitDate: '2026-11-23', deadline: '2026-11-23' });
    expect(scheduleNoticeText(soon[0])).toBe('Prova P4 (183) em 30/11: marque até 23/11');
    expect(scheduleNoticeShort(soon[0])).toBe('183 · até 23/11 · P4');
    expect(scheduleNotices(doc, '2026-11-23')[0].status).toBe('last');
    expect(scheduleNotices(doc, '2026-11-24')[0].status).toBe('late');
  });

  it('se a aula do prazo cai num recesso, a aula-limite é a anterior e o aviso vem antes', () => {
    const doc = base();
    // Prova segunda 23/11 → prazo 16/11 = recesso; aula-limite = 09/11
    doc.events.push({ ...work(), id: 'p', type: 'test', title: 'P4', date: '2026-11-23T00:00:00.000Z' });
    const n = scheduleNotices(doc, '2026-11-02');
    expect(n[0]).toMatchObject({ status: 'soon', limitDate: '2026-11-09' });
    expect(scheduleNotices(doc, '2026-11-01')).toEqual([]);
  });

  it('some quando a avaliação fica Agendada ou Pronta; 2ª chamada não entra', () => {
    const doc = base();
    doc.events.push({ ...work(), id: 'a', type: 'test', scheduled: true });
    doc.events.push({ ...work(), id: 'b', type: 'test', prepared: true });
    doc.events.push({ ...work(), id: 'c', type: 'test', kind: 'second_call' });
    expect(scheduleNotices(doc, '2026-11-23')).toEqual([]);
  });

  it('cadastrada em cima da hora: fora do prazo na hora', () => {
    const doc = base();
    doc.events.push({ ...work(), id: 'p', type: 'test', date: '2026-11-05T00:00:00.000Z' });
    expect(scheduleNotices(doc, '2026-11-02')[0].status).toBe('late');
  });

  it('filtra pela turma do Diário (código ou nome)', () => {
    const doc = base();
    doc.events.push({ ...work(), id: 'p', type: 'test' });
    expect(scheduleNotices(doc, '2026-11-23', 'C', '183')).toHaveLength(1);
    expect(scheduleNotices(doc, '2026-11-23', 'C', '163')).toHaveLength(0);
  });
});

describe('trabalhos por período', () => {
  it('regra da escola com exceção por turma', () => {
    const doc = base();
    doc.schools[0].worksPerTermByClass = { c163: 0 };
    expect(worksRequired(doc, doc.schools[0], '183')).toBe(2);
    expect(worksRequired(doc, doc.schools[0], '163')).toBe(0);
  });

  it('avisa a partir de 6 semanas do fim do período as turmas com menos trabalhos', () => {
    const doc = base();
    doc.events.push(work());
    // Fim 18/12: 6 semanas antes = 06/11
    expect(missingWorkAlerts(doc, '2026-11-05')).toEqual([]);
    const alerts = missingWorkAlerts(doc, '2026-11-06');
    expect(alerts.map(a => [a.className, a.count, a.required])).toEqual([['163', 0, 2], ['183', 1, 2]]);
    doc.events.push(work({ id: 'w2' }));
    expect(missingWorkAlerts(doc, '2026-11-06').map(a => a.className)).toEqual(['163']);
    // REC não conta como trabalho
    doc.events.push(work({ id: 'w3', classId: 'c163', kind: 'recovery' }));
    expect(missingWorkAlerts(doc, '2026-11-06').map(a => a.className)).toEqual(['163']);
  });

  it('escola sem regra não avisa; prazo do aviso por escola', () => {
    const doc = base();
    doc.schools[0].worksPerTerm = 0;
    expect(missingWorkAlerts(doc, '2026-12-01')).toEqual([]);
    doc.schools[0].worksPerTerm = 1;
    doc.schools[0].workAlertWeeks = 3;
    expect(missingWorkAlerts(doc, '2026-11-26')).toEqual([]);
    expect(missingWorkAlerts(doc, '2026-11-27')).toHaveLength(2);
  });

  it('contagem por turma no período', () => {
    const doc = base();
    doc.events.push(work());
    expect(workCountsByClass(doc, '2026-11-06').map(r => `${r.className} ${r.count}/${r.required}`)).toEqual(['163 0/2', '183 1/2']);
  });
});

describe('trabalho em sala: aulas no diário', () => {
  const ids = () => { let n = 0; return () => `n${++n}`; };

  it('cria "Trabalho em sala: X" nas outras aulas, sem repetir a aula da entrega', () => {
    const doc = base();
    const ev: any = work({ workPlace: 'class' });
    const logs = planWorkSessionLogs(doc.logs, ev, [
      { date: '2026-11-23', slotId: 's1' }, { date: '2026-11-30', slotId: 's1' }, { date: '2026-11-23', slotId: 's1' }
    ], undefined, ids());
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ subject: 'Trabalho em sala: Revolução Francesa', workId: 'w1', slotId: 's1', classId: 'c183' });
    expect(logs[0].date.startsWith('2026-11-23')).toBe(true);
  });

  it('aula com conteúdo do Cadu: o conteúdo fica e ganha a ligação; ao tirar a aula, só perde a ligação', () => {
    const doc = base();
    doc.logs.push({ id: 'L', date: '2026-11-23T00:00:00.000Z', schoolId: 'C', classId: 'c183', slotId: 's1', subject: 'Iluminismo', homework: '', notes: '' });
    const ev: any = work({ workPlace: 'class' });
    let logs = planWorkSessionLogs(doc.logs, ev, [{ date: '2026-11-23', slotId: 's1' }], undefined, ids());
    expect(logs).toEqual([expect.objectContaining({ id: 'L', subject: 'Iluminismo', workId: 'w1' })]);
    logs = planWorkSessionLogs(logs, ev, [], ev, ids());
    expect(logs).toHaveLength(1);
    expect(logs[0].workId).toBeUndefined();
    expect(logs[0].subject).toBe('Iluminismo');
  });

  it('renomear atualiza o registro automático; virar "em casa" ou apagar remove', () => {
    const doc = base();
    const ev: any = work({ workPlace: 'class' });
    let logs = planWorkSessionLogs(doc.logs, ev, [{ date: '2026-11-23', slotId: 's1' }], undefined, ids());
    const renamed = { ...ev, title: 'Era Napoleônica' };
    logs = planWorkSessionLogs(logs, renamed, [{ date: '2026-11-23', slotId: 's1' }], ev, ids());
    expect(logs[0].subject).toBe('Trabalho em sala: Era Napoleônica');
    expect(worksAtLesson({ ...doc, logs, events: [renamed] }, 'C', '183', '2026-11-23', 's1').map(e => e.id)).toEqual(['w1']);
    expect(planWorkSessionLogs(logs, { ...renamed, workPlace: 'home' }, [{ date: '2026-11-23', slotId: 's1' }], renamed, ids())).toEqual([]);
    expect(removeWorkSessionLogs(logs, [renamed])).toEqual([]);
  });
});

describe('entregas pendentes', () => {
  it('aparecem nas aulas seguintes da turma até a entrega', () => {
    const doc = base();
    doc.events.push(work({ missingDeliveries: [
      { id: 'm1', name: 'Aluno 1', registeredAt: '2026-11-30' },
      { id: 'm2', name: 'Grupo 2', groupId: 'g2', registeredAt: '2026-11-30', deliveredAt: '2026-12-07' }
    ] }));
    expect(pendingDeliveriesForClass(doc, 'C', '183', '2026-11-30')).toEqual([]);
    const next = pendingDeliveriesForClass(doc, 'C', '183', '2026-12-07');
    expect(next).toHaveLength(1);
    expect(next[0].items.map(i => i.name)).toEqual(['Aluno 1']);
    expect(pendingDeliveriesForClass(doc, 'C', '163', '2026-12-07')).toEqual([]);
  });
});
