import { describe, it, expect } from 'vitest';
import { planAssessmentLogs, removeAssessmentLogs } from '../utils/assessmentLogs';
import { assessmentPlaceLabel, assessmentPlaces } from '../utils/assessmentPlace';

// Dados inventados (nenhum nome real)
const SLOTS = [
  { id: 's1', startTime: '13:30', endTime: '14:15', type: 'class', label: '1' },
  { id: 's2', startTime: '14:15', endTime: '15:00', type: 'class', label: '2' },
  { id: 's3', startTime: '15:15', endTime: '16:00', type: 'class', label: '3' }
];
const D = (d: string) => `${d}T00:00:00.000Z`;
const log = (id: string, date: string, slotId: string, subject: string, homework = '') =>
  ({ id, date: D(date), schoolId: 'C', classId: '183', slotId, subject, homework, notes: '' });

const base = (): any => ({
  profile: {}, settings: { isPrivateTeacher: false }, students: [], classRecords: [], grades: [], schedules: [],
  reminders: [], customAssessments: [], gradingConfigs: [],
  schools: [{ id: 'C', name: 'Cônsul', color: '#f00', classes: [{ id: 'c183', name: '183' }],
    shifts: [{ id: 'cv', name: 'Vespertino', slots: SLOTS }] }],
  // 183: segunda (3ª aula) e quarta (1ª e 2ª aulas seguidas)
  scheduleVersions: [{ id: 'v', activeFrom: '2026-02-01', createdAt: '', schedules: [
    { id: 'e1', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's3', classId: '183' },
    { id: 'e2', dayOfWeek: 3, schoolId: 'C', shiftId: 'cv', slotId: 's1', classId: '183' },
    { id: 'e3', dayOfWeek: 3, schoolId: 'C', shiftId: 'cv', slotId: 's2', classId: '183' }
  ] }],
  calendars: [{ id: 'cal', schoolId: 'C', year: 2026, division: 'trimestres', start: '2026-02-10', end: '2026-10-30',
    terms: [{ name: '3º Trimestre', start: '2026-09-08', end: '2026-10-30' }],
    midYearBreak: { start: '', end: '' }, extraRecesses: [{ id: 'r', name: 'Recesso', date: '2026-10-21' }] }],
  events: [],
  logs: [
    log('auto', '2026-10-14', 's1', 'Avaliação: P3'),
    log('l5', '2026-10-19', 's3', 'Cap. 5'),
    log('l6', '2026-10-26', 's3', 'Cap. 6'),
    log('l7', '2026-10-28', 's1', 'Cap. 7')
  ]
});

const P3 = { id: 'p3', type: 'test', schoolId: 'C', classId: 'c183', slotId: 's1', date: D('2026-10-14'), title: 'P3', description: '', blocksClasses: false } as any;
const moved = { ...P3, slotId: 's3', date: D('2026-10-19') };
let n = 0;
const newId = () => `novo${++n}`;
const at = (logs: any[], id: string) => { const l = logs.find(x => x.id === id); return l && `${l.date.slice(0, 10)} ${l.slotId}`; };

describe('registro da avaliação no Diário ao remarcar', () => {
  it('aula nova com conteúdo planejado: pede escolha e não mexe em nada', () => {
    const r = planAssessmentLogs(base(), P3, moved, undefined, newId);
    expect(r.conflict?.id).toBe('l5');
    expect(r.canSwap).toBe(true);
    expect(r.logs).toEqual(base().logs);
  });

  it('trocar: o planejado vai para a aula que a prova liberou', () => {
    const { logs } = planAssessmentLogs(base(), P3, moved, 'swap', newId);
    expect(at(logs, 'l5')).toBe('2026-10-14 s1');
    expect(at(logs, 'auto')).toBe('2026-10-19 s3');
    expect(logs).toHaveLength(4);
  });

  it('empurrar: cada conteúdo anda uma aula (pula recesso) até achar aula vazia', () => {
    const { logs } = planAssessmentLogs(base(), P3, moved, 'push', newId);
    expect(at(logs, 'auto')).toBe('2026-10-19 s3');
    expect(at(logs, 'l5')).toBe('2026-10-26 s3');
    expect(at(logs, 'l6')).toBe('2026-10-28 s1');
    expect(at(logs, 'l7')).toBe('2026-10-28 s2');
    expect(logs).toHaveLength(4);
  });

  it('manter os dois: a aula fica com o conteúdo e a linha da avaliação', () => {
    const { logs } = planAssessmentLogs(base(), P3, moved, 'merge', newId);
    expect(logs.find(l => l.id === 'l5')!.subject).toBe('Cap. 5\nAvaliação: P3');
    expect(logs.find(l => l.id === 'auto')).toBeUndefined();
  });

  it('aula nova vazia: o registro automático vai junto', () => {
    const { logs, conflict } = planAssessmentLogs(base(), P3, { ...P3, slotId: 's2', title: 'P3 nova' }, undefined, newId);
    expect(conflict).toBeUndefined();
    expect(at(logs, 'auto')).toBe('2026-10-14 s2');
    expect(logs.find(l => l.id === 'auto')!.subject).toBe('Avaliação: P3 nova');
  });

  it('registro editado pelo Cadu na aula antiga fica onde está', () => {
    const doc = base();
    doc.logs[0] = log('auto', '2026-10-14', 's1', 'Avaliação: P3', 'Estudar cap. 4');
    const { logs } = planAssessmentLogs(doc, P3, { ...P3, slotId: 's2' }, undefined, newId);
    expect(at(logs, 'auto')).toBe('2026-10-14 s1');
    expect(logs.find(l => l.slotId === 's2' && l.date.startsWith('2026-10-14'))!.subject).toBe('Avaliação: P3');
  });

  it('avaliação nova em aula com planejamento: também pede escolha (sem troca)', () => {
    const doc = base();
    const r = planAssessmentLogs(doc, undefined, { ...moved, id: 'p4', title: 'P4' }, undefined, newId);
    expect(r.conflict?.id).toBe('l5');
    expect(r.canSwap).toBe(false);
  });

  it('apagar a avaliação tira só o registro automático', () => {
    const doc = base();
    doc.logs.push(log('cadu', '2026-10-19', 's3', 'Avaliação: P5', 'Revisar'));
    const left = removeAssessmentLogs(doc.logs, [P3, { ...P3, id: 'p5', title: 'P5', slotId: 's3', date: D('2026-10-19') }]);
    expect(left.map((l: any) => l.id)).toEqual(['l5', 'l6', 'l7', 'cadu']);
  });
});

describe('contraturno e atividade fixa', () => {
  // Quarta, 3ª aula: atividade fixa "Aplicação de provas" (sem turma)
  const comAtividade = () => {
    const doc = base();
    doc.scheduleVersions[0].schedules.push({ id: 'w', dayOfWeek: 3, schoolId: 'C', shiftId: 'cv', slotId: 's3', classId: 'window', activityLabel: 'Aplicação de provas' });
    return doc;
  };

  it('opções do horário: aulas da turma e atividades fixas do dia', () => {
    const doc = comAtividade();
    const { lessons, activities } = assessmentPlaces(doc, doc.schools[0], 'c183', '2026-10-28');
    expect(lessons.map(l => [l.slot.id, l.number])).toEqual([['s1', 1], ['s2', 2]]);
    expect(activities.map(a => [a.slot.id, a.activity])).toEqual([['s3', 'Aplicação de provas']]);
    // Terça: a turma não tem aula (só contraturno)
    expect(assessmentPlaces(doc, doc.schools[0], 'c183', '2026-10-27').lessons).toEqual([]);
  });

  it('prova na atividade fixa ou no contraturno não cria registro no diário', () => {
    const doc = comAtividade();
    const naAtividade = { ...P3, id: 'p9', title: 'P9', date: D('2026-10-28'), slotId: 's3' };
    expect(planAssessmentLogs(doc, undefined, naAtividade, undefined, newId).logs).toEqual(doc.logs);
    const contraturno = { ...P3, id: 'p8', title: 'P8', date: D('2026-10-27'), slotId: undefined };
    expect(planAssessmentLogs(doc, undefined, contraturno, undefined, newId).logs).toEqual(doc.logs);
    expect(assessmentPlaceLabel(doc, naAtividade)).toBe('3ª aula (15:15) · Aplicação de provas');
    expect(assessmentPlaceLabel(doc, contraturno)).toBe('Contraturno');
  });

  it('remarcar para a atividade fixa tira o registro automático da aula antiga', () => {
    const doc = comAtividade();
    const { logs } = planAssessmentLogs(doc, P3, { ...P3, date: D('2026-10-28'), slotId: 's3' }, undefined, newId);
    expect(logs.find((l: any) => l.id === 'auto')).toBeUndefined();
    expect(logs).toHaveLength(3);
  });
});
