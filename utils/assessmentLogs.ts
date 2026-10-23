import { AppData, LessonLog, SchoolEvent } from '../types';
import { parseTimeToMinutes, toSafeISO } from '../utils';
import { isSameClassRef } from './classRefs';
import { getLessonDisplayItems } from './lessonStats';
import { isOffLesson } from './assessmentPlace';

/**
 * Registro "Avaliação: {título}" do Diário ao cadastrar, remarcar, copiar ou apagar uma avaliação.
 * Mesma regra do conector (connector/escrita.ts): só o registro automático (texto exato, sem tarefa)
 * acompanha a avaliação; registro escrito pelo Cadu nunca é apagado.
 * Se a aula nova já tem conteúdo (planejado), o Cadu escolhe:
 * - swap: o conteúdo vai para a aula que a avaliação liberou (só ao remarcar, na mesma turma);
 * - push: o planejamento da turma anda uma aula para frente a partir da aula nova;
 * - merge: a aula fica com o conteúdo e a linha "Avaliação: X" no mesmo registro;
 * - keep: o registro da aula nova fica como está (sem a linha da avaliação).
 */

export type PlannedChoice = 'swap' | 'push' | 'merge' | 'keep';

export interface AssessmentLogPlan {
  logs: LessonLog[];
  /** A aula nova já tem registro do Cadu: é preciso escolher (logs não mudaram) */
  conflict?: LessonLog;
  /** Dá para trocar com a aula que a avaliação liberou */
  canSwap: boolean;
}

const day = (d: string) => String(d || '').split('T')[0];

export const assessmentLogSubject = (title: string) => `Avaliação: ${title}`;

export const isAutoAssessmentLog = (log: LessonLog | undefined, title: string): boolean =>
  !!log && (log.subject || '').trim() === assessmentLogSubject(title) && !(log.homework || '').trim();

/** Registro "fixo" (de avaliação ou de evento): não anda quando o planejamento é empurrado. */
const isFixedLog = (log: LessonLog) => /^(Avaliação|Evento):/.test((log.subject || '').trim()) && !(log.homework || '').trim();

export const logAtLesson = (logs: LessonLog[], schoolId: string, date: string, slotId?: string) =>
  slotId ? logs.find(l => l.status !== 'removed' && !l.studentId && day(l.date) === date && l.schoolId === schoolId && l.slotId === slotId) : undefined;

export const planAssessmentLogs = (
  data: AppData,
  original: SchoolEvent | undefined,
  event: SchoolEvent,
  choice: PlannedChoice | undefined,
  newId: () => string
): AssessmentLogPlan => {
  let logs = [...(data.logs || [])];
  const newDate = day(event.date);
  const subject = assessmentLogSubject(event.title);
  const oldDate = original ? day(original.date) : '';
  const oldLog = original ? logAtLesson(logs, original.schoolId, oldDate, original.slotId) : undefined;
  const oldAuto = original && isAutoAssessmentLog(oldLog, original.title) ? oldLog : undefined;
  // Observação do registro: acompanha a descrição da avaliação, a não ser que o Cadu tenha mudado
  const notesFor = (log?: LessonLog) => (!log || !original || (log.notes || '') === (original.description || '') ? event.description || '' : log.notes || '');

  const replace = (log: LessonLog, next: LessonLog) => { logs = logs.map(l => (l.id === log.id ? next : l)); };
  const remove = (log?: LessonLog) => { if (log) logs = logs.filter(l => l.id !== log.id); };
  const placeAuto = () => {
    if (!event.slotId) return;
    if (oldAuto) {
      replace(oldAuto, { ...oldAuto, date: toSafeISO(newDate), schoolId: event.schoolId, classId: event.classId!, slotId: event.slotId, subject, notes: notesFor(oldAuto) });
    } else {
      logs.push({ id: newId(), date: toSafeISO(newDate), schoolId: event.schoolId, classId: event.classId!, slotId: event.slotId, subject, homework: '', notes: event.description || '' });
    }
  };

  // Contraturno ou atividade fixa (utils/assessmentPlace.ts): não é aula da turma, sem registro
  if (isOffLesson(data, event)) {
    remove(oldAuto);
    return { logs, canSwap: false };
  }

  // Mesma aula: só atualiza o texto do registro automático
  if (original && original.slotId === event.slotId && oldDate === newDate && original.schoolId === event.schoolId) {
    if (oldAuto) placeAuto();
    else if (!oldLog) placeAuto();
    return { logs, canSwap: false };
  }

  const dest = logAtLesson(logs, event.schoolId, newDate, event.slotId);
  const canSwap = !!original?.slotId && (!oldLog || !!oldAuto) &&
    isSameClassRef(data, event.schoolId, original.classId, event.classId) && original.schoolId === event.schoolId;

  if (!dest) {
    placeAuto();
    return { logs, canSwap };
  }
  if (!choice) return { logs: data.logs || [], conflict: dest, canSwap };

  if (choice === 'keep') {
    remove(oldAuto);
  } else if (choice === 'merge') {
    remove(oldAuto);
    const text = (dest.subject || '').trim();
    replace(dest, { ...dest, subject: text ? `${text}\n${subject}` : subject });
  } else if (choice === 'swap' && canSwap && original?.slotId) {
    replace(dest, { ...dest, date: toSafeISO(oldDate), slotId: original.slotId });
    placeAuto();
  } else {
    // push: o conteúdo de cada aula da turma vai para a aula seguinte, até achar uma aula vazia
    const slot = (data.schools.find(s => s.id === event.schoolId)?.shifts || []).flatMap(s => s.slots).find(s => s.id === event.slotId);
    const start = parseTimeToMinutes(slot?.startTime || '00:00');
    const calendar = (data.calendars || []).find(c => c.schoolId === event.schoolId && newDate >= day(c.start) && newDate <= day(c.end));
    const end = calendar ? day(calendar.end) : `${newDate.slice(0, 4)}-12-31`;
    const lessons = getLessonDisplayItems({ ...data, logs }, { start: newDate, end, schoolId: event.schoolId, classId: 'all' })
      .filter(i => !i.isExtra && !i.isSubstitution && isSameClassRef(data, event.schoolId, i.schedule.classId, event.classId))
      .filter(i => i.date > newDate || parseTimeToMinutes(i.slot.startTime || '00:00') > start)
      .sort((a, b) => a.date.localeCompare(b.date) || parseTimeToMinutes(a.slot.startTime || '00:00') - parseTimeToMinutes(b.slot.startTime || '00:00'));

    let carry: LessonLog | undefined = dest;
    let lastPlaced: LessonLog | undefined;
    for (const lesson of lessons) {
      if (!carry) break;
      const here = logAtLesson(logs, event.schoolId, lesson.date, lesson.slot.id);
      // A aula antiga desta avaliação fica livre
      const free = !here || (oldAuto && here.id === oldAuto.id);
      if (!free && isFixedLog(here!)) continue;
      const moved: LessonLog = { ...carry, date: toSafeISO(lesson.date), slotId: lesson.slot.id };
      replace(carry, moved);
      lastPlaced = moved;
      carry = free ? undefined : here;
    }
    if (carry) {
      // Acabaram as aulas do ano: o que sobrou fica junto da última aula
      const target = lastPlaced || dest;
      const extra = (carry.subject || '').trim();
      if (target.id !== carry.id && extra) {
        replace(target, { ...target, subject: `${(target.subject || '').trim()}\n${extra}`.trim() });
        remove(carry);
      }
    }
    placeAuto();
  }
  return { logs, canSwap };
};

/** Ao apagar avaliações: tira só os registros automáticos delas. */
export const removeAssessmentLogs = (logs: LessonLog[], removed: SchoolEvent[]) =>
  logs.filter(l => !removed.some(e => e.slotId && day(l.date) === day(e.date) && l.schoolId === e.schoolId &&
    l.slotId === e.slotId && isAutoAssessmentLog(l, e.title)));
