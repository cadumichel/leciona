import { AcademicCalendar, AppData, School, SchoolClass, ScheduleEntry, Term } from '../types';
import { SyncedData } from './sync';
import { getScheduleVersion } from './schedule';

/**
 * Virada do ano letivo.
 *
 * O app guarda um ano letivo por vez: o ano anterior é arquivado (backup .json + planilhas)
 * e o novo ano começa só com a estrutura que se repete (escolas, turnos, turmas, grade como
 * rascunho). Isso mantém os dados bem abaixo do limite de 1 MB da nuvem.
 */

export interface ClassPlan {
  id: string;
  keep: boolean;
  name: string; // nome no novo ano (permite renomear)
}

export interface SchoolPlan {
  schoolId: string;
  keep: boolean;
  classes: ClassPlan[];
  calendar: {
    start: string;
    end: string;
    division: AcademicCalendar['division'];
    terms: Term[];
    midYearBreak: { start: string; end: string };
  };
}

export interface NewYearPlan {
  year: number;
  schools: SchoolPlan[];
  keepSchedule: boolean;
}

const classObj = (c: SchoolClass | string): SchoolClass =>
  typeof c === 'string' ? { id: c, name: c } : c;

/** Mesma data no ano seguinte (29/02 vira 28/02 quando o ano não é bissexto). */
export const shiftDateToYear = (dateStr: string | undefined, year: number): string => {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('T')[0].split('-').map(Number);
  if (!m || !d) return '';
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/** Divide o período em partes iguais (bimestres = 4, trimestres = 3). */
export const splitTerms = (start: string, end: string, division: AcademicCalendar['division']): Term[] => {
  const count = division === 'bimestres' ? 4 : 3;
  const label = division === 'bimestres' ? 'Bimestre' : 'Trimestre';
  const s = new Date(start + 'T12:00:00').getTime();
  const e = new Date(end + 'T12:00:00').getTime();
  if (!start || !end || isNaN(s) || isNaN(e) || e <= s) return [];
  const day = 24 * 60 * 60 * 1000;
  const totalDays = Math.round((e - s) / day) + 1;
  const terms: Term[] = [];
  for (let i = 0; i < count; i++) {
    const from = new Date(s + Math.round((i * totalDays) / count) * day);
    const to = new Date(s + (Math.round(((i + 1) * totalDays) / count) - 1) * day);
    terms.push({
      name: `${i + 1}º ${label}`,
      start: from.toLocaleDateString('en-CA'),
      end: to.toLocaleDateString('en-CA')
    });
  }
  return terms;
};

/** Ano sugerido para a virada: o seguinte ao último calendário cadastrado. */
export const suggestNextYear = (data: AppData, today: Date = new Date()): number => {
  const years = (data.calendars || []).map(c => Number(c.year)).filter(y => !isNaN(y) && y > 2000);
  if (years.length > 0) return Math.max(...years) + 1;
  return today.getMonth() >= 6 ? today.getFullYear() + 1 : today.getFullYear();
};

/** Calendário sugerido: as datas do ano anterior levadas para o novo ano (o professor ajusta). */
export const suggestCalendar = (data: AppData, schoolId: string, year: number): SchoolPlan['calendar'] => {
  const prev = (data.calendars || [])
    .filter(c => c.schoolId === schoolId)
    .sort((a, b) => Number(b.year) - Number(a.year))[0];
  if (!prev) {
    const start = `${year}-02-01`;
    const end = `${year}-12-10`;
    return { start, end, division: 'trimestres', terms: splitTerms(start, end, 'trimestres'), midYearBreak: { start: `${year}-07-15`, end: `${year}-07-31` } };
  }
  const division = prev.division === 'personalizado' ? 'trimestres' : prev.division;
  const start = shiftDateToYear(prev.start, year);
  const end = shiftDateToYear(prev.end, year);
  const terms = prev.terms && prev.terms.length > 0
    ? prev.terms.map(t => ({ name: t.name, start: shiftDateToYear(t.start, year), end: shiftDateToYear(t.end, year) }))
    : splitTerms(start, end, division);
  return {
    start,
    end,
    division: prev.division || division,
    terms,
    midYearBreak: {
      start: shiftDateToYear(prev.midYearBreak?.start, year),
      end: shiftDateToYear(prev.midYearBreak?.end, year)
    }
  };
};

/** Plano inicial do assistente: mantém escolas ativas e todas as turmas ativas, com o mesmo nome. */
export const defaultPlan = (data: AppData, year: number = suggestNextYear(data)): NewYearPlan => ({
  year,
  keepSchedule: true,
  schools: (data.schools || []).filter(s => !s.deleted).map(s => ({
    schoolId: s.id,
    keep: true,
    classes: (s.classes || []).map(classObj).filter(c => !c.deleted).map(c => ({ id: c.id, keep: true, name: c.name })),
    calendar: suggestCalendar(data, s.id, year)
  }))
});

/** Atualiza o ano do plano, recalculando as datas sugeridas dos calendários. */
export const withYear = (data: AppData, plan: NewYearPlan, year: number): NewYearPlan => ({
  ...plan,
  year,
  schools: plan.schools.map(sp => ({ ...sp, calendar: suggestCalendar(data, sp.schoolId, year) }))
});

/** Quantos registros do ano atual serão arquivados (para mostrar no assistente). */
export const summarizeCurrentYear = (data: AppData) => ({
  logs: (data.logs || []).filter(l => l.status !== 'removed').length,
  events: (data.events || []).length,
  grades: (data.grades || []).length,
  rosters: (data.classRecords || []).reduce((n, r) => n + (r.students?.length || 0), 0),
  reminders: (data.reminders || []).length
});

/**
 * Monta os dados do novo ano a partir do plano.
 * Mantém: perfil, configurações, escolas e turnos escolhidos, turmas escolhidas (com o novo nome),
 * alunos particulares (sem o histórico de pagamentos), grade horária como rascunho e lembretes
 * já marcados para o novo ano.
 * Começa do zero: aulas, avaliações e eventos, notas, listas de alunos, lembretes antigos.
 */
export const buildNewSchoolYear = (data: SyncedData, plan: NewYearPlan, now: Date = new Date()): SyncedData => {
  const year = plan.year;
  const yearStart = `${year}-01-01`;
  const keptPlans = plan.schools.filter(sp => sp.keep);
  const planBySchool = new Map(keptPlans.map(sp => [sp.schoolId, sp]));

  // Escolas e turmas que seguem (com renomeação)
  const renamedBySchool = new Map<string, Map<string, string>>(); // nome antigo → nome novo
  const keptClassIdsBySchool = new Map<string, Set<string>>();
  const schools: School[] = (data.schools || [])
    .filter(s => !s.deleted && planBySchool.has(s.id))
    .map(s => {
      const sp = planBySchool.get(s.id)!;
      const planById = new Map(sp.classes.map(c => [c.id, c]));
      const renames = new Map<string, string>();
      const keptIds = new Set<string>();
      const classes: SchoolClass[] = (s.classes || []).map(classObj)
        .filter(c => !c.deleted && planById.get(c.id)?.keep)
        .map(c => {
          const newName = (planById.get(c.id)!.name || c.name).trim() || c.name;
          if (newName !== c.name) renames.set(c.name, newName);
          keptIds.add(c.id);
          const { deleted, deletedAt, ...rest } = c;
          return { ...rest, name: newName };
        });
      renamedBySchool.set(s.id, renames);
      keptClassIdsBySchool.set(s.id, keptIds);
      return { ...s, classes };
    });

  // Grade horária: a versão em vigor no fim do ano vira um rascunho do novo ano
  let scheduleVersions: SyncedData['scheduleVersions'] = [];
  if (plan.keepSchedule) {
    const current = getScheduleVersion(data, now.toLocaleDateString('en-CA'));
    const entries = (current?.schedules || data.schedules || []).flatMap((e: ScheduleEntry) => {
      if (!planBySchool.has(e.schoolId)) return [];
      if (!e.classId || e.classId === 'window') return [e];
      const school = schools.find(s => s.id === e.schoolId)!;
      const keptIds = keptClassIdsBySchool.get(e.schoolId)!;
      const renames = renamedBySchool.get(e.schoolId)!;
      // A grade guarda o nome da turma; aceita também o código
      if (keptIds.has(e.classId)) return [e];
      const newName = renames.get(e.classId) ?? e.classId;
      const exists = school.classes.some(c => typeof c !== 'string' && c.name === newName);
      return exists ? [{ ...e, classId: newName }] : [];
    });
    if (entries.length > 0) {
      scheduleVersions = [{
        id: crypto.randomUUID(),
        activeFrom: yearStart,
        createdAt: now.toISOString(),
        name: `Grade ${year}`,
        schedules: entries
      }];
    }
  }

  const calendars: AcademicCalendar[] = keptPlans.map(sp => ({
    id: crypto.randomUUID(),
    schoolId: sp.schoolId,
    year,
    division: sp.calendar.division,
    start: sp.calendar.start,
    end: sp.calendar.end,
    terms: sp.calendar.terms,
    midYearBreak: sp.calendar.midYearBreak,
    extraRecesses: []
  }));

  const result: SyncedData = {
    profile: data.profile,
    settings: { ...data.settings, showQuickStartGuide: false },
    schools,
    students: (data.students || []).map(st => ({ ...st, payments: [] })),
    classRecords: [],
    schedules: [],
    scheduleVersions,
    logs: [],
    events: [],
    calendars,
    reminders: (data.reminders || []).filter(r => (r.date || '').split('T')[0] >= yearStart),
    grades: [],
    customAssessments: [],
    gradingConfigs: [],
    _schoolYear: year,
    _yearResetAt: now.toISOString()
  } as SyncedData;
  if (data._wipedAt) result._wipedAt = data._wipedAt;
  return result;
};
