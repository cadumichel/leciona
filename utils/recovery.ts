import { AppData, School, SchoolEvent, TimeSlot } from '../types';
import { formatDateBR, getHolidayName, getSafeDate, parseTimeToMinutes } from '../utils';
import { isSameClassRef } from './classRefs';
import { getSchedulesForDate } from './schedule';
import { isLessonBlocked } from './lessonStats';
import { findTerm } from './remainingLessons';

/**
 * Recuperação e 2ª chamada (regra de cada escola em Ajustes → Escolas):
 * - recuperação paralela (ex.: Cônsul): cada prova regular ganha uma REC N dias depois;
 * - recuperação trimestral (ex.: Uniavan, São Luiz): conteúdo = assuntos das provas do trimestre;
 * - 2ª chamada: copia a prova original; na aula do professor ou no contraturno (sem aula).
 * A avaliação derivada guarda `kind` e `parentId` (a prova original).
 */

export const DEFAULT_RECOVERY_DAYS = 15;

export const recoveryPolicyOf = (school?: School) => school?.recoveryPolicy || 'none';
export const recoveryDaysOf = (school?: School) => school?.recoveryDelayDays || DEFAULT_RECOVERY_DAYS;
export const secondCallModeOf = (school?: School) => school?.secondCallMode || 'in_class';

/** Avaliação "regular" (não é REC nem 2ª chamada). */
export const isRegularAssessment = (e: SchoolEvent) => (e.type === 'test' || e.type === 'work') && !e.kind;

export const KIND_LABELS: Record<NonNullable<SchoolEvent['kind']>, string> = {
  recovery: 'REC',
  term_recovery: 'REC trimestral',
  second_call: '2ª chamada'
};

const day = (d: string) => String(d || '').split('T')[0];

const addDays = (dateStr: string, n: number) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const weekday = (dateStr: string) => getSafeDate(dateStr).getDay();
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Aulas da turma numa data (pela grade em vigor), em ordem de horário. */
export const classLessonsOn = (data: AppData, school: School, classId: string, date: string): TimeSlot[] => {
  const dow = weekday(date);
  return getSchedulesForDate(data, date)
    .filter(s => Number(s.dayOfWeek) === dow && s.schoolId === school.id && s.classId !== 'window' &&
      isSameClassRef(data, school.id, s.classId, classId))
    .map(s => school.shifts.find(sh => sh.id === s.shiftId)?.slots.find(sl => sl.id === s.slotId))
    .filter((s): s is TimeSlot => !!s)
    .sort((a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime));
};

/** Problemas da data para aplicar uma avaliação (feriado, recesso, eventos na semana, sem aula). */
export const checkAssessmentDate = (data: AppData, school: School, classId: string, date: string) => {
  const warnings: string[] = [];
  let blocked = false;
  const holiday = getHolidayName(getSafeDate(date));
  if (holiday) { warnings.push(`${formatDateBR(date)} é feriado (${holiday}).`); blocked = true; }
  if (!holiday && isLessonBlocked(data, date, school.id, undefined, classId)) {
    warnings.push(`${formatDateBR(date)} está sem aula (recesso ou evento que suspende aulas).`);
    blocked = true;
  }
  const lessons = classLessonsOn(data, school, classId, date);
  if (!blocked && lessons.length === 0) warnings.push(`A turma não tem aula na ${WEEKDAYS[weekday(date)]} (${formatDateBR(date)}).`);

  // Outros eventos na mesma semana (segunda a sexta) que podem atrapalhar
  const dow = weekday(date);
  const monday = addDays(date, dow === 0 ? -6 : 1 - dow);
  const friday = addDays(monday, 4);
  (data.events || [])
    .filter(e => e.schoolId === school.id && e.type !== 'test' && e.type !== 'work' &&
      day(e.date) >= monday && day(e.date) <= friday && (!e.classId || isSameClassRef(data, school.id, e.classId, classId)))
    .forEach(e => warnings.push(`Na mesma semana: "${e.title}" em ${formatDateBR(e.date)}${e.blocksClasses ? ' (suspende aulas)' : ''}.`));
  const midBreak = (data.calendars || []).find(c => c.schoolId === school.id)?.midYearBreak;
  if (midBreak?.start && date >= midBreak.start && date <= midBreak.end) blocked = true;

  return { warnings, blocked, lessons };
};

/** Próxima data (a partir de `from`, inclusive) em que a turma tem aula e não está bloqueada. */
export const nextLessonDate = (data: AppData, school: School, classId: string, from: string, maxDays = 60) => {
  for (let i = 0; i <= maxDays; i++) {
    const d = addDays(from, i);
    const { blocked, lessons } = checkAssessmentDate(data, school, classId, d);
    if (!blocked && lessons.length > 0) return d;
  }
  return null;
};

/** Sugestão da REC paralela: N dias depois da prova; avisa e indica a próxima aula se precisar. */
export const suggestRecovery = (data: AppData, school: School, classId: string, examDate: string) => {
  const date = addDays(day(examDate), recoveryDaysOf(school));
  const check = checkAssessmentDate(data, school, classId, date);
  const next = check.blocked || check.lessons.length === 0 ? nextLessonDate(data, school, classId, addDays(date, 1)) : null;
  return {
    date,
    ...check,
    nextAvailable: next,
    nextAvailableText: next ? `Próxima aula da turma: ${WEEKDAYS[weekday(next)]} ${formatDateBR(next)}.` : undefined
  };
};

/** Conteúdo da REC trimestral: assuntos das avaliações regulares da turma no trimestre, antes da data. */
export const termRecoveryContent = (data: AppData, schoolId: string, classId: string, date: string) => {
  const found = findTerm(data, schoolId, date);
  const start = found ? day(found.term.start) : `${date.slice(0, 4)}-01-01`;
  return (data.events || [])
    .filter(e => isRegularAssessment(e) && e.schoolId === schoolId && isSameClassRef(data, schoolId, e.classId, classId) &&
      day(e.date) >= start && day(e.date) < date)
    .sort((a, b) => day(a.date).localeCompare(day(b.date)))
    .map(e => (e.description?.trim() ? `${e.title}: ${e.description.trim()}` : e.title))
    .join(' · ');
};

/** Avaliações que podem ter 2ª chamada/REC ligada: as regulares da turma. */
export const parentCandidates = (data: AppData, schoolId: string, classId: string) =>
  (data.events || [])
    .filter(e => isRegularAssessment(e) && e.schoolId === schoolId && isSameClassRef(data, schoolId, e.classId, classId))
    .sort((a, b) => day(b.date).localeCompare(day(a.date)));

/** REC paralela de uma prova. */
export const buildRecovery = (original: SchoolEvent, date: string, slotId: string, id: string): SchoolEvent => ({
  id, kind: 'recovery', parentId: original.id,
  title: `REC ${original.title}`, date: `${date}T00:00:00.000Z`, schoolId: original.schoolId,
  classId: original.classId, slotId, type: 'test', description: original.description || '', blocksClasses: false
});

/** 2ª chamada de uma avaliação (slotId vazio = contraturno, fora das aulas do professor). */
export const buildSecondCall = (original: SchoolEvent, date: string, slotId: string | undefined, id: string): SchoolEvent => ({
  id, kind: 'second_call', parentId: original.id,
  title: `2ª chamada — ${original.title}`, date: `${date}T00:00:00.000Z`, schoolId: original.schoolId,
  classId: original.classId, ...(slotId ? { slotId } : {}), type: original.type,
  description: original.description || '', blocksClasses: false
});

/** Avaliações ligadas a uma prova (REC e 2ª chamada). */
export const linkedAssessments = (events: SchoolEvent[], id: string) => events.filter(e => e.parentId === id);
