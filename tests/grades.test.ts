import { describe, it, expect } from 'vitest';
import { buildGradeColumns, calculateStudentResult, columnNumbers, frozenColumnOrder, latestGrade, setGrade } from '../utils/grades';

// Dados inventados
const PROVA = { id: 'prova', weight: 2, maxGrade: 7, date: '2026-10-10' };
const TRAB = { id: 'trab', weight: 1, maxGrade: 3, date: '2026-10-20' };
const g = (id: string, assessmentId: string, value: number, _m?: number) => ({ id, studentId: 'a1', assessmentId, value, ...(_m ? { _m } : {}) });
const notas = [g('g1', 'prova', 7), g('g2', 'trab', 1.5)]; // prova cheia, metade do trabalho

describe('notas: média com nota máxima', () => {
  it('aritmética conta cada nota proporcionalmente à nota máxima', () => {
    // 7/7 = 10 e 1,5/3 = 5 → média 7,5 (antes dava (7 + 1,5) / 2 = 4,3)
    expect(calculateStudentResult([PROVA, TRAB], notas, 'a1', { formula: 'arithmetic' })).toBe('7.5');
  });

  it('ponderada usa os pesos sobre as notas proporcionais', () => {
    // (10×2 + 5×1) / 3 = 8,3
    expect(calculateStudentResult([PROVA, TRAB], notas, 'a1', { formula: 'weighted' })).toBe('8.3');
  });

  it('soma das notas como lançadas', () => {
    expect(calculateStudentResult([PROVA, TRAB], notas, 'a1', { formula: 'sum' })).toBe('8.5');
  });

  it('com tudo valendo 10, a média é a de sempre', () => {
    const cols = [{ ...PROVA, maxGrade: 10 }, { ...TRAB, maxGrade: 10 }];
    expect(calculateStudentResult(cols, [g('g1', 'prova', 8), g('g2', 'trab', 6)], 'a1', { formula: 'arithmetic' })).toBe('7.0');
  });

  it('sem nota lançada mostra "-"; avaliação sem nota fica de fora', () => {
    expect(calculateStudentResult([PROVA, TRAB], [], 'a1', { formula: 'arithmetic' })).toBe('-');
    expect(calculateStudentResult([PROVA, TRAB], [g('g1', 'prova', 3.5)], 'a1', { formula: 'arithmetic' })).toBe('5.0');
  });
});

describe('notas: fórmula personalizada com números fixos', () => {
  it('coluna nova com data anterior não desloca a fórmula', () => {
    const order = frozenColumnOrder([PROVA, TRAB]); // N1 = prova, N2 = trabalho
    const extra = { id: 'extra', weight: 1, maxGrade: 10, date: '2026-09-01' }; // data ANTERIOR
    const n = columnNumbers([extra, PROVA, TRAB], order);
    expect([n.get('prova'), n.get('trab'), n.get('extra')]).toEqual([1, 2, 3]);
    const r = calculateStudentResult([extra, PROVA, TRAB], [...notas, g('g3', 'extra', 10)], 'a1',
      { formula: 'custom', customFormula: 'N1 + N2', columnOrder: order });
    expect(r).toBe('8.5');
  });

  it('coluna apagada não faz as outras mudarem de número', () => {
    const n = columnNumbers([TRAB], ['prova', 'trab']);
    expect(n.get('trab')).toBe(2);
  });

  it('sem numeração guardada, numera por data (como antes)', () => {
    const n = columnNumbers([TRAB, PROVA]);
    expect([n.get('prova'), n.get('trab')]).toEqual([1, 2]);
  });

  it('N10 não é confundido com N1; fórmula inválida mostra "Erro"', () => {
    const cols = Array.from({ length: 10 }, (_, i) => ({ id: `c${i + 1}`, weight: 1, maxGrade: 10, date: `2026-10-${String(i + 1).padStart(2, '0')}` }));
    const gs = cols.map((c, i) => g(`x${i}`, c.id, i + 1));
    expect(calculateStudentResult(cols, gs, 'a1', { formula: 'custom', customFormula: 'N10 - N1' })).toBe('9.0');
    expect(calculateStudentResult(cols, gs, 'a1', { formula: 'custom', customFormula: 'N1 / 0' })).toBe('Erro');
  });
});

describe('notas: mesmo código ao editar', () => {
  it('editar mantém o código da nota; apagar remove; repetidas somem', () => {
    const editado = setGrade(notas, 'a1', 'prova', 6, () => 'novo');
    expect(editado.find(x => x.assessmentId === 'prova')).toMatchObject({ id: 'g1', value: 6 });
    expect(setGrade(notas, 'a1', 'prova', null).some(x => x.assessmentId === 'prova')).toBe(false);
    expect(setGrade([], 'a1', 'prova', 5, () => 'novo')).toEqual([{ id: 'novo', studentId: 'a1', assessmentId: 'prova', value: 5 }]);

    const repetidas = [g('velha', 'prova', 4, 100), g('nova', 'prova', 5, 200)];
    expect(latestGrade(repetidas, 'a1', 'prova')!.id).toBe('nova');
    expect(setGrade(repetidas, 'a1', 'prova', 6)).toEqual([{ id: 'nova', studentId: 'a1', assessmentId: 'prova', value: 6, _m: 200 }]);
  });
});

describe('notas: recuperação e 2ª chamada', () => {
  const P1 = { id: 'p1', weight: 1, maxGrade: 10, date: '2026-10-05' };
  const REC = { id: 'rec', weight: 1, maxGrade: 10, date: '2026-10-20', recoveryOf: 'p1' };
  const T1 = { id: 't1', weight: 1, maxGrade: 10, date: '2026-10-10' };

  it('REC paralela: vale a nota mais alta e não conta como outra nota', () => {
    // P1 = 4, REC = 7 → conta 7; média com T1 = 9 → 8,0
    expect(calculateStudentResult([P1, REC, T1], [g('a', 'p1', 4), g('b', 'rec', 7), g('c', 't1', 9)], 'a1', { formula: 'arithmetic' })).toBe('8.0');
    // REC menor que a prova: fica a da prova
    expect(calculateStudentResult([P1, REC, T1], [g('a', 'p1', 6), g('b', 'rec', 3), g('c', 't1', 9)], 'a1', { formula: 'arithmetic' })).toBe('7.5');
    // Sem REC lançada: só a prova
    expect(calculateStudentResult([P1, REC], [g('a', 'p1', 6)], 'a1', { formula: 'arithmetic' })).toBe('6.0');
  });

  it('REC com nota máxima diferente compara proporcionalmente; na soma usa o valor da prova', () => {
    const p = { ...P1, maxGrade: 7 };
    const r = { ...REC, maxGrade: 10 };
    // prova 3,5 de 7 (50%), REC 8 de 10 (80%) → 5,6 de 7
    expect(calculateStudentResult([p, r], [g('a', 'p1', 3.5), g('b', 'rec', 8)], 'a1', { formula: 'sum' })).toBe('5.6');
    expect(calculateStudentResult([p, r], [g('a', 'p1', 3.5), g('b', 'rec', 8)], 'a1', { formula: 'arithmetic' })).toBe('8.0');
  });

  it('REC trimestral fica fora da média', () => {
    const TR = { id: 'tr', weight: 1, maxGrade: 10, date: '2026-11-30', outOfAverage: true };
    expect(calculateStudentResult([P1, TR], [g('a', 'p1', 4), g('b', 'tr', 10)], 'a1', { formula: 'arithmetic' })).toBe('4.0');
  });

  it('2ª chamada com nota antiga na própria coluna vale quando faltou na prova', () => {
    const SC = { id: 'sc', weight: 1, maxGrade: 10, date: '2026-10-12', secondCallOf: 'p1' };
    expect(calculateStudentResult([P1, SC, T1], [g('a', 'sc', 6), g('c', 't1', 8)], 'a1', { formula: 'arithmetic' })).toBe('7.0');
  });

  it('fórmula personalizada: todas as colunas entram como lançadas', () => {
    expect(calculateStudentResult([P1, REC], [g('a', 'p1', 4), g('b', 'rec', 7)], 'a1',
      { formula: 'custom', customFormula: 'N1 + N2', columnOrder: ['p1', 'rec'] })).toBe('11.0');
  });

  it('colunas da tela: 2ª chamada sem coluna, REC no período da prova, REC trimestral marcada', () => {
    const ev = (over: any) => ({ schoolId: 'S', classId: 'C', type: 'test', title: over.id, ...over });
    const events = [
      ev({ id: 'p1', date: '2026-09-25T00:00:00.000Z' }),
      ev({ id: 'rec', date: '2026-10-10T00:00:00.000Z', kind: 'recovery', parentId: 'p1' }), // cai no período seguinte
      ev({ id: 'sc', date: '2026-09-29T00:00:00.000Z', kind: 'second_call', parentId: 'p1' }),
      ev({ id: 'tr', date: '2026-09-28T00:00:00.000Z', kind: 'term_recovery' })
    ] as any;
    const term = { start: '2026-07-20T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z' };
    const cols = buildGradeColumns(events, [], [], 'S', 'C', term, 1);
    expect(cols.map(c => c.id)).toEqual(['p1', 'rec', 'tr']);
    expect(cols.find(c => c.id === 'rec')!.recoveryOf).toBe('p1');
    expect(cols.find(c => c.id === 'tr')!.outOfAverage).toBe(true);
    // no período seguinte a REC não aparece de novo
    expect(buildGradeColumns(events, [], [], 'S', 'C', { start: '2026-10-01T00:00:00.000Z', end: '2026-12-15T00:00:00.000Z' }, 2)).toEqual([]);
    // 2ª chamada que já tem nota lançada nela continua aparecendo
    expect(buildGradeColumns(events, [], [g('x', 'sc', 5)], 'S', 'C', term, 1).map(c => c.id)).toContain('sc');
  });
});
