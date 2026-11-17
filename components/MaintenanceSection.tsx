import React, { useMemo, useState } from 'react';
import { ChevronDown, CheckCircle2, ShieldCheck, Trash2, Wrench } from 'lucide-react';
import { AppData } from '../types';
import { askConfirm, notifySuccess } from '../utils/dialogs';

interface MaintenanceSectionProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
  /** "Excluir todos os dados" (pede confirmação digitada) */
  onHardReset: () => void;
}

/** Aulas cuja escola ou aluno particular não existe mais (aula de turma excluída é histórico e fica). */
export const findOrphanLogs = (data: Pick<AppData, 'logs' | 'schools' | 'students'>) =>
  (data.logs || []).filter(log => {
    if (!log.schoolId && !log.studentId) return false;
    return log.schoolId
      ? !data.schools.some(s => s.id === log.schoolId)
      : !(data.students || []).some(s => s.id === log.studentId);
  });

/**
 * Ajustes → Manutenção: ferramentas raras, recolhidas por padrão.
 * (O quadro "Turmas não encontradas" aparece sozinho, fora daqui, só quando há algo para corrigir.)
 */
const MaintenanceSection: React.FC<MaintenanceSectionProps> = ({ data, onUpdateData, onHardReset }) => {
  const [open, setOpen] = useState(false);
  const orphans = useMemo(() => (open ? findOrphanLogs(data) : []), [open, data]);

  const removeOrphans = async () => {
    const ok = await askConfirm({
      title: 'Remover registros órfãos',
      message: `Encontramos ${orphans.length} registro(s) de aula de escolas ou alunos particulares que não existem mais.\n\nRecomendado: faça um backup antes.\nDeseja remover esses registros agora?`,
      confirmLabel: 'Remover',
      danger: true
    });
    if (!ok) return;
    const ids = new Set(orphans.map(l => l.id));
    onUpdateData({ logs: data.logs.filter(l => !ids.has(l.id)) });
    notifySuccess(`Limpeza concluída! ${ids.size} registro(s) removido(s).`);
  };

  return (
    <section className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full p-4 md:p-5 flex items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="text-[13px] font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2">
            <Wrench className="text-slate-400" size={18} /> Manutenção
          </span>
          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">Limpeza de registros e exclusão de todos os dados. Raramente necessário.</span>
        </span>
        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 md:px-5 pb-4 md:pb-5 space-y-4">
          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
            <h4 className="text-xs font-black uppercase dark:text-white mb-1">Registros órfãos</h4>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed mb-2">
              Aulas que apontam para escolas ou alunos particulares que não existem mais. Aulas de turmas excluídas são mantidas como histórico.
            </p>
            {orphans.length === 0 ? (
              <p className="text-xs font-black text-green-600 flex items-center gap-1.5"><CheckCircle2 size={14} /> Nenhum registro órfão.</p>
            ) : (
              <button
                onClick={removeOrphans}
                className="w-full py-2.5 bg-white dark:bg-slate-800 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 rounded-lg font-black uppercase text-xs tracking-tight flex items-center justify-center gap-2"
              >
                <ShieldCheck size={16} /> Remover {orphans.length} registro(s) órfão(s)
              </button>
            )}
          </div>

          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30">
            <h4 className="text-xs font-black uppercase text-red-700 dark:text-red-400 mb-1">Excluir todos os dados</h4>
            <p className="text-xs font-medium text-red-600 dark:text-red-300 leading-relaxed mb-2">
              Apaga escolas, turmas, alunos, diários e avaliações em todos os seus aparelhos e volta o app ao estado inicial.
              Será preciso digitar APAGAR TUDO para confirmar.
            </p>
            <button
              onClick={onHardReset}
              className="w-full py-2.5 bg-white dark:bg-slate-800 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-300 rounded-lg font-black uppercase text-xs tracking-tight flex items-center justify-center gap-2"
            >
              <Trash2 size={16} /> Excluir todos os dados
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default MaintenanceSection;
