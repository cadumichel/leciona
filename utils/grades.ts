import { GradeEntry, GradingConfig } from '../types';

/**
 * Cálculo das notas (tela Notas).
 *
 * - Média aritmética e ponderada contam cada nota proporcionalmente à nota máxima da avaliação
 *   (3 de 3 vale como 10 de 10). Avaliações sem nota lançada ficam de fora, como antes.
 * - Soma: soma das notas como lançadas (ex.: prova valendo 7 + trabalho valendo 3).
 * - Fórmula personalizada: N1, N2… são as notas como lançadas. Cada coluna tem um número fixo
 *   (`columnOrder` na configuração), para a fórmula não mudar quando entra uma coluna nova.
 */

export interface GradeColumn {
  id: string;
  weight: number;
  maxGrade: number;
  date: string;
}

type Entry = GradeEntry & { _m?: number };

/** Nota do aluno na avaliação. Se houver repetida (edição em dois aparelhos), vale a mais recente. */
export const latestGrade = (grades: GradeEntry[], studentId: string, assessmentId: string): GradeEntry | undefined => {
  let best: Entry | undefined;
  for (const g of grades as Entry[]) {
    if (g.studentId !== studentId || g.assessmentId !== assessmentId) continue;
    if (!best || (g._m ?? 0) >= (best._m ?? 0)) best = g;
  }
  return best;
};

/**
 * Número fixo de cada coluna (1 = N1). As colunas guardadas em `columnOrder` mantêm a posição,
 * mesmo que alguma tenha sido apagada (o número dela não é reaproveitado); as que ainda não
 * estão lá entram depois, em ordem de data.
 */
export const columnNumbers = (columns: GradeColumn[], columnOrder: string[] = []): Map<string, number> => {
  const numbers = new Map<string, number>();
  columnOrder.forEach((id, i) => {
    if (columns.some(c => c.id === id)) numbers.set(id, i + 1);
  });
  let next = columnOrder.length;
  [...columns]
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(c => {
      if (!numbers.has(c.id)) numbers.set(c.id, ++next);
    });
  return numbers;
};

/** Ordem a guardar na configuração: a atual, com as colunas novas no fim. */
export const frozenColumnOrder = (columns: GradeColumn[], columnOrder: string[] = []) => {
  const numbers = columnNumbers(columns, columnOrder);
  const order = [...columnOrder];
  [...numbers.entries()]
    .sort((a, b) => a[1] - b[1])
    .forEach(([id]) => {
      if (!order.includes(id)) order.push(id);
    });
  return order;
};

const evaluateFormula = (formula: string, values: Map<number, number>) => {
  const expression = formula
    .toUpperCase()
    // N10 antes de N1: troca cada variável inteira
    .replace(/\bN(\d+)\b/g, (_, n) => String(values.get(Number(n)) ?? 0));
  const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
  if (!sanitized.trim()) return null;
  // eslint-disable-next-line no-new-func
  const result = new Function(`return (${sanitized})`)();
  return typeof result === 'number' && isFinite(result) ? result : NaN;
};

/** Média (ou soma) do aluno, como texto para a tela: "8.5", "-" sem notas, "Erro" na fórmula. */
export const calculateStudentResult = (
  columns: GradeColumn[],
  grades: GradeEntry[],
  studentId: string,
  config: Pick<GradingConfig, 'formula' | 'customFormula'> & { columnOrder?: string[] }
): string => {
  if (columns.length === 0) return '-';

  if (config.formula === 'custom' && config.customFormula) {
    try {
      const numbers = columnNumbers(columns, config.columnOrder);
      const values = new Map<number, number>();
      columns.forEach(c => values.set(numbers.get(c.id)!, latestGrade(grades, studentId, c.id)?.value ?? 0));
      const result = evaluateFormula(config.customFormula, values);
      if (result === null) return '-';
      return isNaN(result) ? 'Erro' : result.toFixed(1);
    } catch {
      return 'Erro';
    }
  }

  let count = 0;
  let sum = 0;
  let sumNormalized = 0;
  let weightedSum = 0;
  let totalWeight = 0;
  columns.forEach(c => {
    const grade = latestGrade(grades, studentId, c.id);
    if (!grade) return;
    const max = c.maxGrade > 0 ? c.maxGrade : 10;
    const normalized = (grade.value / max) * 10;
    const w = c.weight || 1;
    count++;
    sum += grade.value;
    sumNormalized += normalized;
    weightedSum += normalized * w;
    totalWeight += w;
  });
  if (count === 0) return '-';
  if (config.formula === 'sum') return sum.toFixed(1);
  if (config.formula === 'weighted') return (weightedSum / totalWeight).toFixed(1);
  return (sumNormalized / count).toFixed(1);
};

/**
 * Lança ou apaga a nota mantendo o mesmo código (id) da nota existente, para a sincronização entre
 * aparelhos juntar as edições em vez de criar notas repetidas. Também limpa repetidas antigas.
 */
export const setGrade = (
  grades: GradeEntry[],
  studentId: string,
  assessmentId: string,
  value: number | null,
  newId: () => string = () => crypto.randomUUID()
): GradeEntry[] => {
  const current = latestGrade(grades, studentId, assessmentId);
  const others = grades.filter(g => !(g.studentId === studentId && g.assessmentId === assessmentId));
  if (value === null) return others;
  if (current && current.value === value) return [...others, current];
  return [...others, { ...(current || {}), id: current?.id || newId(), studentId, assessmentId, value }];
};
