import React, { useMemo, useState } from 'react';
import { Wrench, CheckCircle2, ArrowRight } from 'lucide-react';
import { AppData } from '../types';
import { resolveClass, SPECIAL_CLASS_REFS, looksLikeClassCode } from '../utils/classRefs';
import { getSchedulesForDate } from '../utils/schedule';
import { formatDateBR, getDayOfWeekFromDate } from '../utils';

interface ClassRefRepairProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
}

export interface BrokenClassRef {
  key: string;
  schoolId: string;
  ref: string;
  counts: { logs: number; events: number; rosters: number; schedules: number; other: number };
  firstDate?: string;
  lastDate?: string;
  suggestedClassId?: string;
}

const COLLECTIONS = ['logs', 'events', 'classRecords', 'customAssessments', 'gradingConfigs', 'reminders'] as const;

/**
 * Encontra registros cuja turma não corresponde a nenhuma turma cadastrada
 * (nem pelo código, nem pelo nome). São esses que apareciam como código nas planilhas.
 */
export const findBrokenClassRefs = (data: AppData): BrokenClassRef[] => {
  const groups = new Map<string, BrokenClassRef>();
  const suggestions = new Map<string, Map<string, number>>();

  const isBroken = (schoolId: string | undefined, ref: string | undefined) => {
    if (!schoolId || ref === undefined || ref === null) return false;
    const r = String(ref).trim();
    if (SPECIAL_CLASS_REFS.has(r)) return false;
    // Só escolas cadastradas: registros de escola apagada são outro problema
    if (!data.schools.some(s => s.id === schoolId)) return false;
    return !resolveClass(data, schoolId, r);
  };

  const touch = (schoolId: string, ref: string) => {
    const key = `${schoolId}::${ref}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, schoolId, ref, counts: { logs: 0, events: 0, rosters: 0, schedules: 0, other: 0 } };
      groups.set(key, g);
    }
    return g;
  };

  const trackDate = (g: BrokenClassRef, date?: string) => {
    if (!date) return;
    const d = date.split('T')[0];
    if (!g.firstDate || d < g.firstDate) g.firstDate = d;
    if (!g.lastDate || d > g.lastDate) g.lastDate = d;
  };

  (data.logs || []).forEach(l => {
    if (!l.schoolId || !isBroken(l.schoolId, l.classId)) return;
    const g = touch(l.schoolId, String(l.classId).trim());
    g.counts.logs++;
    trackDate(g, l.date);

    // Sugestão: qual turma a grade horária indicava para esse horário nesse dia?
    if (l.slotId && l.date) {
      const day = l.date.split('T')[0];
      const dow = getDayOfWeekFromDate(day);
      const entry = getSchedulesForDate(data, day).find(s =>
        s.schoolId === l.schoolId && s.slotId === l.slotId && Number(s.dayOfWeek) === dow
      );
      const target = entry ? resolveClass(data, l.schoolId, entry.classId) : null;
      if (target && typeof target.cls !== 'string') {
        const tally = suggestions.get(g.key) || new Map<string, number>();
        tally.set(target.cls.id, (tally.get(target.cls.id) || 0) + 1);
        suggestions.set(g.key, tally);
      }
    }
  });

  (data.events || []).forEach(e => {
    if (!e.classId || !isBroken(e.schoolId, e.classId)) return;
    const g = touch(e.schoolId, String(e.classId).trim());
    g.counts.events++;
    trackDate(g, e.date);
  });

  (data.classRecords || []).forEach(r => {
    if (!isBroken(r.schoolId, r.classId)) return;
    touch(r.schoolId, String(r.classId).trim()).counts.rosters++;
  });

  (data.scheduleVersions || []).forEach(v => (v.schedules || []).forEach(s => {
    if (!isBroken(s.schoolId, s.classId)) return;
    touch(s.schoolId, String(s.classId).trim()).counts.schedules++;
  }));

  [...(data.customAssessments || []), ...(data.gradingConfigs || []), ...(data.reminders || [])].forEach((item: any) => {
    if (!item.classId || !isBroken(item.schoolId, item.classId)) return;
    touch(item.schoolId, String(item.classId).trim()).counts.other++;
  });

  groups.forEach(g => {
    const tally = suggestions.get(g.key);
    if (tally) {
      g.suggestedClassId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  });

  return [...groups.values()].sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''));
};

/** Reatribui todas as referências (escola + turma inexistente) para a turma escolhida. */
export const reassignClassRef = (data: AppData, schoolId: string, ref: string, targetClassId: string): Partial<AppData> => {
  const swap = <T extends { schoolId?: string; classId?: string }>(item: T): T =>
    item.schoolId === schoolId && item.classId !== undefined && String(item.classId).trim() === ref
      ? { ...item, classId: targetClassId }
      : item;

  const updates: Partial<AppData> = {};
  COLLECTIONS.forEach(c => {
    if (c === 'classRecords') return;
    (updates as any)[c] = ((data as any)[c] || []).map(swap);
  });

  // Listas de alunos: se a turma de destino já tem lista, junta os alunos em vez de duplicar a lista
  const records = data.classRecords || [];
  const orphanRecords = records.filter(r => r.schoolId === schoolId && String(r.classId).trim() === ref);
  const targetRecord = records.find(r => r.schoolId === schoolId && r.classId === targetClassId);
  if (orphanRecords.length > 0 && targetRecord) {
    const known = new Set(targetRecord.students.map(s => s.id));
    const extra = orphanRecords.flatMap(r => r.students).filter(s => !known.has(s.id) && (known.add(s.id), true));
    updates.classRecords = records
      .filter(r => !orphanRecords.includes(r))
      .map(r => r === targetRecord ? { ...r, students: [...r.students, ...extra] } : r);
  } else {
    updates.classRecords = records.map(swap);
  }

  updates.scheduleVersions = (data.scheduleVersions || []).map(v => ({ ...v, schedules: (v.schedules || []).map(swap) }));
  updates.schedules = (data.schedules || []).map(swap);
  return updates;
};

const ClassRefRepair: React.FC<ClassRefRepairProps> = ({ data, onUpdateData }) => {
  const broken = useMemo(() => findBrokenClassRefs(data), [data]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);

  const describe = (g: BrokenClassRef) => {
    const parts: string[] = [];
    if (g.counts.logs) parts.push(`${g.counts.logs} aula(s)`);
    if (g.counts.events) parts.push(`${g.counts.events} avaliação(ões)/evento(s)`);
    if (g.counts.rosters) parts.push('lista de alunos');
    if (g.counts.schedules) parts.push(`${g.counts.schedules} horário(s) da grade`);
    if (g.counts.other) parts.push(`${g.counts.other} outro(s)`);
    return parts.join(' • ');
  };

  return (
    <section className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
      <h3 className="text-[13px] font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2 mb-1">
        <Wrench className="text-primary" size={18} /> Turmas não encontradas
      </h3>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed mb-3">
        Registros que apontam para uma turma que não existe mais no cadastro (por exemplo, turma excluída e criada de novo).
        Eles apareciam como código nas planilhas. Escolha a turma correta para cada grupo.
      </p>

      {done && (
        <p className="text-[10px] font-black text-green-600 mb-3 flex items-center gap-1"><CheckCircle2 size={12} /> {done}</p>
      )}

      {broken.length === 0 ? (
        <p className="text-[10px] font-black text-green-600 flex items-center gap-1">
          <CheckCircle2 size={12} /> Nenhum registro com turma não encontrada.
        </p>
      ) : (
        <div className="space-y-3">
          {broken.map(g => {
            const school = data.schools.find(s => s.id === g.schoolId);
            const classes = (school?.classes || []).filter(c => typeof c !== 'string') as { id: string; name: string; deleted?: boolean }[];
            const selected = choices[g.key] ?? g.suggestedClassId ?? '';
            return (
              <div key={g.key} className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-900/10">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                  <span className="text-[11px] font-black text-slate-800 dark:text-white">
                    {school?.name || 'Escola'} — {looksLikeClassCode(g.ref) ? `código ${g.ref.slice(0, 8)}…` : `"${g.ref}"`}
                  </span>
                  {g.firstDate && (
                    <span className="text-[10px] font-bold text-slate-500">
                      {formatDateBR(g.firstDate)}{g.lastDate && g.lastDate !== g.firstDate ? ` a ${formatDateBR(g.lastDate)}` : ''}
                    </span>
                  )}
                </div>
                <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 mb-2">{describe(g)}</p>
                <div className="flex gap-2 items-center">
                  <select
                    value={selected}
                    onChange={e => setChoices(prev => ({ ...prev, [g.key]: e.target.value }))}
                    className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-2 text-xs font-bold dark:text-white"
                  >
                    <option value="">Escolha a turma…</option>
                    {classes.filter(c => !c.deleted).map(c => (
                      <option key={c.id} value={c.id}>{c.name}{c.id === g.suggestedClassId ? ' (sugerida pela grade)' : ''}</option>
                    ))}
                    {classes.some(c => c.deleted) && (
                      <optgroup label="Turmas excluídas">
                        {classes.filter(c => c.deleted).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </optgroup>
                    )}
                  </select>
                  <button
                    disabled={!selected}
                    onClick={() => {
                      const target = classes.find(c => c.id === selected);
                      if (!target) return;
                      if (!confirm(`Reatribuir ${describe(g)} para a turma "${target.name}"?`)) return;
                      onUpdateData(reassignClassRef(data, g.schoolId, g.ref, target.id));
                      setDone(`Registros reatribuídos para ${target.name}.`);
                    }}
                    className="shrink-0 px-3 py-2 bg-primary text-white rounded-lg text-[10px] font-black uppercase tracking-tight disabled:opacity-40 flex items-center gap-1"
                  >
                    Reatribuir <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default ClassRefRepair;
