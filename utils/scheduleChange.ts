import { AppData, LessonLog, ScheduleEntry, SchoolEvent, TimeSlot } from '../types';
import { formatDateBR, getHolidayName, getSafeDate, parseTimeToMinutes, toSafeISO } from '../utils';
import { canonicalClassId } from './classRefs';
import { isLessonBlocked } from './lessonStats';

/**
 * Mudança de grade (nova versão do horário ou edição de uma versão): o que acontece com os
 * registros do diário e as avaliações já agendados a partir da data da mudança.
 *
 * Regras:
 * - nada antes de `activeFrom` muda; nada a partir da versão seguinte (`until`) muda;
 * - a correspondência é pela ORDEM das aulas da turma na semana (1ª aula antiga → 1ª aula nova…),
 *   com os horários reais, mesmo que o horário antigo ainda exista na grade nova;
 * - nunca dois itens no mesmo horário; a avaliação e o seu registro "Avaliação:" andam juntos;
 * - destino em feriado, recesso, fora do período ou ocupado → sem sugestão, com aviso.
 */

export type ScheduleDecisionType = 'MOVE' | 'EXTRA' | 'DELETE';

export interface ScheduleDecision {
  logId: string;
  type: ScheduleDecisionType;
  targetDate?: string;
  targetSlotId?: string;
  targetTime?: { startTime: string; endTime: string };
  targetSlot?: ScheduleEntry;
  isCustomDate?: boolean;
  /** Escolhida em "Outra aula neste dia": qualquer horário da escola na data (aula de outra turma,
   * atividade fixa ou horário livre). O registro vira aula extra nesse horário. */
  daySlot?: boolean;
  /** O horário escolhido é uma atividade fixa (avaliação sem registro no diário) */
  toActivity?: boolean;
}

export interface ScheduleChangePlan {
  /** Registros do diário que precisam de decisão */
  orphans: LessonLog[];
  /** Avaliações (e outros eventos numa aula da turma) que precisam de decisão */
  orphanEvents: SchoolEvent[];
  /** Sugestão para cada item (id → decisão) */
  suggestions: Record<string, ScheduleDecision>;
  /** Aviso para os itens sem sugestão automática */
  notes: Record<string, string>;
}

interface Lesson { entry: ScheduleEntry; dow: number; start: number; slot?: TimeSlot }

const day = (d: string) => String(d || '').split('T')[0];
const addDays = (dateStr: string, n: number) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekdayOf = (dateStr: string) => getSafeDate(dateStr).getDay();
/** Segunda = 0 … domingo = 6 */
const mondayIndex = (dow: number) => (dow + 6) % 7;

/** Aulas da turma na semana, em ordem (dia e horário). */
const weeklyLessons = (data: AppData, schedules: ScheduleEntry[], schoolId: string, classKey: string): Lesson[] => {
  const school = data.schools.find(s => s.id === schoolId);
  return schedules
    .filter(s => s.schoolId === schoolId && s.classId !== 'window' && canonicalClassId(data, schoolId, s.classId) === classKey)
    .map(entry => {
      const slot = school?.shifts.find(sh => sh.id === entry.shiftId)?.slots.find(sl => sl.id === entry.slotId);
      return { entry, dow: Number(entry.dayOfWeek), start: slot ? parseTimeToMinutes(slot.startTime) : 0, slot };
    })
    .sort((a, b) => mondayIndex(a.dow) - mondayIndex(b.dow) || a.start - b.start);
};

const sameSequence = (a: Lesson[], b: Lesson[]) =>
  a.length === b.length && a.every((l, i) => l.dow === b[i].dow && l.entry.slotId === b[i].entry.slotId);

export const planScheduleChange = (
  data: AppData,
  oldSchedules: ScheduleEntry[],
  newSchedules: ScheduleEntry[],
  activeFrom: string,
  until?: string
): ScheduleChangePlan => {
  const plan: ScheduleChangePlan = { orphans: [], orphanEvents: [], suggestions: {}, notes: {} };
  const inPeriod = (d: string) => d >= activeFrom && (!until || d < until);

  // Turmas cuja sequência semanal mudou
  const classes = new Set<string>();
  [...oldSchedules, ...newSchedules].forEach(s => {
    if (s.classId !== 'window') classes.add(`${s.schoolId}|${canonicalClassId(data, s.schoolId, s.classId)}`);
  });

  type Item = { item: LessonLog | SchoolEvent; isEvent: boolean; date: string; slotId: string; origKey: string };
  type Target = { date: string; lesson: Lesson } | { note: string } | 'same';

  classes.forEach(key => {
    const [schoolId, classKey] = key.split('|');
    const oldSeq = weeklyLessons(data, oldSchedules, schoolId, classKey);
    const newSeq = weeklyLessons(data, newSchedules, schoolId, classKey);
    if (sameSequence(oldSeq, newSeq)) return;

    const sameClass = (ref?: string) => !!ref && canonicalClassId(data, schoolId, ref) === classKey;
    const items: Item[] = [
      ...(data.logs || [])
        .filter(l => !l.studentId && l.schoolId === schoolId && sameClass(l.classId) && l.status !== 'removed' &&
          l.type !== 'extra' && l.type !== 'substitution' && l.slotId && inPeriod(day(l.date)))
        .map(l => ({ item: l, isEvent: false, date: day(l.date), slotId: l.slotId, origKey: `${day(l.date)}|${l.slotId}` })),
      ...(data.events || [])
        .filter(e => e.schoolId === schoolId && sameClass(e.classId) && e.slotId && !e.blocksClasses && inPeriod(day(e.date)))
        .map(e => ({ item: e, isEvent: true, date: day(e.date), slotId: e.slotId!, origKey: `${day(e.date)}|${e.slotId}` }))
    ];

    // 1º passo: destino de cada item pela posição na semana
    const targets = new Map<Item, Target>();
    items.forEach(it => {
      const dow = weekdayOf(it.date);
      const pos = oldSeq.findIndex(l => l.dow === dow && l.entry.slotId === it.slotId);
      if (pos < 0) {
        // Não estava na grade antiga: se já bate com a nova, fica; senão, o professor decide
        const fits = newSeq.some(l => l.dow === dow && l.entry.slotId === it.slotId);
        targets.set(it, fits ? 'same' : { note: 'Não corresponde a uma aula da grade antiga.' });
        return;
      }
      const lesson = newSeq[pos];
      if (!lesson) {
        targets.set(it, { note: 'A turma tem menos aulas na semana na nova grade.' });
        return;
      }
      const monday = addDays(it.date, -mondayIndex(dow));
      const date = addDays(monday, mondayIndex(lesson.dow));
      if (date === it.date && lesson.entry.slotId === it.slotId) { targets.set(it, 'same'); return; }
      if (date < activeFrom) { targets.set(it, { note: `A aula correspondente cairia em ${formatDateBR(date)}, antes da data da mudança.` }); return; }
      if (until && date >= until) { targets.set(it, { note: `A aula correspondente cairia em ${formatDateBR(date)}, já na versão seguinte da grade.` }); return; }
      const holiday = getHolidayName(getSafeDate(date));
      if (holiday) { targets.set(it, { note: `A aula correspondente cairia em ${formatDateBR(date)}, feriado (${holiday}).` }); return; }
      if (isLessonBlocked(data, date, schoolId, lesson.entry.shiftId, classKey)) {
        targets.set(it, { note: `A aula correspondente cairia em ${formatDateBR(date)}, dia sem aula (recesso ou evento).` });
        return;
      }
      targets.set(it, { date, lesson });
    });

    // 2º passo: nunca dois itens no mesmo horário (os que ficam ocupam o seu lugar primeiro)
    const occupied = new Map<string, string>(); // destino → origem
    items.forEach(it => { if (targets.get(it) === 'same') occupied.set(it.origKey, it.origKey); });
    items
      .filter(it => typeof targets.get(it) === 'object' && 'lesson' in (targets.get(it) as object))
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(it => {
        const t = targets.get(it) as { date: string; lesson: Lesson };
        const destKey = `${t.date}|${t.lesson.entry.slotId}`;
        const owner = occupied.get(destKey);
        if (owner && owner !== it.origKey) {
          targets.set(it, { note: `Já há outro registro na aula correspondente (${formatDateBR(t.date)}).` });
          return;
        }
        occupied.set(destKey, it.origKey);
      });

    // Resultado: itens que mudam ou precisam de decisão
    items.forEach(it => {
      const t = targets.get(it)!;
      if (t === 'same') return;
      if (it.isEvent) plan.orphanEvents.push(it.item as SchoolEvent);
      else plan.orphans.push(it.item as LessonLog);
      if ('note' in t) {
        plan.notes[it.item.id] = t.note;
        plan.suggestions[it.item.id] = { logId: it.item.id, type: 'EXTRA' };
        return;
      }
      plan.suggestions[it.item.id] = {
        logId: it.item.id,
        type: 'MOVE',
        targetDate: t.date,
        targetSlotId: t.lesson.entry.slotId,
        targetTime: { startTime: t.lesson.slot?.startTime || '', endTime: t.lesson.slot?.endTime || '' },
        targetSlot: t.lesson.entry
      };
    });
  });

  plan.orphans.sort((a, b) => a.date.localeCompare(b.date));
  plan.orphanEvents.sort((a, b) => a.date.localeCompare(b.date));
  return plan;
};

/** Início da versão seguinte à que começa em `activeFrom` (onde a análise para). */
export const nextVersionStart = (data: AppData, activeFrom: string, ignoreId?: string) =>
  (data.scheduleVersions || [])
    .filter(v => v.id !== ignoreId && v.activeFrom > activeFrom)
    .map(v => v.activeFrom)
    .sort()[0];

/**
 * Aplica as decisões da janela "Ajustar Planejamento Futuro":
 * - MOVE: nova data e aula (registro e avaliação); com `daySlot`, outro horário do mesmo dia (o
 *   registro vira aula extra nesse horário);
 * - EXTRA: registro vira aula extra de verdade (o Diário mostra pelo tipo) na mesma data ou na
 *   escolhida; avaliação fica na data, no contraturno (sem aula), e o seu registro automático
 *   "Avaliação: X" sai do diário (o mesmo vale para avaliação levada a uma atividade fixa);
 * - DELETE: registro sai; avaliação sai de verdade, com as ligadas (REC, 2ª chamada), as notas e o
 *   registro "Avaliação:".
 * O registro "Avaliação: X" sem decisão própria acompanha a sua avaliação.
 */
export const applyScheduleDecisions = (
  data: Pick<AppData, 'logs' | 'events' | 'grades' | 'schools'>,
  plan: Pick<ScheduleChangePlan, 'orphans' | 'orphanEvents'>,
  decisions: ScheduleDecision[],
  newId: () => string = () => crypto.randomUUID()
) => {
  const decisionOf = new Map(decisions.map(d => [d.logId, d]));
  const movedLogIds = new Set(plan.orphans.map(l => l.id));
  const movedEventIds = new Set(plan.orphanEvents.map(e => e.id));
  let events = data.events || [];

  const eventAt = (l: LessonLog) => plan.orphanEvents.find(e =>
    day(e.date) === day(l.date) && e.schoolId === l.schoolId && e.slotId === l.slotId && (l.subject || '').startsWith('Avaliação:'));

  const deletedRoots = plan.orphanEvents.filter(e => decisionOf.get(e.id)?.type === 'DELETE');
  const deletedIds = new Set(deletedRoots.flatMap(e => [e.id, ...events.filter(x => (x as any).parentId === e.id).map(x => x.id)]));
  const deletedAll = events.filter(e => deletedIds.has(e.id));

  const logs = (data.logs || []).flatMap(log => {
    if (deletedAll.some(e => e.slotId && day(e.date) === day(log.date) && e.schoolId === log.schoolId &&
      e.slotId === log.slotId && (log.subject || '').startsWith('Avaliação:'))) return [];
    if (!movedLogIds.has(log.id)) return [log];
    const ev = eventAt(log);
    const own = decisionOf.get(log.id);
    const d = own || (ev ? decisionOf.get(ev.id) : undefined);
    if (!d) return [log];
    // Avaliação foi para o contraturno ou para uma atividade fixa: o registro automático sai do diário
    if (!own && ev && (d.type === 'EXTRA' || d.toActivity) &&
      (log.subject || '').trim() === `Avaliação: ${ev.title}` && !(log.homework || '').trim()) return [];
    if (d.type === 'DELETE') return [];
    if (d.type === 'MOVE' && d.targetDate && d.targetSlotId) {
      // Horário que não é da turma na grade nova: aula extra no horário real (como "Dar aula para uma turma neste dia")
      if (d.daySlot) {
        return [{ ...log, type: 'extra' as const, date: toSafeISO(d.targetDate), slotId: d.targetSlotId,
          startTime: d.targetTime?.startTime || log.startTime || '', endTime: d.targetTime?.endTime || log.endTime || '' }];
      }
      return [{ ...log, date: toSafeISO(d.targetDate), slotId: d.targetSlotId,
        startTime: d.targetTime?.startTime || log.startTime, endTime: d.targetTime?.endTime || log.endTime }];
    }
    const slot = data.schools.find(sc => sc.id === log.schoolId)?.shifts.flatMap(sh => sh.slots).find(sl => sl.id === log.slotId);
    return [{ ...log, type: 'extra' as const, date: toSafeISO(d.targetDate || log.date), slotId: newId(),
      startTime: log.startTime || slot?.startTime || '', endTime: log.endTime || slot?.endTime || '' }];
  });

  events = events.flatMap(event => {
    if (deletedIds.has(event.id)) return [];
    if (!movedEventIds.has(event.id)) return [event];
    const d = decisionOf.get(event.id);
    if (!d) return [event];
    if (d.type === 'MOVE' && d.targetDate && d.targetSlotId) return [{ ...event, date: toSafeISO(d.targetDate), slotId: d.targetSlotId }];
    const { slotId, ...rest } = event;
    return [{ ...rest, date: toSafeISO(d.targetDate || event.date) } as SchoolEvent];
  });

  const grades = (data.grades || []).filter(g => !deletedIds.has(g.assessmentId));
  return { logs, events, grades };
};
