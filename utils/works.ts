import { AppData, ClassStudent, LessonLog, MissingDelivery, School, SchoolEvent, Term } from '../types';
import { toSafeISO } from '../utils';
import { canonicalClassId, getClassName, isSameClassRef } from './classRefs';
import { getSchedulesForDate } from './schedule';
import { countRemainingLessons, findTerm } from './remainingLessons';
import { logAtLesson } from './assessmentLogs';

/**
 * Trabalhos (avaliações com type 'work'):
 * - em sala: o trabalho fica na aula da entrega (event.date/slotId, com o registro "Avaliação: X") e as
 *   outras aulas em sala são registros do diário "Trabalho em sala: X" ligados por `workId`. Assim eles
 *   acompanham a mudança de grade como qualquer registro, e o trabalho continua com uma coluna de notas;
 * - em casa: a data é a da entrega;
 * - quem não entregou fica em `missingDeliveries` até entregar (aviso nas aulas seguintes da turma);
 * - regra da escola: trabalhos exigidos por período (`School.worksPerTerm`, exceção por turma) e aviso
 *   das turmas sem trabalho a N semanas do fim do período (`School.workAlertWeeks`, padrão 6).
 */

const day = (d: string) => String(d || '').split('T')[0];
const addDays = (dateStr: string, n: number) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export const DEFAULT_WORK_ALERT_WEEKS = 6;

export const WORK_PLACE_LABELS: Record<NonNullable<SchoolEvent['workPlace']>, string> = { class: 'Em sala', home: 'Em casa' };
export const WORK_FORMAT_LABELS: Record<NonNullable<SchoolEvent['workFormat']>, string> = { individual: 'Individual', group: 'Em grupo' };

// ─── Aulas do trabalho em sala ───────────────────────────────────────────────

export interface WorkSession { date: string; slotId: string }

export const workSessionSubject = (title: string) => `Trabalho em sala: ${title}`;

/** Registro criado pelo app para a aula do trabalho (sem nada escrito pelo Cadu). */
export const isAutoWorkSessionLog = (log: LessonLog | undefined, title: string): boolean =>
  !!log && (log.subject || '').trim() === workSessionSubject(title) && !(log.homework || '').trim() &&
  !(log.notes || '').trim() && !(log.attendance && log.attendance.length > 0) && !(log.occurrences && log.occurrences.length > 0);

/** Aulas em sala do trabalho (além da aula da entrega), em ordem. */
export const workSessionLogs = (logs: LessonLog[], workId: string): LessonLog[] =>
  (logs || []).filter(l => l.workId === workId && l.status !== 'removed')
    .sort((a, b) => day(a.date).localeCompare(day(b.date)) || (a.startTime || '').localeCompare(b.startTime || ''));

/**
 * Registros do diário das aulas em sala depois de salvar o trabalho.
 * Registro escrito pelo Cadu nunca é apagado: ele só perde a ligação com o trabalho.
 */
export const planWorkSessionLogs = (
  logs: LessonLog[],
  event: SchoolEvent,
  sessions: WorkSession[],
  original: SchoolEvent | undefined,
  newId: () => string
): LessonLog[] => {
  let result = [...(logs || [])];
  const subject = workSessionSubject(event.title);
  const oldTitle = original?.title ?? event.title;
  const inClass = event.type === 'work' && event.workPlace === 'class' && !!event.classId;
  const mainKey = `${day(event.date)}|${event.slotId || ''}`;
  const wanted = inClass
    ? sessions.filter((s, i) => s.date && s.slotId && `${s.date}|${s.slotId}` !== mainKey &&
      sessions.findIndex(o => o.date === s.date && o.slotId === s.slotId) === i)
    : [];
  const wantedKeys = new Set(wanted.map(s => `${s.date}|${s.slotId}`));

  // Aulas que saíram do trabalho
  workSessionLogs(result, event.id).forEach(log => {
    const key = `${day(log.date)}|${log.slotId}`;
    if (wantedKeys.has(key) && log.schoolId === event.schoolId) {
      if (isAutoWorkSessionLog(log, oldTitle) && oldTitle !== event.title) {
        result = result.map(l => (l.id === log.id ? { ...l, subject } : l));
      }
      wantedKeys.delete(key);
      return;
    }
    if (isAutoWorkSessionLog(log, oldTitle)) {
      result = result.filter(l => l.id !== log.id);
    } else {
      result = result.map(l => {
        if (l.id !== log.id) return l;
        const { workId, ...rest } = l;
        return rest as LessonLog;
      });
    }
  });

  // Aulas novas do trabalho
  wanted.filter(s => wantedKeys.has(`${s.date}|${s.slotId}`)).forEach(s => {
    const existing = logAtLesson(result, event.schoolId, s.date, s.slotId);
    if (existing) {
      result = result.map(l => (l.id === existing.id ? { ...l, workId: event.id, subject: (l.subject || '').trim() ? l.subject : subject } : l));
    } else {
      result.push({
        id: newId(), date: toSafeISO(s.date), schoolId: event.schoolId, classId: event.classId!, slotId: s.slotId,
        subject, homework: '', notes: '', workId: event.id
      });
    }
  });
  return result;
};

/** Ao apagar trabalhos: sai o registro automático das aulas em sala; o que o Cadu escreveu fica. */
export const removeWorkSessionLogs = (logs: LessonLog[], removed: SchoolEvent[]): LessonLog[] => {
  const byId = new Map(removed.map(e => [e.id, e]));
  return (logs || []).flatMap(l => {
    const ev = l.workId ? byId.get(l.workId) : undefined;
    if (!ev) return [l];
    if (isAutoWorkSessionLog(l, ev.title)) return [];
    const { workId, ...rest } = l;
    return [rest as LessonLog];
  });
};

/** Trabalhos da turma que acontecem nesta aula (aula da entrega ou aula em sala). */
export const worksAtLesson = (data: AppData, schoolId: string, classId: string, date: string, slotId: string): SchoolEvent[] => {
  const d = day(date);
  const sessionIds = new Set((data.logs || [])
    .filter(l => l.workId && l.status !== 'removed' && l.schoolId === schoolId && day(l.date) === d && l.slotId === slotId)
    .map(l => l.workId!));
  return (data.events || []).filter(e => e.type === 'work' && e.schoolId === schoolId &&
    isSameClassRef(data, schoolId, e.classId, classId) &&
    ((day(e.date) === d && e.slotId === slotId) || sessionIds.has(e.id)));
};

// ─── Entregas ────────────────────────────────────────────────────────────────

/** Alunos ativos da lista da turma (Modos avançados → listas de alunos). */
export const classStudents = (data: AppData, schoolId: string, classId: string): ClassStudent[] => {
  const record = (data.classRecords || []).find(r => r.schoolId === schoolId && isSameClassRef(data, schoolId, r.classId, classId));
  return (record?.students || []).filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
};

export const pendingDeliveriesOf = (event: SchoolEvent): MissingDelivery[] =>
  (event.missingDeliveries || []).filter(m => !m.deliveredAt);

/** Trabalhos da turma com entrega pendente registrada antes desta data (aviso nas aulas seguintes). */
export const pendingDeliveriesForClass = (data: AppData, schoolId: string, classId: string, date: string) => {
  const d = day(date);
  return (data.events || [])
    .filter(e => e.type === 'work' && e.schoolId === schoolId && isSameClassRef(data, schoolId, e.classId, classId))
    .map(event => ({ event, items: pendingDeliveriesOf(event).filter(m => m.registeredAt < d) }))
    .filter(x => x.items.length > 0)
    .sort((a, b) => day(a.event.date).localeCompare(day(b.event.date)));
};

// ─── Regra da escola: trabalhos por período ──────────────────────────────────

export const worksRequired = (data: Pick<AppData, 'schools'>, school: School | undefined, classId: string): number => {
  if (!school) return 0;
  const byClass = school.worksPerTermByClass || {};
  const key = canonicalClassId(data, school.id, classId);
  const exception = byClass[key] ?? byClass[classId];
  return Math.max(0, Number(exception ?? school.worksPerTerm ?? 0) || 0);
};

/** Trabalhos regulares (sem REC e 2ª chamada) da turma dentro do período. */
export const worksInTerm = (data: AppData, schoolId: string, classId: string, term: Term): SchoolEvent[] =>
  (data.events || []).filter(e => e.type === 'work' && !e.kind && e.schoolId === schoolId &&
    isSameClassRef(data, schoolId, e.classId, classId) && day(e.date) >= day(term.start) && day(e.date) <= day(term.end));

export interface MissingWorkAlert {
  schoolId: string;
  classId: string;
  className: string;
  term: Term;
  count: number;
  required: number;
  /** Aulas da turma que faltam até o fim do período (a partir de hoje, inclusive) */
  lessonsLeft?: number;
}

/** Turmas da escola com aula na grade em vigor na data. */
const activeClassesOf = (data: AppData, school: School, date: string): string[] => {
  const keys = new Set<string>();
  getSchedulesForDate(data, date)
    .filter(s => s.schoolId === school.id && s.classId && s.classId !== 'window')
    .forEach(s => keys.add(canonicalClassId(data, school.id, s.classId)));
  return [...keys];
};

/**
 * Turmas com menos trabalhos do que a escola exige no período ativo, quando faltam N semanas (ou menos)
 * para o fim dele. Escolas sem regra (0) ficam de fora.
 */
export const missingWorkAlerts = (data: AppData, today: string, onlySchoolId?: string, onlyClassId?: string): MissingWorkAlert[] => {
  const alerts: MissingWorkAlert[] = [];
  (data.schools || []).filter(s => !s.deleted && (!onlySchoolId || s.id === onlySchoolId)).forEach(school => {
    const hasRule = (school.worksPerTerm || 0) > 0 || Object.values(school.worksPerTermByClass || {}).some(v => v > 0);
    if (!hasRule) return;
    const found = findTerm(data, school.id, today);
    if (!found) return;
    const weeks = school.workAlertWeeks || DEFAULT_WORK_ALERT_WEEKS;
    if (addDays(today, weeks * 7) < day(found.term.end)) return;
    activeClassesOf(data, school, today)
      .filter(classId => !onlyClassId || isSameClassRef(data, school.id, classId, onlyClassId))
      .forEach(classId => {
        const required = worksRequired(data, school, classId);
        if (!required) return;
        const count = worksInTerm(data, school.id, classId, found.term).length;
        if (count >= required) return;
        alerts.push({
          schoolId: school.id, classId, className: getClassName(data, school.id, classId),
          term: found.term, count, required,
          lessonsLeft: countRemainingLessons(data, { schoolId: school.id, classId, date: today })?.count
        });
      });
  });
  return alerts.sort((a, b) => a.className.localeCompare(b.className, 'pt-BR', { numeric: true }));
};

/** Contagem de trabalhos de cada turma da escola no período que contém a data ("1/2"). */
export const workCountsByClass = (data: AppData, today: string) => {
  const rows: { schoolId: string; schoolName: string; classId: string; className: string; count: number; required: number; term: Term }[] = [];
  (data.schools || []).filter(s => !s.deleted).forEach(school => {
    const found = findTerm(data, school.id, today);
    if (!found) return;
    activeClassesOf(data, school, today).forEach(classId => {
      const required = worksRequired(data, school, classId);
      if (!required) return;
      rows.push({
        schoolId: school.id, schoolName: school.name, classId, className: getClassName(data, school.id, classId),
        count: worksInTerm(data, school.id, classId, found.term).length, required, term: found.term
      });
    });
  });
  return rows.sort((a, b) => a.schoolName.localeCompare(b.schoolName) || a.className.localeCompare(b.className, 'pt-BR', { numeric: true }));
};
