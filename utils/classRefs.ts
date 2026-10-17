import { AppData, School, SchoolClass } from '../types';

/**
 * Referências de turma no Leciona podem estar em dois formatos:
 * - o código interno da turma (SchoolClass.id), usado por aulas extras, avaliações, eventos e listas de alunos;
 * - o nome da turma, usado historicamente pela grade horária.
 * Estas funções aceitam qualquer um dos dois e devolvem sempre a mesma turma.
 */

type AnyClass = SchoolClass | string;

const idOf = (c: AnyClass) => (typeof c === 'string' ? c : c.id);
const nameOf = (c: AnyClass) => (typeof c === 'string' ? c : c.name);
const isDeleted = (c: AnyClass) => typeof c !== 'string' && !!c.deleted;

export const SPECIAL_CLASS_REFS = new Set(['', 'window']);

const findInSchool = (school: School | undefined, ref: string): AnyClass | undefined => {
  if (!school || !school.classes) return undefined;
  const classes = school.classes as AnyClass[];
  // 1. Código exato
  const byId = classes.find(c => String(idOf(c)).trim() === ref);
  if (byId) return byId;
  // 2. Nome: prefere a turma ativa quando houver turma excluída com o mesmo nome
  const byName = classes.filter(c => String(nameOf(c)).trim() === ref);
  return byName.find(c => !isDeleted(c)) || byName[0];
};

/** Encontra a turma referenciada (código ou nome), primeiro na escola indicada e depois em todas. */
export const resolveClass = (
  data: Pick<AppData, 'schools'>,
  schoolId: string | undefined,
  classRef: string | undefined | null
): { school: School; cls: AnyClass } | null => {
  if (classRef === undefined || classRef === null) return null;
  const ref = String(Array.isArray(classRef) ? classRef[0] : classRef).trim();
  if (SPECIAL_CLASS_REFS.has(ref)) return null;

  const schools = data.schools || [];
  if (schoolId) {
    const school = schools.find(s => s.id === schoolId);
    const cls = findInSchool(school, ref);
    if (school && cls) return { school, cls };
  }
  for (const school of schools) {
    const cls = findInSchool(school, ref);
    if (cls) return { school, cls };
  }
  return null;
};

/** Código canônico da turma (ou a própria referência, se a turma não for encontrada). */
export const canonicalClassId = (
  data: Pick<AppData, 'schools'>,
  schoolId: string | undefined,
  classRef: string | undefined | null
): string => {
  const found = resolveClass(data, schoolId, classRef);
  if (found) return String(idOf(found.cls));
  return classRef ? String(classRef).trim() : '';
};

/** Duas referências apontam para a mesma turma? */
export const isSameClassRef = (
  data: Pick<AppData, 'schools'>,
  schoolId: string | undefined,
  a: string | undefined | null,
  b: string | undefined | null
): boolean => {
  if (!a || !b) return false;
  if (a === b) return true;
  return canonicalClassId(data, schoolId, a) === canonicalClassId(data, schoolId, b);
};

/** Parece um código interno (UUID) e não um nome legível? */
export const looksLikeClassCode = (ref: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref.trim());

/**
 * Nome legível da turma. Se a turma não existir mais:
 * - referências por nome continuam mostrando o nome;
 * - referências por código mostram um aviso curto em vez do código.
 */
export const getClassName = (
  data: Pick<AppData, 'schools'>,
  schoolId: string | undefined,
  classRef: string | undefined | null,
  fallback = 'Geral'
): string => {
  if (!classRef || !String(classRef).trim()) return fallback;
  const found = resolveClass(data, schoolId, classRef);
  if (found) return String(nameOf(found.cls));
  const ref = String(classRef).trim();
  if (ref === 'window') return 'Janela';
  return looksLikeClassCode(ref) ? `Turma não encontrada (${ref.slice(0, 4)})` : ref;
};
