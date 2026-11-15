import { AppData } from '../types';
import { LessonDisplayItem } from './lessonStats';
import { getClassName } from './classRefs';

/**
 * Pendências do Diário (aulas passadas sem registro), organizadas por turma e separadas entre o
 * período atual de cada escola (bimestre/trimestre em que estamos) e os períodos anteriores.
 */

export interface PendencyGroup {
  key: string;
  className: string;
  institutionName: string;
  /** Mais recentes primeiro */
  items: LessonDisplayItem[];
}

export interface PendencyGroups {
  current: PendencyGroup[];
  older: PendencyGroup[];
  /** Nome do período atual quando todas as escolas com pendência estão no mesmo (ex.: "3º TRI") */
  currentLabel: string | null;
}

/** Início do período atual da escola (YYYY-MM-DD) e o nome dele; null se não houver calendário. */
export const currentTermStart = (
  data: Pick<AppData, 'calendars'>,
  schoolId: string,
  today: string
): { start: string; name: string } | null => {
  const year = Number(today.slice(0, 4));
  const cal =
    data.calendars.find(c => c.schoolId === schoolId && c.start && c.end && c.start <= today && today <= c.end) ||
    data.calendars.find(c => c.schoolId === schoolId && c.year === year);
  if (!cal) return null;
  const started = cal.terms
    .filter(t => t.start && t.start <= today)
    .sort((a, b) => b.start.localeCompare(a.start));
  const term = started[0];
  return term ? { start: term.start, name: term.name } : null;
};

export const groupPendencies = (
  data: Pick<AppData, 'calendars' | 'schools'>,
  items: LessonDisplayItem[],
  today: string
): PendencyGroups => {
  const termCache = new Map<string, { start: string; name: string } | null>();
  const termOf = (schoolId: string) => {
    if (!termCache.has(schoolId)) termCache.set(schoolId, currentTermStart(data, schoolId, today));
    return termCache.get(schoolId)!;
  };

  const build = (list: LessonDisplayItem[]) => {
    const map = new Map<string, PendencyGroup>();
    for (const item of list) {
      const key = `${item.schedule.schoolId}|${item.schedule.classId}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          className: getClassName(data, item.schedule.schoolId, item.schedule.classId, '') || item.institution.name,
          institutionName: item.institution.name,
          items: [],
        };
        map.set(key, g);
      }
      g.items.push(item);
    }
    const groups = [...map.values()];
    groups.forEach(g => g.items.sort((a, b) => b.date.localeCompare(a.date) || a.slot.startTime.localeCompare(b.slot.startTime)));
    // Turmas com mais pendências primeiro; empate: a com pendência mais recente
    return groups.sort((a, b) => b.items.length - a.items.length || b.items[0].date.localeCompare(a.items[0].date) || a.className.localeCompare(b.className));
  };

  const current: LessonDisplayItem[] = [];
  const older: LessonDisplayItem[] = [];
  const names = new Set<string>();
  for (const item of items) {
    const term = termOf(item.schedule.schoolId);
    if (!term || item.date >= term.start) {
      current.push(item);
      if (term) names.add(term.name);
    } else {
      older.push(item);
    }
  }
  return { current: build(current), older: build(older), currentLabel: names.size === 1 ? [...names][0] : null };
};
