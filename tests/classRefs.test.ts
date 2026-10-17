import { describe, it, expect } from 'vitest';
import { getClassName, isSameClassRef, canonicalClassId } from '../utils/classRefs';
import { findBrokenClassRefs, reassignClassRef } from '../components/ClassRefRepair';
import { formatDateBR, buildICS, getSafeDate, getTermInfo } from '../utils';

const U1 = '3f2a9c1e-1111-4222-8333-944444444444';
const U2 = '7b1d0e2f-5555-4666-8777-988888888888';
const ORPHAN = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const data: any = {
  schools: [
    { id: 'S1', name: 'Cônsul', classes: [{ id: U1, name: '8º ano 183' }, { id: U2, name: '8º ano 184', deleted: true }], shifts: [] }
  ],
  logs: [], events: [], classRecords: [], customAssessments: [], gradingConfigs: [], reminders: [],
  schedules: [], scheduleVersions: [], students: []
};

describe('resolução de turma por código ou nome', () => {
  it('código vira nome', () => expect(getClassName(data, 'S1', U1)).toBe('8º ano 183'));
  it('nome (grade horária) continua nome', () => expect(getClassName(data, 'S1', '8º ano 183')).toBe('8º ano 183'));
  it('turma excluída ainda mostra o nome no histórico', () => expect(getClassName(data, 'S1', U2)).toBe('8º ano 184'));
  it('código inexistente não aparece cru', () => expect(getClassName(data, 'S1', ORPHAN)).toBe('Turma não encontrada (aaaa)'));
  it('código e nome da mesma turma são a mesma turma', () => expect(isSameClassRef(data, 'S1', U1, '8º ano 183')).toBe(true));
  it('canônico é sempre o código', () => expect(canonicalClassId(data, 'S1', '8º ano 183')).toBe(U1));
});

describe('reparo de turmas não encontradas', () => {
  const withOrphans = {
    ...data,
    scheduleVersions: [{ id: 'v1', activeFrom: '2026-01-01', createdAt: '', schedules: [
      { id: 'e1', dayOfWeek: 2, schoolId: 'S1', shiftId: 'm', slotId: 'slot1', classId: '8º ano 183' }
    ] }],
    logs: [
      { id: 'L1', date: '2026-03-10T00:00:00.000Z', schoolId: 'S1', classId: ORPHAN, slotId: 'slot1', subject: 'a' },
      { id: 'L2', date: '2026-03-17T00:00:00.000Z', schoolId: 'S1', classId: ORPHAN, slotId: 'slot1', subject: 'b' },
      { id: 'L3', date: '2026-03-17T00:00:00.000Z', schoolId: 'S1', classId: U1, slotId: 'slot1', subject: 'ok' }
    ],
    events: [{ id: 'P1', date: '2026-03-20T00:00:00.000Z', schoolId: 'S1', classId: ORPHAN, type: 'test', title: 'Prova' }]
  };

  it('encontra o grupo, conta registros e sugere a turma pela grade (terça, 1º horário)', () => {
    const broken = findBrokenClassRefs(withOrphans);
    expect(broken).toHaveLength(1);
    expect(broken[0].counts).toMatchObject({ logs: 2, events: 1 });
    expect(broken[0].firstDate).toBe('2026-03-10');
    expect(broken[0].suggestedClassId).toBe(U1);
  });

  it('reatribui todos os registros para a turma escolhida', () => {
    const updates = reassignClassRef(withOrphans, 'S1', ORPHAN, U1);
    expect(updates.logs!.every((l: any) => l.classId === U1)).toBe(true);
    expect(updates.events![0].classId).toBe(U1);
    expect(findBrokenClassRefs({ ...withOrphans, ...updates })).toHaveLength(0);
  });

  it('junta a lista de alunos se a turma de destino já tiver uma', () => {
    const d = {
      ...data,
      classRecords: [
        { id: 'r1', schoolId: 'S1', classId: U1, students: [{ id: 'a', name: 'Ana' }] },
        { id: 'r2', schoolId: 'S1', classId: ORPHAN, students: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bia' }] }
      ]
    };
    const updates = reassignClassRef(d, 'S1', ORPHAN, U1);
    expect(updates.classRecords).toHaveLength(1);
    expect(updates.classRecords![0].students.map((s: any) => s.name)).toEqual(['Ana', 'Bia']);
  });
});

describe('datas nas exportações (fuso de Brasília)', () => {
  it('data salva à meia-noite UTC sai no dia certo', () => {
    // Antes: new Date('2026-10-20T00:00:00.000Z').toLocaleDateString('pt-BR') → 19/10/2026
    expect(formatDateBR('2026-10-20T00:00:00.000Z')).toBe('20/10/2026');
    expect(formatDateBR('2026-10-20')).toBe('20/10/2026');
  });

  it('agenda (.ics) exporta evento de dia inteiro no dia certo, com UID', () => {
    const ics = buildICS([{ uid: 'e1', title: 'Prova; 8º ano, AV2', start: '2026-10-20T00:00:00.000Z', end: '2026-10-20T00:00:00.000Z', description: 'linha 1\nlinha 2' }]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261020');
    expect(ics).toContain('DTEND;VALUE=DATE:20261021');
    expect(ics).toContain('UID:e1@leciona');
    expect(ics).toContain('SUMMARY:Prova\\; 8º ano\\, AV2');
    expect(ics).toContain('DESCRIPTION:linha 1\\nlinha 2');
  });
});

describe('datas na tela (fuso de Brasília)', () => {
  it('prova salva para terça 20/10 é lida como terça 20/10 (antes: segunda 19/10)', () => {
    const d = getSafeDate('2026-10-20T00:00:00.000Z');
    expect(d.getDate()).toBe(20);
    expect(d.getDay()).toBe(2);
  });

  it('evento no primeiro dia do trimestre pertence ao trimestre', () => {
    const cal: any = { terms: [{ name: '1º', start: '2026-02-02', end: '2026-05-08' }, { name: '2º', start: '2026-05-11', end: '2026-08-28' }] };
    expect(getTermInfo('2026-05-11T00:00:00.000Z', cal)?.index).toBe(1);
  });
});
