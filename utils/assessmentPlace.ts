import { AppData, School, SchoolEvent, TimeSlot } from '../types';
import { getDayOfWeekFromDate } from '../utils';
import { canonicalClassId } from './classRefs';
import { lessonNumberInShift } from './dashboardWeb';
import { getSchedulesForDate } from './schedule';

/**
 * Onde a avaliação acontece:
 * - numa aula da turma (registro "Avaliação: X" no Diário);
 * - numa atividade fixa da grade (ex.: "Aplicação de provas"): o professor aplica, mas não é aula
 *   da turma (sem registro no Diário, não conta como aula nem gera pendência);
 * - no contraturno (sem `slotId`): outro funcionário aplica; sem registro no Diário.
 */

export interface PlaceOption {
  slot: TimeSlot;
  shiftId: string;
  /** Número da aula no turno (1ª, 2ª…) */
  number: number;
  /** Nome da atividade fixa (só nas opções de atividade) */
  activity?: string;
}

const day = (d: string) => String(d || '').split('T')[0];

/** Aulas da turma e atividades fixas da escola na data, pela grade em vigor nela. */
export const assessmentPlaces = (data: AppData, school: School | undefined, classId: string | undefined, dateStr: string) => {
  const lessons: PlaceOption[] = [];
  const activities: PlaceOption[] = [];
  if (!school || !dateStr) return { lessons, activities };
  const d = day(dateStr);
  const dow = getDayOfWeekFromDate(d);
  const classKey = classId ? canonicalClassId(data, school.id, classId) : '';
  getSchedulesForDate(data, d)
    .filter(s => Number(s.dayOfWeek) === dow && s.schoolId === school.id)
    .forEach(s => {
      const shift = school.shifts?.find(sh => sh.id === s.shiftId);
      const slot = shift?.slots.find(sl => sl.id === s.slotId);
      if (!shift || !slot) return;
      const option = { slot, shiftId: shift.id, number: lessonNumberInShift(shift.slots, slot.id) };
      if (s.classId === 'window') {
        if (s.activityLabel) activities.push({ ...option, activity: s.activityLabel });
      } else if (classKey && canonicalClassId(data, school.id, s.classId) === classKey) {
        lessons.push(option);
      }
    });
  const byTime = (a: PlaceOption, b: PlaceOption) => a.slot.startTime.localeCompare(b.slot.startTime);
  return { lessons: lessons.sort(byTime), activities: activities.sort(byTime) };
};

/** Nome da atividade fixa no horário da avaliação (undefined se for aula da turma ou contraturno). */
export const activityAt = (data: AppData, schoolId: string, dateStr: string, slotId?: string): string | undefined => {
  if (!slotId) return undefined;
  const d = day(dateStr);
  const dow = getDayOfWeekFromDate(d);
  const entry = getSchedulesForDate(data, d).find(s =>
    Number(s.dayOfWeek) === dow && s.schoolId === schoolId && s.slotId === slotId && s.classId === 'window');
  return entry?.activityLabel || undefined;
};

/** A avaliação não acontece numa aula da turma (contraturno ou atividade fixa): sem registro no Diário. */
export const isOffLesson = (data: AppData, event: Pick<SchoolEvent, 'schoolId' | 'date' | 'slotId'>) =>
  !event.slotId || !!activityAt(data, event.schoolId, event.date, event.slotId);

/** Texto curto do horário: "2ª aula (08:15)", "1ª aula (07:20) · Aplicação de provas" ou "Contraturno". */
export const assessmentPlaceLabel = (data: AppData, event: Pick<SchoolEvent, 'schoolId' | 'date' | 'slotId'>): string => {
  if (!event.slotId) return 'Contraturno';
  const school = data.schools.find(s => s.id === event.schoolId);
  const shift = school?.shifts?.find(sh => sh.slots.some(sl => sl.id === event.slotId));
  const slot = shift?.slots.find(sl => sl.id === event.slotId);
  if (!shift || !slot) return '';
  const base = `${lessonNumberInShift(shift.slots, slot.id)}ª aula (${slot.startTime})`;
  const activity = activityAt(data, event.schoolId, event.date, event.slotId);
  return activity ? `${base} · ${activity}` : base;
};
