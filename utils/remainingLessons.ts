import { AppData, Term } from '../types';
import { parseTimeToMinutes } from '../utils';
import { isSameClassRef } from './classRefs';
import { getLessonDisplayItems } from './lessonStats';

/**
 * Aulas que ainda faltam para uma turma até o fim do período (bimestre/trimestre), pela grade em
 * vigor e sem feriados, recessos e eventos que suspendem aula (mesma regra do Diário).
 * Usado na janela de registro da aula (Diário) e no conector do Claude.
 */

export interface RemainingLessons {
  /** Aulas depois da aula/momento de referência, até o fim do período (inclusive) */
  count: number;
  /** Datas das aulas que faltam (uma por aula; aulas seguidas aparecem repetidas) */
  dates: string[];
  term: Term;
  termIndex: number;
  /** Próxima avaliação da turma dentro do período, com quantas aulas faltam até ela (sem contar a dela) */
  nextAssessment?: { title: string; date: string; lessonsBefore: number };
}

const day = (d: string) => String(d || '').split('T')[0];

/** Período (bimestre/trimestre) da escola que contém a data. */
export const findTerm = (data: AppData, schoolId: string, date: string): { term: Term; index: number } | null => {
  const calendar = (data.calendars || []).find(c => c.schoolId === schoolId && date >= day(c.start) && date <= day(c.end));
  if (!calendar) return null;
  const index = (calendar.terms || []).findIndex(t => t.start && t.end && date >= day(t.start) && date <= day(t.end));
  return index >= 0 ? { term: calendar.terms[index], index } : null;
};

export const countRemainingLessons = (
  data: AppData,
  ref: {
    schoolId: string;
    classId: string;
    date: string;
    /** Horário de início da aula de referência: conta só as aulas depois dela. Sem horário, conta o dia todo. */
    afterStartTime?: string;
    /** Data final (padrão: fim do período que contém a data) */
    until?: string;
  }
): RemainingLessons | null => {
  const found = findTerm(data, ref.schoolId, ref.date);
  if (!found) return null;
  const until = ref.until || day(found.term.end);
  if (until < ref.date) return { count: 0, dates: [], term: found.term, termIndex: found.index };

  const after = ref.afterStartTime !== undefined ? parseTimeToMinutes(ref.afterStartTime) : -1;
  const lessons = getLessonDisplayItems(data, { start: ref.date, end: until, schoolId: ref.schoolId, classId: 'all' })
    .filter(item => item.institution.id === ref.schoolId && isSameClassRef(data, ref.schoolId, item.schedule.classId, ref.classId))
    .filter(item => item.date > ref.date || parseTimeToMinutes(item.slot.startTime || '00:00') > after)
    .sort((a, b) => a.date.localeCompare(b.date) ||
      parseTimeToMinutes(a.slot.startTime || '00:00') - parseTimeToMinutes(b.slot.startTime || '00:00'));

  const result: RemainingLessons = { count: lessons.length, dates: lessons.map(l => l.date), term: found.term, termIndex: found.index };

  const next = (data.events || [])
    .filter(e => (e.type === 'test' || e.type === 'work') && e.schoolId === ref.schoolId &&
      isSameClassRef(data, ref.schoolId, e.classId, ref.classId) && day(e.date) >= ref.date && day(e.date) <= until)
    .filter(e => {
      // Mesmo dia da referência: só se for numa aula depois dela
      if (day(e.date) !== ref.date || after < 0) return true;
      const slot = (data.schools.find(s => s.id === ref.schoolId)?.shifts || []).flatMap(s => s.slots).find(s => s.id === e.slotId);
      return !slot || parseTimeToMinutes(slot.startTime) > after;
    })
    .sort((a, b) => day(a.date).localeCompare(day(b.date)))[0];
  if (next) {
    const nextDay = day(next.date);
    const slot = (data.schools.find(s => s.id === ref.schoolId)?.shifts || []).flatMap(s => s.slots).find(s => s.id === next.slotId);
    const nextStart = slot ? parseTimeToMinutes(slot.startTime) : 0;
    const lessonsBefore = lessons.filter(l => l.date < nextDay || (l.date === nextDay && parseTimeToMinutes(l.slot.startTime || '00:00') < nextStart)).length;
    result.nextAssessment = { title: next.title, date: nextDay, lessonsBefore };
  }
  return result;
};
