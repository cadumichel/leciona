import { AppData, SchoolEvent } from '../types';
import { parseTimeToMinutes } from '../utils';
import { canonicalClassId, getClassName } from './classRefs';
import { getLessonDisplayItems } from './lessonStats';

/**
 * Aviso para marcar a avaliação com a turma com 1 semana de antecedência (regra das escolas).
 *
 * - Prazo = 7 dias antes da avaliação.
 * - Aula-limite = a última aula real da turma até o prazo (sem feriados, recessos e eventos que
 *   suspendem aula: mesma regra do Diário). Se a aula do prazo cair num feriado, a aula-limite é a
 *   anterior, e o aviso vem antes.
 * - O aviso aparece a partir de 7 dias antes da aula-limite e some quando a avaliação fica Agendada
 *   (comunicada) ou Pronta.
 * - Sem aula da turma até o prazo (ou prazo já passado) = "fora do prazo".
 * Vale para provas e trabalhos (também REC); a 2ª chamada fica de fora.
 */

export const NOTICE_DAYS = 7;

export type ScheduleNoticeStatus = 'soon' | 'last' | 'late';

export interface ScheduleNotice {
  event: SchoolEvent;
  className: string;
  /** 7 dias antes da avaliação */
  deadline: string;
  /** Última aula da turma até o prazo (sem valor quando já está fora do prazo) */
  limitDate?: string;
  limitSlotId?: string;
  /** Aulas da turma de hoje até o prazo */
  lessonsLeft: number;
  status: ScheduleNoticeStatus;
}

const day = (d: string) => String(d || '').split('T')[0];
const addDays = (dateStr: string, n: number) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

export const needsScheduling = (e: SchoolEvent) =>
  (e.type === 'test' || e.type === 'work') && e.kind !== 'second_call' && !e.scheduled && !e.prepared && !!e.classId;

/** Avaliações que ainda precisam ser marcadas com a turma, vistas a partir de `today`. */
export const scheduleNotices = (data: AppData, today: string, onlySchoolId?: string, onlyClassId?: string): ScheduleNotice[] => {
  const candidates = (data.events || []).filter(e => needsScheduling(e) && day(e.date) >= today &&
    (!onlySchoolId || e.schoolId === onlySchoolId) &&
    (data.schools || []).some(s => s.id === e.schoolId && !s.deleted));
  if (!candidates.length) return [];

  const classKey = (e: SchoolEvent) => canonicalClassId(data, e.schoolId, e.classId);
  const onlyKey = onlyClassId && onlySchoolId ? canonicalClassId(data, onlySchoolId, onlyClassId) : undefined;
  const filtered = onlyKey ? candidates.filter(e => classKey(e) === onlyKey) : candidates;

  // Aulas de cada escola de hoje até o maior prazo (uma consulta por escola)
  const lessonsBySchool = new Map<string, { date: string; slotId: string; start: number; classKey: string }[]>();
  [...new Set(filtered.map(e => e.schoolId))].forEach(schoolId => {
    const maxDeadline = filtered.filter(e => e.schoolId === schoolId).map(e => addDays(day(e.date), -NOTICE_DAYS)).sort().pop()!;
    if (maxDeadline < today) { lessonsBySchool.set(schoolId, []); return; }
    lessonsBySchool.set(schoolId, getLessonDisplayItems(data, { start: today, end: maxDeadline, schoolId, classId: 'all' })
      .filter(item => item.institution.id === schoolId && item.schedule.classId !== 'window')
      .map(item => ({
        date: item.date, slotId: item.schedule.slotId, start: parseTimeToMinutes(item.slot.startTime || '00:00'),
        classKey: canonicalClassId(data, schoolId, item.schedule.classId)
      })));
  });

  const notices: ScheduleNotice[] = [];
  filtered.forEach(event => {
    const deadline = addDays(day(event.date), -NOTICE_DAYS);
    const key = classKey(event);
    const lessons = (lessonsBySchool.get(event.schoolId) || [])
      .filter(l => l.classKey === key && l.date <= deadline)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    const className = getClassName(data, event.schoolId, event.classId);
    if (deadline < today || lessons.length === 0) {
      notices.push({ event, className, deadline, lessonsLeft: 0, status: 'late' });
      return;
    }
    const limit = lessons[lessons.length - 1];
    if (today < addDays(limit.date, -NOTICE_DAYS)) return;
    notices.push({
      event, className, deadline, limitDate: limit.date, limitSlotId: limit.slotId, lessonsLeft: lessons.length,
      status: limit.date === today ? 'last' : 'soon'
    });
  });

  const rank: Record<ScheduleNoticeStatus, number> = { late: 0, last: 1, soon: 2 };
  return notices.sort((a, b) => rank[a.status] - rank[b.status] || day(a.event.date).localeCompare(day(b.event.date)));
};

/** Texto curto do aviso ("Prova X (183) em 20/11: marque até 13/11"). */
export const scheduleNoticeText = (n: ScheduleNotice): string => {
  const kind = n.event.type === 'test' ? 'Prova' : 'Trabalho';
  const fmt = (d: string) => d.split('-').reverse().slice(0, 2).join('/');
  const base = `${kind} ${n.event.title} (${n.className}) em ${fmt(day(n.event.date))}`;
  if (n.status === 'late') return `${base}: fora do prazo de 1 semana`;
  if (n.status === 'last') return `${base}: hoje é a última aula para marcar`;
  return `${base}: marque até ${fmt(n.limitDate!)}`;
};

/** Texto curtíssimo para a etiqueta do Início ("181 · último dia hoje · P4"). */
export const scheduleNoticeShort = (n: ScheduleNotice): string => {
  const fmt = (d: string) => d.split('-').reverse().slice(0, 2).join('/');
  const when = n.status === 'late' ? 'fora do prazo' : n.status === 'last' ? 'último dia hoje' : `até ${fmt(n.limitDate!)}`;
  return `${n.className} · ${when} · ${n.event.title}`;
};
