import { AppData, LessonLog, SchoolEvent } from '../types';
import { formatDateBR } from '../utils';
import { getClassName } from './classRefs';

/** Linhas da planilha de diários (mesmas colunas em Ajustes → Exportar e no arquivo do ano). */
export const buildLogRows = (data: AppData, logs: LessonLog[]) => {
  const institutionName = (id?: string) =>
    data.schools.find(s => s.id === id)?.name ||
    (data.students.find(st => st.id === id) ? `${data.students.find(st => st.id === id)!.name} (Particular)` : 'N/A');

  return logs.map(l => ({
    Data: formatDateBR(l.date),
    Instituicao: institutionName(l.schoolId || l.studentId),
    Turma: getClassName(data, l.schoolId, l.classId),
    Turno: data.schools.find(s => s.id === l.schoolId)?.shifts.find(sh => sh.slots.some(sl => sl.id === l.slotId))?.name || 'N/A',
    Horario: l.startTime ? `${l.startTime}-${l.endTime}` : 'Grade Normal',
    Conteudo: l.subject,
    Tarefa: l.homework,
    Notas: l.notes
  }));
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
