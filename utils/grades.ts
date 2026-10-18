import { CustomAssessment, GradeEntry, GradingConfig, SchoolEvent, Term } from '../types';

/**
 * Cálculo das notas (tela Notas).
 *
 * - Média aritmética e ponderada contam cada nota proporcionalmente à nota máxima da avaliação
 *   (3 de 3 vale como 10 de 10). Avaliações sem nota lançada ficam de fora, como antes.
 * - Soma: soma das notas como lançadas (ex.: prova valendo 7 + trabalho valendo 3).
 * - Fórmula personalizada: N1, N2… são as notas como lançadas. Cada coluna tem um número fixo
 *   (`columnOrder` na configuração), para a fórmula não mudar quando entra uma coluna nova.
 * - Recuperação e 2ª chamada (utils/recovery.ts), nas médias e na soma:
 *   - REC paralela: vale a nota mais alta entre a prova e a REC (a REC não conta como outra nota);
 *   - 2ª chamada: a nota vai na coluna da prova original (a 2ª chamada não ganha coluna);
 *   - REC trimestral: tem coluna, mas fica fora da média até haver a fórmula da escola.
 *   Na fórmula personalizada, todas as colunas entram como lançadas (a fórmula decide).
 */

export interface GradeColumn {
  id: string;
  weight: number;
  maxGrade: number;
  date: string;
  /** REC paralela desta avaliação: vale a nota mais alta */
  recoveryOf?: string;
  /** 2ª chamada desta avaliação (só aparece se já tiver nota lançada nela, de antes) */
  secondCallOf?: string;
  /** REC trimestral: fora da média automática */
  outOfAverage?: boolean;
}

export interface GradeTableColumn extends GradeColumn {
  title: string;
  type: string;
  isCustom: boolean;
  displayDate: string;
}

const day = (d: string) => (d || '').slice(0, 10);

/**
 * Colunas da tela Notas para a turma e o período: provas e trabalhos agendados + colunas
 * personalizadas, em ordem de data (a REC paralela logo depois da sua prova).
 * - A REC paralela fica no período da prova original, mesmo que caia no período seguinte.
 * - A 2ª chamada não tem coluna (a nota vai na da prova original), a não ser que já tenha nota
 *   lançada nela.
 */
export const buildGradeColumns = (
  events: SchoolEvent[],
  customAssessments: CustomAssessment[],
  grades: GradeEntry[],
  schoolId: string,
  classId: string,
  term: Pick<Term, 'start' | 'end'> | undefined,
  termIndex: number
): GradeTableColumn[] => {
  if (!term) return [];
  const inTerm = (d: string) => day(d) >= day(term.start || '') && day(d) <= day(term.end || '');
  const byId = new Map(events.map(e => [e.id, e]));
  const display = (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

  const scheduled = events.filter(e => {
    if (e.schoolId !== schoolId || e.classId !== classId || !['test', 'work'].includes(e.type)) return false;
    const parent = e.parentId ? byId.get(e.parentId) : undefined;
    if (e.kind === 'second_call' && !grades.some(g => g.assessmentId === e.id)) return false;
    if (e.kind === 'recovery' && parent) return inTerm(parent.date);
    return inTerm(e.date);
  }).map(e => ({
    id: e.id,
    title: e.title,
    type: e.type,
    weight: e.weight ?? 1,
    maxGrade: e.maxGrade ?? 10,
    isCustom: false,
    date: e.date,
    displayDate: display(e.date),
    ...(e.kind === 'recovery' && e.parentId ? { recoveryOf: e.parentId } : {}),
    ...(e.kind === 'second_call' && e.parentId ? { secondCallOf: e.parentId } : {}),
    ...(e.kind === 'term_recovery' ? { outOfAverage: true } : {})
  }));

  const custom = customAssessments.filter(c =>
    c.schoolId === schoolId && c.classId === classId && c.termIndex === termIndex
  ).map(c => ({
    id: c.id,
    title: c.title,
    type: 'custom',
    weight: c.weight,
    maxGrade: c.maxGrade ?? 10,
    isCustom: true,
    date: c.date,
    displayDate: display(c.date)
  }));

  // Em ordem de data; a REC paralela logo depois da sua prova
  const sortKey = (c: { date: string; recoveryOf?: string }) => {
    const parent = c.recoveryOf ? byId.get(c.recoveryOf) : undefined;
    return parent ? `${parent.date}~${c.date}` : c.date;
  };
  return [...scheduled, ...custom].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
};

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

  const ids = new Set(columns.map(c => c.id));
  const maxOf = (c: GradeColumn) => (c.maxGrade > 0 ? c.maxGrade : 10);
  /** Fração da nota máxima (0 a 1) ou undefined sem nota */
  const fraction = (c: GradeColumn) => {
    const g = latestGrade(grades, studentId, c.id);
    return g ? g.value / maxOf(c) : undefined;
  };

  let count = 0;
  let sum = 0;
  let sumNormalized = 0;
  let weightedSum = 0;
  let totalWeight = 0;
  columns.forEach(c => {
    // REC paralela e 2ª chamada entram na nota da avaliação original; REC trimestral fica fora
    if (c.outOfAverage) return;
    if ((c.recoveryOf && ids.has(c.recoveryOf)) || (c.secondCallOf && ids.has(c.secondCallOf))) return;

    let best = fraction(c);
    if (best === undefined) {
      // Faltou na prova: vale a 2ª chamada (se a nota foi lançada na coluna dela)
      for (const sc of columns.filter(x => x.secondCallOf === c.id)) {
        const f = fraction(sc);
        if (f !== undefined) { best = f; break; }
      }
    }
    for (const rec of columns.filter(x => x.recoveryOf === c.id)) {
      const f = fraction(rec);
      if (f !== undefined && (best === undefined || f > best)) best = f;
    }
    if (best === undefined) return;

    const max = maxOf(c);
    const value = best * max;
    const normalized = best * 10;
    const w = c.weight || 1;
    count++;
    sum += value;
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
