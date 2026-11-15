import { AppData, LessonLog } from '../types';
import { getClassName, isSameClassRef } from './classRefs';

/**
 * "Usar o conteúdo de outra turma" na hora de registrar a aula (Diário).
 * O professor dá a mesma aula em turmas da mesma série da mesma escola (ex.: 183 e 184, 1ª Série A e B).
 * Sugere o registro mais recente de cada turma "irmã" que já avançou além da aula anterior desta turma.
 */

/** Até quantos dias para trás procurar o registro da turma irmã. */
export const SIBLING_LOOKBACK_DAYS = 21;

/** Registros automáticos do app: não fazem sentido para copiar. */
const AUTOMATIC_PREFIXES = ['avaliação:', 'evento:', 'trabalho em sala:'];

export interface ContentSuggestion {
  logId: string;
  classId: string;
  className: string;
  /** AAAA-MM-DD */
  date: string;
  subject: string;
  homework: string;
}

/**
 * Chave da série da turma, para achar turmas irmãs na mesma escola:
 * "183"/"184" → "18"; "1ª Série A"/"1ª Série B" → "1"; "6º MAT"/"6º VESP" → "6"; "9ª ano 1"/"9º ano 2" → "9".
 * Sem padrão reconhecível → null (não sugere nada).
 */
export const seriesKey = (className: string): string | null => {
  const name = String(className || '').trim().toLowerCase();
  const code = name.match(/^(\d{2})\d$/);
  if (code) return code[1];
  const ordinal = name.match(/^(\d{1,2})\s*[ºª°o]/);
  if (ordinal) return ordinal[1];
  const word = name.match(/^(\d{1,2})\s*(ano|série|serie)\b/);
  if (word) return word[1];
  return null;
};

const day = (d: string) => String(d || '').slice(0, 10);

const shiftDays = (dateStr: string, n: number) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const isAutomatic = (subject: string) => {
  const s = subject.trim().toLowerCase();
  return AUTOMATIC_PREFIXES.some(p => s.startsWith(p));
};

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function suggestContentFromSiblings(
  data: Pick<AppData, 'schools' | 'logs'>,
  current: {
    schoolId: string;
    classId: string;
    /** dia da aula (AAAA-MM-DD ou ISO) */
    date: string;
    /** dia da aula anterior desta turma (retrospectiva), se houver */
    previousDate?: string;
    /** conteúdo da aula anterior desta turma: não sugere repetir o que já foi dado */
    previousSubject?: string;
  },
  max = 3
): ContentSuggestion[] {
  const myName = getClassName(data, current.schoolId, current.classId, '');
  const myKey = seriesKey(myName);
  if (!myKey) return [];

  const lessonDay = day(current.date);
  const from = shiftDays(lessonDay, -SIBLING_LOOKBACK_DAYS);
  const after = current.previousDate ? day(current.previousDate) : '';
  const already = current.previousSubject ? norm(current.previousSubject) : '';

  const latestByClass = new Map<string, { log: LessonLog; className: string }>();
  for (const log of data.logs || []) {
    if (log.status === 'removed' || log.studentId) continue;
    if (log.schoolId !== current.schoolId) continue;
    const subject = (log.subject || '').trim();
    if (!subject || isAutomatic(subject)) continue;
    const d = day(log.date);
    if (d < from || d > lessonDay) continue;
    if (after && d < after) continue;
    if (already && norm(subject) === already) continue;
    if (!log.classId || log.classId === 'window') continue;
    if (isSameClassRef(data, current.schoolId, log.classId, current.classId)) continue;
    const className = getClassName(data, log.schoolId, log.classId, '');
    if (!className || seriesKey(className) !== myKey) continue;
    const key = norm(className);
    const prev = latestByClass.get(key);
    if (!prev || d > day(prev.log.date) || (d === day(prev.log.date) && (log.startTime || '') > (prev.log.startTime || ''))) {
      latestByClass.set(key, { log, className });
    }
  }

  return [...latestByClass.values()]
    .sort((a, b) => day(b.log.date).localeCompare(day(a.log.date)) || a.className.localeCompare(b.className))
    .slice(0, max)
    .map(({ log, className }) => ({
      logId: log.id,
      classId: log.classId,
      className,
      date: day(log.date),
      subject: log.subject.trim(),
      homework: (log.homework || '').trim()
    }));
}

/** "hoje", "ontem" ou "dd/mm", em relação a hoje (todayLocal). */
export const relativeDayLabel = (date: string, today: string): string => {
  const d = day(date);
  const t = day(today);
  if (d === t) return 'hoje';
  if (d === shiftDays(t, -1)) return 'ontem';
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
};
