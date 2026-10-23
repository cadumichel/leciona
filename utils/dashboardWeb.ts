import { AppData, ScheduleEntry, TimeSlot } from '../types';
import { isHoliday, parseTimeToMinutes } from '../utils';
import { getSchedulesForDate } from './schedule';
import { getClassName, isSameClassRef } from './classRefs';
import { getLessonDisplayItems, isLessonBlocked } from './lessonStats';

/**
 * Dados do Início na versão web (computador): a linha do dia e a grade semanal.
 * Cada aula aparece separada, inclusive aulas seguidas na mesma turma.
 */

/** Número da aula dentro do turno (1ª, 2ª…): conta só os horários de aula e recomeça a cada turno. */
export const lessonNumberInShift = (slots: TimeSlot[], slotId: string): number =>
  slots.filter(s => s.type !== 'break').findIndex(s => s.id === slotId) + 1;

export const periodOf = (startTime: string) => {
  const hour = parseInt((startTime || '08:00').split(':')[0], 10);
  return hour < 12 ? 'MAT' : hour < 18 ? 'VESP' : 'NOT';
};

export type TodayLessonStatus = 'done' | 'pending' | 'now' | 'upcoming' | 'blocked' | 'window';

export interface TodayLesson {
  key: string;
  number: number; // 0 = sem número (aula particular)
  className: string;
  startTime: string;
  endTime: string;
  isWindow: boolean;
  blocked: boolean;
  hasContent: boolean;
  assessment?: string; // prova/trabalho marcado para esta turma hoje
  schedule: any; // o mesmo objeto que o cartão "Atividade Agora" usa para abrir o registro
}

export interface TodayGroup {
  key: string;
  schoolName: string;
  shiftName: string;
  color: string;
  lessons: TodayLesson[];
}

export const todayLessonStatus = (lesson: TodayLesson, nowMinutes: number): TodayLessonStatus => {
  if (lesson.isWindow) return 'window';
  if (lesson.blocked) return 'blocked';
  const start = parseTimeToMinutes(lesson.startTime);
  const end = parseTimeToMinutes(lesson.endTime);
  if (nowMinutes >= start && nowMinutes < end) return 'now';
  // Aula que ainda não aconteceu fica "a seguir", mesmo com conteúdo já lançado
  // (ex.: o registro automático "Avaliação: P2" criado ao marcar uma prova)
  if (nowMinutes < start) return 'upcoming';
  return lesson.hasContent ? 'done' : 'pending';
};

/** Aulas da grade de hoje, em ordem de horário, agrupadas por escola + turno. */
export const buildTodayTimeline = (data: AppData, dateStr: string): TodayGroup[] => {
  const date = new Date(dateStr + 'T12:00:00');
  if (isHoliday(date)) return [];
  const dayOfWeek = date.getDay();

  // Situação de registro de cada aula (mesma regra das pendências)
  const items = getLessonDisplayItems(data, { start: dateStr, end: dateStr, schoolId: 'all', classId: 'all' });
  const itemBySchedule = new Map<any, (typeof items)[number]>(items.map(i => [i.schedule, i]));
  const itemByPrivateKey = new Map(items.map(i => [`${i.schedule.schoolId}|${i.schedule.slotId}`, i]));

  const rows: (TodayLesson & { groupKey: string; schoolName: string; shiftName: string; color: string })[] = [];

  // Provas e trabalhos de hoje
  const todaysAssessments = (data.events || []).filter(e =>
    (e.type === 'test' || e.type === 'work') && (e.date || '').startsWith(dateStr));
  // A avaliação guarda o horário (aula) escolhido; sem horário, vale para todas as aulas da turma
  const assessmentFor = (schoolId: string, classRef: string, slotId: string) =>
    todaysAssessments.find(e => e.schoolId === schoolId && isSameClassRef(data, schoolId, e.classId, classRef) &&
      (!e.slotId || e.slotId === slotId))?.title;

  getSchedulesForDate(data, dateStr).forEach((s: ScheduleEntry) => {
    if (Number(s.dayOfWeek) !== dayOfWeek) return;
    const school = data.schools.find(sc => sc.id === s.schoolId);
    if (!school || school.deleted) return;
    const shift = school.shifts.find(sh => sh.id === s.shiftId);
    const slot = shift?.slots.find(sl => sl.id === s.slotId);
    if (!shift || !slot) return;

    // Janela/atividade fixa em que o Cadu deu aula para uma turma nesse dia (aula extra no horário)
    const classInSlot = s.classId === 'window'
      ? (data.logs || []).find(l => l.type === 'extra' && l.status !== 'removed' && l.schoolId === s.schoolId && l.slotId === s.slotId && (l.date || '').startsWith(dateStr))
      : undefined;
    const isWindow = s.classId === 'window' && !classInSlot;
    const blocked = !isWindow && isLessonBlocked(data, dateStr, s.schoolId, s.shiftId, classInSlot ? classInSlot.classId : s.classId);
    const item = classInSlot ? items.find(i => i.log?.id === classInSlot.id) : itemBySchedule.get(s);
    // Aula que não conta (fora do calendário letivo da escola): não aparece
    if (!isWindow && !blocked && !item) return;

    rows.push({
      key: s.id || `${s.schoolId}|${s.slotId}`,
      groupKey: `${s.schoolId}|${s.shiftId}`,
      schoolName: school.name,
      shiftName: shift.name,
      color: school.color,
      number: lessonNumberInShift(shift.slots, slot.id),
      className: classInSlot ? getClassName(data, s.schoolId, classInSlot.classId, classInSlot.classId)
        : isWindow ? (s.activityLabel || 'Janela') : getClassName(data, s.schoolId, s.classId, s.classId),
      startTime: slot.startTime,
      endTime: slot.endTime,
      isWindow,
      blocked,
      hasContent: classInSlot ? !!(classInSlot.subject || classInSlot.homework) : !!item?.hasContent,
      assessment: isWindow ? undefined : assessmentFor(s.schoolId, classInSlot ? classInSlot.classId : s.classId, s.slotId),
      // A aula da turma abre pelo próprio registro (aula extra)
      schedule: classInSlot ? { ...s, shiftId: 'extra', slotId: classInSlot.id, classId: classInSlot.classId } : s
    });
  });

  if (data.settings.isPrivateTeacher) {
    (data.students || []).forEach(st => {
      if (dateStr < st.startDate) return;
      const blocked = isLessonBlocked(data, dateStr, st.id);
      (st.schedules || []).filter(ps => Number(ps.dayOfWeek) === dayOfWeek).forEach(ps => {
        const item = itemByPrivateKey.get(`${st.id}|${ps.id}`);
        rows.push({
          key: `${st.id}|${ps.id}`,
          groupKey: 'private',
          schoolName: 'Particulares',
          shiftName: '',
          color: st.color || '#64748b',
          number: 0,
          className: st.name,
          startTime: ps.startTime,
          endTime: ps.endTime,
          isWindow: false,
          blocked,
          hasContent: !!item?.hasContent,
          schedule: ps
        });
      });
    });
  }

  rows.sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime) || a.schoolName.localeCompare(b.schoolName));

  // Aulas seguidas da mesma escola e turno ficam no mesmo grupo (uma etiqueta por aula)
  const groups: TodayGroup[] = [];
  rows.forEach(({ groupKey, schoolName, shiftName, color, ...lesson }) => {
    const last = groups[groups.length - 1];
    if (last && last.key === groupKey) last.lessons.push(lesson);
    else groups.push({ key: groupKey, schoolName, shiftName, color, lessons: [lesson] });
  });
  return groups;
};

export interface WeekLesson {
  key: string;
  time: string;
  className: string;
}

export interface WeekGroup {
  key: string;
  schoolName: string;
  period: string;
  color: string;
  lessons: WeekLesson[];
}

export interface WeekDay {
  day: number;
  label: string;
  groups: WeekGroup[];
  count: number;
}

const DAY_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

/** Grade da semana em vigor: cada aula numa linha "HH:MM Turma" (aulas seguidas aparecem repetidas). */
export const buildWeeklyGrid = (data: AppData, dateStr: string): WeekDay[] => {
  const rows: (WeekLesson & { day: number; start: number; groupKey: string; schoolName: string; period: string; color: string })[] = [];

  getSchedulesForDate(data, dateStr).forEach((e: ScheduleEntry) => {
    if (e.classId === 'window') return;
    const school = data.schools.find(s => s.id === e.schoolId);
    if (!school || school.deleted) return;
    const shift = school.shifts.find(sh => sh.id === e.shiftId);
    const slot = shift?.slots.find(sl => sl.id === e.slotId);
    if (!shift || !slot) return;
    rows.push({
      key: e.id || `${e.dayOfWeek}|${e.schoolId}|${e.slotId}`,
      day: Number(e.dayOfWeek),
      start: parseTimeToMinutes(slot.startTime),
      time: slot.startTime,
      className: getClassName(data, e.schoolId, e.classId, e.classId),
      groupKey: `${e.schoolId}|${e.shiftId}`,
      schoolName: school.name,
      period: periodOf(slot.startTime),
      color: school.color
    });
  });

  if (data.settings.isPrivateTeacher) {
    (data.students || []).forEach(st => (st.schedules || []).forEach(ps => rows.push({
      key: `${st.id}|${ps.id}`,
      day: Number(ps.dayOfWeek),
      start: parseTimeToMinutes(ps.startTime),
      time: ps.startTime,
      className: st.name,
      groupKey: 'private',
      schoolName: 'Particulares',
      period: periodOf(ps.startTime),
      color: st.color || '#64748b'
    })));
  }

  const days = [1, 2, 3, 4, 5];
  if (rows.some(r => r.day === 6)) days.push(6);

  return days.map(day => {
    const dayRows = rows
      .filter(r => r.day === day)
      .sort((a, b) => a.start - b.start || a.schoolName.localeCompare(b.schoolName));
    const groups: WeekGroup[] = [];
    dayRows.forEach(r => {
      const last = groups[groups.length - 1];
      const lesson = { key: r.key, time: r.time, className: r.className };
      if (last && last.key === r.groupKey) last.lessons.push(lesson);
      else groups.push({ key: r.groupKey, schoolName: r.schoolName, period: r.period, color: r.color, lessons: [lesson] });
    });
    return { day, label: DAY_LABELS[day], groups, count: dayRows.length };
  });
};
