import { describe, it, expect } from 'vitest';
import { calculateStudentResult, columnNumbers, frozenColumnOrder, latestGrade, setGrade } from '../utils/grades';

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
