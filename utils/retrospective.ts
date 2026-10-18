import { AppData } from '../types';
import { parseTimeToMinutes } from '../utils';
import { isSameClassRef } from './classRefs';
import { getLessonDisplayItems } from './lessonStats';

/** Até quantos dias para trás procurar a aula anterior (cobre férias de meio de ano). */
const LOOKBACK_DAYS = 120;

export interface PreviousLesson {
  date: string;
  subject: string;
  homework: string;
  /** false = a aula anterior aconteceu, mas está sem conteúdo no diário */
  hasContent: boolean;
}

const shiftDays = (dateStr: string, n: number) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/**
 * Retrospectiva do diário: a aula imediatamente anterior da turma (pela grade, sem feriados,
 * recessos e aulas removidas, como no restante do Diário), mesmo que esteja sem conteúdo.
 * Antes, o app mostrava o último registro com conteúdo, pulando as aulas não registradas.
 */
export const findPreviousLesson = (
  data: AppData,
  current: { institutionId: string; classId: string; date: string; slotId: string; startTime: string; isPrivate: boolean }
): PreviousLesson | null => {
  const currentStart = parseTimeToMinutes(current.startTime || '00:00');
  const items = getLessonDisplayItems(data, {
    start: shiftDays(current.date, -LOOKBACK_DAYS),
    end: current.date,
    schoolId: current.institutionId,
    classId: 'all'
  });

  const previous = items
    .filter(item => {
      if (item.institution.id !== current.institutionId) return false;
      if (!current.isPrivate && !isSameClassRef(data, current.institutionId, item.schedule.classId, current.classId)) return false;
      if (current.isPrivate && item.schedule.classId !== current.classId) return false;
      if (item.date > current.date) return false;
      if (item.date === current.date) {
        if (item.schedule.slotId === current.slotId) return false;
        return parseTimeToMinutes(item.slot.startTime || '00:00') < currentStart;
      }
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date) ||
      parseTimeToMinutes(b.slot.startTime || '00:00') - parseTimeToMinutes(a.slot.startTime || '00:00'))[0];

  if (!previous) return null;
  const subject = (previous.log?.subject || '').trim();
  const homework = (previous.log?.homework || '').trim();
  return { date: previous.date, subject, homework, hasContent: !!(subject || homework) };
};
