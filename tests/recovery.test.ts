import { describe, it, expect } from 'vitest';
import {
  buildRecovery, buildSecondCall, checkAssessmentDate, parentCandidates, suggestRecovery, termRecoveryContent
} from '../utils/recovery';

// Dados inventados (nenhum nome real)
const SLOTS = [
  { id: 's1', startTime: '13:30', endTime: '14:15', type: 'class', label: '1ª Aula' },
  { id: 's2', startTime: '14:15', endTime: '15:00', type: 'class', label: '2ª Aula' },
  { id: 's3', startTime: '15:15', endTime: '16:00', type: 'class', label: '3ª Aula' }
];
const D = (d: string) => `${d}T00:00:00.000Z`;

const base = (): any => ({
  profile: {}, settings: {}, students: [], classRecords: [], grades: [], schedules: [], reminders: [],
  customAssessments: [], gradingConfigs: [], logs: [],
  schools: [{ id: 'C', name: 'Cônsul', color: '#f00', recoveryPolicy: 'parallel', classes: [{ id: 'c183', name: '183' }, { id: 'c163', name: '163' }],
    shifts: [{ id: 'cv', name: 'Vespertino', slots: SLOTS }] }],
  // 183: segunda (3ª aula) e quarta (1ª e 2ª aulas)
  scheduleVersions: [{ id: 'v', activeFrom: '2026-02-01', createdAt: '', schedules: [
    { id: 'e1', dayOfWeek: 1, schoolId: 'C', shiftId: 'cv', slotId: 's3', classId: '183' },
    { id: 'e2', dayOfWeek: 3, schoolId: 'C', shiftId: 'cv', slotId: 's1', classId: '183' },
    { id: 'e3', dayOfWeek: 3, schoolId: 'C', shiftId: 'cv', slotId: 's2', classId: '183' }
  ] }],
  calendars: [{ id: 'cal', schoolId: 'C', year: 2026, division: 'trimestres', start: '2026-02-10', end: '2026-12-15',
    terms: [{ name: '3º Trimestre', start: '2026-09-08', end: '2026-12-15' }],
    midYearBreak: { start: '', end: '' }, extraRecesses: [{ id: 'r', name: 'Recesso', date: '2026-10-21' }] }],
  events: [
    { id: 'p1', type: 'test', schoolId: 'C', classId: 'c183', slotId: 's3', date: D('2026-09-14'), title: 'P1', description: 'Cap. 1 a 3', blocksClasses: false },
    { id: 'p2', type: 'test', schoolId: 'C', classId: 'c183', slotId: 's3', date: D('2026-10-05'), title: 'P2', description: 'Cap. 4', blocksClasses: false },
    { id: 'rp1', type: 'test', kind: 'recovery', parentId: 'p1', schoolId: 'C', classId: 'c183', slotId: 's1', date: D('2026-09-30'), title: 'REC P1', description: 'Cap. 1 a 3', blocksClasses: false },
    { id: 'o1', type: 'test', schoolId: 'C', classId: 'c163', slotId: 's1', date: D('2026-10-06'), title: 'P2 da 163', description: 'Outro', blocksClasses: false },
    { id: 'm1', type: 'meeting', schoolId: 'C', date: D('2026-10-22'), title: 'Conselho de classe', description: '', blocksClasses: false }
  ]
});
const C = (doc: any) => doc.schools[0];

describe('recuperação paralela (sugestão de data)', () => {
  it('15 dias depois; avisa se a turma não tem aula, recesso e evento na semana, e indica a próxima aula', () => {
    const doc = base();
    // P2 em seg 05/10 → 20/10 (terça): a 183 não tem aula; 21/10 é recesso; próxima aula: seg 26/10
    const s = suggestRecovery(doc, C(doc), 'c183', '2026-10-05');
    expect(s.date).toBe('2026-10-20');
    expect(s.warnings).toEqual([
      'A turma não tem aula na terça (20/10/2026).',
      'Na mesma semana: "Conselho de classe" em 22/10/2026.'
    ]);
    expect(s.nextAvailable).toBe('2026-10-26');
    expect(s.nextAvailableText).toBe('Próxima aula da turma: segunda 26/10/2026.');
  });

  it('respeita o prazo da escola e pula feriado', () => {
    const doc = base();
    doc.schools[0].recoveryDelayDays = 14;
    // P2 em seg 19/10 → seg 02/11 (Finados) → próxima aula: qua 04/11
    const s = suggestRecovery(doc, C(doc), 'c183', '2026-10-19');
    expect(s.date).toBe('2026-11-02');
    expect(s.blocked).toBe(true);
    expect(s.warnings[0]).toMatch(/feriado \(Finados\)/);
    expect(s.nextAvailable).toBe('2026-11-04');
  });

  it('dia bom: aulas do dia e nenhum aviso', () => {
    const doc = base();
    const c = checkAssessmentDate(doc, C(doc), 'c183', '2026-10-28');
    expect(c.warnings).toEqual([]);
    expect(c.lessons.map(l => l.id)).toEqual(['s1', 's2']);
  });
});

describe('recuperação trimestral e 2ª chamada', () => {
  it('conteúdo da REC trimestral: provas regulares da turma no trimestre (sem RECs nem outras turmas)', () => {
    expect(termRecoveryContent(base(), 'C', '183', '2026-11-30')).toBe('P1: Cap. 1 a 3 · P2: Cap. 4');
  });

  it('2ª chamada e REC copiam a prova original e ficam ligadas a ela', () => {
    const doc = base();
    const p2 = doc.events[1];
    expect(buildSecondCall(p2, '2026-10-15', undefined, 'sc')).toEqual({
      id: 'sc', kind: 'second_call', parentId: 'p2', title: '2ª chamada — P2', date: '2026-10-15T00:00:00.000Z',
      schoolId: 'C', classId: 'c183', type: 'test', description: 'Cap. 4', blocksClasses: false
    });
    expect(buildRecovery(p2, '2026-10-26', 's3', 'rec')).toMatchObject({ kind: 'recovery', parentId: 'p2', title: 'REC P2', slotId: 's3' });
  });

  it('só avaliações regulares podem ter 2ª chamada', () => {
    expect(parentCandidates(base(), 'C', 'c183').map(e => e.id)).toEqual(['p2', 'p1']);
  });
});
