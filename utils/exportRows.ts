import { AppData, LessonLog, SchoolEvent } from '../types';
import { formatDateBR, isHoliday, getSafeDate } from '../utils';
import { getClassName } from './classRefs';
import { getSchedulesForDate } from './schedule';
import { getCalendarBlockReason, getCancellingEvent, isAutoEventLog } from './lessonStats';

/** Linha de aula cancelada por evento sem registro no diário (só existe na exportação). */
export type CancelledLessonLog = LessonLog & { cancelledBy: string };

const AUTO_EVENT_PREFIX = 'Evento: ';

/** Evento que cancelou a aula do registro: o da linha sem registro ou o do registro automático "Evento: X". */
export const cancelReasonOf = (log: LessonLog | CancelledLessonLog): string | null => {
  if ('cancelledBy' in log && log.cancelledBy) return log.cancelledBy;
  return isAutoEventLog(log) ? log.subject.slice(AUTO_EVENT_PREFIX.length) : null;
};

/**
 * Aulas da grade canceladas por evento que não têm registro no diário (por exemplo, evento cadastrado antes da
 * grade, ou registro automático apagado). Recessos e feriados ficam de fora. Servem para a exportação mostrar
 * todas as aulas canceladas, não só as que ganharam o registro "Evento: X".
 */
export const cancelledLessonsWithoutLog = (data: AppData): CancelledLessonLog[] => {
  const rows: CancelledLessonLog[] = [];
  const seen = new Set<string>();
  (data.events || []).filter(e => e.blocksClasses && e.date).forEach(event => {
    const dateStr = event.date.split('T')[0];
    if (isHoliday(getSafeDate(dateStr)) || getCalendarBlockReason(data, dateStr, event.schoolId)) return;
    const school = data.schools.find(s => s.id === event.schoolId);
    if (!school || school.deleted) return;
    const calendars = (data.calendars || []).filter(c => c.schoolId === school.id);
    if (calendars.length > 0 && !calendars.some(c => dateStr >= c.start && dateStr <= c.end)) return;
    const dayOfWeek = new Date(dateStr + 'T00:00:00').getDay();
    getSchedulesForDate(data, dateStr).forEach(s => {
      if (s.schoolId !== school.id || Number(s.dayOfWeek) !== dayOfWeek || s.classId === 'window') return;
      if (getCancellingEvent(data, dateStr, s.schoolId, s.shiftId, s.classId)?.id !== event.id) return;
      const key = `${dateStr}|${s.schoolId}|${s.slotId}`;
      if (seen.has(key)) return;
      seen.add(key);
      if ((data.logs || []).some(l => l.schoolId === s.schoolId && l.date.startsWith(dateStr) && l.slotId === s.slotId)) return;
      rows.push({
        id: `cancelada-${key}`, date: event.date, schoolId: s.schoolId, classId: s.classId, slotId: s.slotId,
        subject: '', homework: '', notes: '',
        cancelledBy: event.title
      });
    });
  });
  return rows;
};

/** Linhas da planilha de diários (mesmas colunas em Ajustes → Exportar e no arquivo do ano). */
export const buildLogRows = (data: AppData, logs: (LessonLog | CancelledLessonLog)[]) => {
  const institutionName = (id?: string) =>
    data.schools.find(s => s.id === id)?.name ||
    (data.students.find(st => st.id === id) ? `${data.students.find(st => st.id === id)!.name} (Particular)` : 'N/A');

  return logs.map(l => {
    const cancelled = cancelReasonOf(l);
    return {
    Data: formatDateBR(l.date),
    Instituicao: institutionName(l.schoolId || l.studentId),
    Turma: getClassName(data, l.schoolId, l.classId),
    Turno: data.schools.find(s => s.id === l.schoolId)?.shifts.find(sh => sh.slots.some(sl => sl.id === l.slotId))?.name || 'N/A',
    Horario: l.startTime ? `${l.startTime}-${l.endTime}` : 'Grade Normal',
    Situacao: cancelled ? `Aula cancelada: ${cancelled}` : '',
    Conteudo: cancelled && !l.subject ? `Evento: ${cancelled}` : l.subject,
    Tarefa: l.homework,
    Notas: l.notes
  };
  });
};

/** Linhas da planilha de avaliações. */
export const buildAssessmentRows = (data: AppData, events: SchoolEvent[]) =>
  events.map(e => ({
    Data: formatDateBR(e.date),
    Escola: data.schools.find(s => s.id === e.schoolId)?.name || 'N/A',
    Turma: getClassName(data, e.schoolId, e.classId),
    Tipo: e.type === 'test' ? 'Prova' : 'Trabalho',
    Titulo: e.title,
    Descricao: e.description
  }));

/** Ordem cronológica (para o arquivo do ano). */
export const byDate = <T extends { date: string }>(a: T, b: T) => (a.date || '').localeCompare(b.date || '');
