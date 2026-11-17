import { AppData, LessonLog, SchoolEvent } from '../types';
import { getClassName } from './classRefs';
import { byDate } from './exportRows';

/**
 * Consulta de um ano anterior (Ajustes → Anos anteriores): só leitura, sobre os dados arquivados.
 */

export interface ArchiveFilter {
  schoolId?: string;
  /** Nome da turma (no arquivo a mesma turma pode aparecer por código ou por nome) */
  className?: string;
  search?: string;
}

const norm = (s: string | undefined) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const fits = (data: AppData, f: ArchiveFilter, schoolId: string | undefined, classId: string | undefined, texts: (string | undefined)[]) => {
  if (f.schoolId && schoolId !== f.schoolId) return false;
  if (f.className && getClassName(data, schoolId, classId) !== f.className) return false;
  const q = norm(f.search).trim();
  return !q || texts.some(t => norm(t).includes(q));
};

/** Aulas de escola registradas no ano (sem as removidas, janelas e aulas particulares), da mais antiga para a mais nova. */
export const archivedLessons = (data: AppData, f: ArchiveFilter = {}): LessonLog[] =>
  (data.logs || [])
    .filter(l => l.status !== 'removed' && l.classId !== 'window' && !l.studentId)
    .filter(l => fits(data, f, l.schoolId, l.classId, [l.subject, l.homework, l.notes, l.substitutionSubject]))
    .sort(byDate);

/** Provas e trabalhos do ano. */
export const archivedAssessments = (data: AppData, f: ArchiveFilter = {}): SchoolEvent[] =>
  (data.events || [])
    .filter(e => e.type === 'test' || e.type === 'work')
    .filter(e => fits(data, f, e.schoolId, e.classId, [e.title, e.description]))
    .sort(byDate);

/** Turmas (pelo nome) que têm algum registro no arquivo, por escola. */
export const archivedClassNames = (data: AppData, schoolId?: string): string[] => {
  const names = new Set<string>();
  const add = (sid: string | undefined, cid: string | undefined) => {
    if ((schoolId && sid !== schoolId) || !cid || cid === 'window') return;
    names.add(getClassName(data, sid, cid));
  };
  (data.logs || []).forEach(l => { if (!l.studentId && l.status !== 'removed') add(l.schoolId, l.classId); });
  (data.events || []).forEach(e => { if (e.type === 'test' || e.type === 'work') add(e.schoolId, e.classId); });
  return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
};

export const assessmentLabel = (e: SchoolEvent) => {
  const kind = e.kind === 'recovery' || e.kind === 'term_recovery' ? 'Recuperação' : e.kind === 'second_call' ? '2ª chamada' : e.type === 'test' ? 'Prova' : 'Trabalho';
  return kind;
};
