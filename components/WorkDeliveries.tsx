import React, { useMemo, useState } from 'react';
import { AppData, MissingDelivery, SchoolEvent, WorkGroup, WorkMember } from '../types';
import { CheckCircle2, PackageX, Plus, Trash2, Users, X } from 'lucide-react';
import { formatDateBR, todayLocal } from '../utils';
import { getClassName } from '../utils/classRefs';
import { classStudents } from '../utils/works';

const newId = () => crypto.randomUUID();
const fmt = (d: string) => formatDateBR(d).slice(0, 5);

// ─── Grupos do trabalho (formulário da avaliação) ────────────────────────────

interface WorkGroupsEditorProps {
  data: AppData;
  schoolId: string;
  classId: string;
  groups: WorkGroup[];
  onChange: (groups: WorkGroup[]) => void;
}

/** Grupos com alunos da lista da turma ou nomes digitados. Cadastrar grupos é opcional. */
export const WorkGroupsEditor: React.FC<WorkGroupsEditorProps> = ({ data, schoolId, classId, groups, onChange }) => {
  const students = useMemo(() => (classId ? classStudents(data, schoolId, classId) : []), [data, schoolId, classId]);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const used = new Set(groups.flatMap(g => g.members.map(m => m.studentId).filter(Boolean)));

  const update = (id: string, change: (g: WorkGroup) => WorkGroup) => onChange(groups.map(g => (g.id === id ? change(g) : g)));
  const addMember = (groupId: string, member: WorkMember) =>
    update(groupId, g => ({ ...g, members: [...g.members, member] }));

  return (
    <div className="space-y-2">
      {groups.map((group, index) => (
        <div key={group.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <input value={group.name} onChange={e => update(group.id, g => ({ ...g, name: e.target.value }))}
              className="flex-1 bg-slate-50 dark:bg-slate-800 border-none rounded-md px-2 py-1 text-xs font-black dark:text-white" placeholder={`Grupo ${index + 1}`} />
            <button type="button" onClick={() => onChange(groups.filter(g => g.id !== group.id))} className="p-1 text-slate-400 hover:text-red-500" title="Apagar grupo">
              <Trash2 size={13} />
            </button>
          </div>
          {group.members.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {group.members.map((m, i) => (
                <span key={`${m.studentId || m.name}-${i}`} className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded px-1.5 py-0.5 text-[11px] font-bold">
                  {m.name}
                  <button type="button" onClick={() => update(group.id, g => ({ ...g, members: g.members.filter((_, j) => j !== i) }))} className="text-slate-400 hover:text-red-500">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            {students.length > 0 && (
              <select value="" onChange={e => {
                const st = students.find(s => s.id === e.target.value);
                if (st) addMember(group.id, { studentId: st.id, name: st.name });
              }} className="flex-1 min-w-0 bg-slate-50 dark:bg-slate-800 border-none rounded-md px-2 py-1 text-[11px] font-bold dark:text-white">
                <option value="">+ Aluno da turma…</option>
                {students.filter(s => !used.has(s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <input value={typed[group.id] || ''} onChange={e => setTyped({ ...typed, [group.id]: e.target.value })}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const name = (typed[group.id] || '').trim();
                if (name) { addMember(group.id, { name }); setTyped({ ...typed, [group.id]: '' }); }
              }}
              className="flex-1 min-w-0 bg-slate-50 dark:bg-slate-800 border-none rounded-md px-2 py-1 text-[11px] font-bold dark:text-white"
              placeholder="Digitar nome e Enter" />
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...groups, { id: newId(), name: `Grupo ${groups.length + 1}`, members: [] }])}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-[10px] font-black uppercase text-slate-500 hover:text-blue-600 hover:border-blue-400">
        <Plus size={12} /> Adicionar grupo
      </button>
      {groups.length === 0 && (
        <p className="text-[10px] font-bold text-slate-400 ml-1">Opcional: dá para salvar como "em grupo" sem cadastrar os nomes.</p>
      )}
    </div>
  );
};

// ─── Registro de entrega ─────────────────────────────────────────────────────

interface WorkDeliveryModalProps {
  data: AppData;
  event: SchoolEvent;
  onUpdateData: (newData: Partial<AppData>) => void;
  onClose: () => void;
  /** Dia do registro (a aula aberta no Diário ou hoje) */
  date?: string;
}

interface Candidate { key: string; name: string; studentId?: string; groupId?: string; detail?: string }

/**
 * Quem não entregou o trabalho. Os pendentes aparecem nas aulas seguintes da turma até a entrega.
 * Lista: grupos cadastrados (trabalho em grupo) ou alunos da lista da turma; nomes digitados também valem.
 */
export const WorkDeliveryModal: React.FC<WorkDeliveryModalProps> = ({ data, event, onUpdateData, onClose, date }) => {
  const registerDay = date || todayLocal();
  const [missing, setMissing] = useState<MissingDelivery[]>(event.missingDeliveries || []);
  const [typed, setTyped] = useState('');

  const candidates = useMemo((): Candidate[] => {
    const groups = event.workFormat === 'group' ? (event.workGroups || []) : [];
    const list: Candidate[] = groups.length
      ? groups.map(g => ({ key: `g:${g.id}`, name: g.name, groupId: g.id, detail: g.members.map(m => m.name).join(', ') }))
      : classStudents(data, event.schoolId, event.classId || '').map(s => ({ key: `s:${s.id}`, name: s.name, studentId: s.id }));
    // Nomes digitados (ou de alunos que saíram da lista) continuam aparecendo
    missing.forEach(m => {
      if (!list.some(c => matches(c, m))) list.push({ key: `n:${m.id}`, name: m.name, studentId: m.studentId, groupId: m.groupId });
    });
    return list;
  }, [data, event, missing]);

  const findMissing = (c: Candidate) => missing.find(m => matches(c, m));

  const toggle = (c: Candidate) => {
    const current = findMissing(c);
    if (current && !current.deliveredAt) {
      // Marcado por engano hoje: tira; registrado antes: entregou agora (com atraso)
      if (current.registeredAt === registerDay) setMissing(missing.filter(m => m.id !== current.id));
      else setMissing(missing.map(m => (m.id === current.id ? { ...m, deliveredAt: registerDay } : m)));
    } else if (current && current.deliveredAt) {
      setMissing(missing.map(m => (m.id === current.id ? { ...m, deliveredAt: undefined } : m)));
    } else {
      setMissing([...missing, { id: newId(), name: c.name, ...(c.studentId ? { studentId: c.studentId } : {}), ...(c.groupId ? { groupId: c.groupId } : {}), registeredAt: registerDay }]);
    }
  };

  const addTyped = () => {
    const name = typed.trim();
    if (!name) return;
    setMissing([...missing, { id: newId(), name, registeredAt: registerDay }]);
    setTyped('');
  };

  const save = () => {
    const events = data.events.map(e => (e.id === event.id ? { ...e, missingDeliveries: missing } : e));
    onUpdateData({ events });
    onClose();
  };

  const pending = missing.filter(m => !m.deliveredAt).length;
  const className = getClassName(data, event.schoolId, event.classId);

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 w-full max-w-md shadow-2xl animate-in zoom-in-95 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-black uppercase flex items-center gap-2 dark:text-white"><PackageX size={16} className="text-red-500" /> Registro de entrega</h3>
            <p className="text-[11px] font-bold text-slate-500 truncate">{className} · {event.title} · entrega {fmt(event.date)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-full shrink-0"><X size={16} /></button>
        </div>

        <p className="text-[10px] font-bold text-slate-500 mb-2 shrink-0">
          Toque em quem <b>não entregou</b>. Quem ficar pendente aparece nas próximas aulas da turma até entregar.
        </p>

        <div className="overflow-y-auto flex-1 space-y-1 pr-1 custom-scrollbar">
          {candidates.length === 0 && (
            <p className="text-[11px] font-bold text-slate-400 py-3 text-center">
              A turma não tem lista de alunos{event.workFormat === 'group' ? ' nem grupos cadastrados' : ''}. Digite os nomes abaixo.
            </p>
          )}
          {candidates.map(c => {
            const m = findMissing(c);
            const state = !m ? 'ok' : m.deliveredAt ? 'late' : 'missing';
            return (
              <button key={c.key} type="button" onClick={() => toggle(c)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all ${state === 'missing'
                  ? 'bg-red-50 border-red-300 dark:bg-red-900/20 dark:border-red-800'
                  : state === 'late' ? 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800'
                    : 'bg-white border-slate-100 dark:bg-slate-900 dark:border-slate-800'}`}>
                {c.groupId ? <Users size={13} className="text-slate-400 shrink-0" /> : null}
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-black text-slate-700 dark:text-slate-200 truncate">{c.name}</span>
                  {c.detail && <span className="block text-[10px] font-bold text-slate-400 truncate">{c.detail}</span>}
                </span>
                <span className={`text-[10px] font-black uppercase shrink-0 ${state === 'missing' ? 'text-red-600' : state === 'late' ? 'text-amber-700' : 'text-slate-300'}`}>
                  {state === 'missing'
                    ? (m!.registeredAt < registerDay ? `Pendente desde ${fmt(m!.registeredAt)} · tocar = entregou` : 'Não entregou')
                    : state === 'late' ? `Entregou ${fmt(m!.deliveredAt!)} (atraso)` : 'Entregou'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 mt-3 shrink-0">
          <input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
            className="flex-1 min-w-0 bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold dark:text-white"
            placeholder="Outro nome que não entregou" />
          <button type="button" onClick={addTyped} disabled={!typed.trim()} className="px-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40">
            <Plus size={14} />
          </button>
        </div>

        <div className="flex gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 font-black text-slate-500 dark:text-slate-300 uppercase text-[11px]">Cancelar</button>
          <button onClick={save} className="flex-1 py-2.5 rounded-lg font-black uppercase text-[11px] bg-blue-600 text-white shadow-sm hover:brightness-110 flex items-center justify-center gap-1.5">
            <CheckCircle2 size={13} /> Salvar{pending ? ` (${pending} pendente${pending > 1 ? 's' : ''})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

const matches = (c: Candidate, m: MissingDelivery) =>
  (c.groupId && m.groupId === c.groupId) || (c.studentId && m.studentId === c.studentId) ||
  (c.key === `n:${m.id}`);

export default WorkDeliveryModal;
