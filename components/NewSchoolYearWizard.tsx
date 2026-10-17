import React, { useMemo, useState } from 'react';
import { X, Archive, FileDown, CheckCircle2, CalendarRange, School as SchoolIcon, ArrowRight, ArrowLeft, Sparkles, AlertTriangle } from 'lucide-react';
import { AppData } from '../types';
import { downloadCSV, formatDateBR } from '../utils';
import { buildLogRows, buildAssessmentRows, byDate } from '../utils/exportRows';
import { SyncedData } from '../utils/sync';
import {
  NewYearPlan, defaultPlan, withYear, splitTerms, summarizeCurrentYear, buildNewSchoolYear
} from '../utils/newSchoolYear';

interface NewSchoolYearWizardProps {
  data: AppData;
  onClose: () => void;
  /** Aplica o novo ano; devolve true se a nuvem já recebeu */
  onStartNewYear: (newYear: SyncedData) => Promise<boolean>;
}

const STEPS = ['Arquivar', 'O que segue', 'Calendário', 'Confirmar'];

const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs font-bold dark:text-white';
const labelCls = 'block text-[9px] font-black text-slate-400 uppercase mb-0.5 ml-1';

const NewSchoolYearWizard: React.FC<NewSchoolYearWizardProps> = ({ data, onClose, onStartNewYear }) => {
  const [step, setStep] = useState(0);
  const [plan, setPlan] = useState<NewYearPlan>(() => defaultPlan(data));
  const [downloaded, setDownloaded] = useState<{ json?: boolean; logs?: boolean; events?: boolean }>({});
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);
  const [finalConfirmed, setFinalConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<null | { synced: boolean }>(null);

  const currentYear = (data as SyncedData)._schoolYear || plan.year - 1;
  const counts = useMemo(() => summarizeCurrentYear(data), [data]);
  const schoolName = (id: string) => data.schools.find(s => s.id === id)?.name || 'Escola';
  const backupFileName = `leciona_arquivo_${currentYear}.json`;

  // ── Etapa 1: arquivos ────────────────────────────────────────────────────
  const downloadBackup = () => {
    const backup = {
      metadata: { version: '1.0', timestamp: new Date().toISOString(), app: 'LecionaApp', schoolYear: currentYear },
      data
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = backupFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setDownloaded(d => ({ ...d, json: true }));
  };

  const downloadLogs = () => {
    const logs = data.logs
      .filter(l => l.status !== 'removed' && l.classId !== 'window' && l.type !== 'substitution')
      .sort(byDate);
    downloadCSV(buildLogRows(data, logs), `leciona_diarios_${currentYear}`);
    setDownloaded(d => ({ ...d, logs: true }));
  };

  const downloadEvents = () => {
    const events = data.events.filter(e => ['test', 'work'].includes(e.type)).sort(byDate);
    downloadCSV(buildAssessmentRows(data, events), `leciona_avaliacoes_${currentYear}`);
    setDownloaded(d => ({ ...d, events: true }));
  };

  // ── Edição do plano ──────────────────────────────────────────────────────
  const updateSchool = (schoolId: string, change: (sp: NewYearPlan['schools'][number]) => NewYearPlan['schools'][number]) =>
    setPlan(p => ({ ...p, schools: p.schools.map(sp => (sp.schoolId === schoolId ? change(sp) : sp)) }));

  const keptSchools = plan.schools.filter(sp => sp.keep);

  const calendarProblems = keptSchools.flatMap(sp => {
    const c = sp.calendar;
    const name = schoolName(sp.schoolId);
    const issues: string[] = [];
    if (!c.start || !c.end || c.start >= c.end) issues.push(`${name}: confira o início e o fim do ano letivo.`);
    if (c.start && !c.start.startsWith(String(plan.year))) issues.push(`${name}: o início não está em ${plan.year}.`);
    if (c.terms.some(t => !t.start || !t.end || t.start > t.end)) issues.push(`${name}: confira as datas dos períodos.`);
    return issues;
  });

  const canAdvance = [
    !!downloaded.json && archiveConfirmed,
    keptSchools.length > 0 && keptSchools.every(sp => sp.classes.some(c => c.keep && c.name.trim())),
    calendarProblems.length === 0,
    finalConfirmed && !running
  ][step];

  const handleStart = async () => {
    setRunning(true);
    try {
      const newYear = buildNewSchoolYear(data as SyncedData, plan);
      const synced = await onStartNewYear(newYear);
      setResult({ synced });
    } finally {
      setRunning(false);
    }
  };

  // ── Telas ────────────────────────────────────────────────────────────────
  const fileButton = (label: string, done: boolean | undefined, onClick: () => void, required = false) => (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 p-3 rounded-lg border-2 text-left transition-all ${done ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-primary'}`}
    >
      <span className="flex items-center gap-2 text-xs font-black text-slate-700 dark:text-white">
        <FileDown size={16} className={done ? 'text-emerald-600' : 'text-primary'} /> {label}
        {required && <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase">obrigatório</span>}
      </span>
      {done && <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />}
    </button>
  );

  const renderStep = () => {
    if (step === 0) return (
      <div className="space-y-3">
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Antes de começar <strong>{plan.year}</strong>, guarde os registros de <strong>{currentYear}</strong>: {counts.logs} aulas
          e {counts.events} avaliações e eventos{counts.grades ? `, ${counts.grades} notas` : ''}{counts.rosters ? `, ${counts.rosters} alunos em listas` : ''}.
        </p>
        {fileButton(`Backup completo (${backupFileName})`, downloaded.json, downloadBackup, true)}
        {fileButton(`Planilha de diários ${currentYear} (.csv)`, downloaded.logs, downloadLogs)}
        {fileButton(`Planilha de avaliações ${currentYear} (.csv)`, downloaded.events, downloadEvents)}
        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
          O backup pode ser restaurado em Ajustes → Restaurar dados (isso substitui os dados do momento).
          As planilhas servem para consulta. Guarde tudo num lugar seguro, como o Google Drive.
        </p>
        <label className="flex items-start gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
          <input type="checkbox" checked={archiveConfirmed} onChange={e => setArchiveConfirmed(e.target.checked)} className="mt-0.5 accent-current" disabled={!downloaded.json} />
          Guardei os arquivos de {currentYear} em um local seguro.
        </label>
      </div>
    );

    if (step === 1) return (
      <div className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="w-28">
            <label className={labelCls}>Novo ano letivo</label>
            <input type="number" value={plan.year} onChange={e => { const y = parseInt(e.target.value); if (y > 2000 && y < 2100) setPlan(p => withYear(data, p, y)); }} className={inputCls} />
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 pb-1">Desmarque o que não continua e renomeie o que mudou. Turmas novas podem ser criadas depois em Ajustes → Escolas.</p>
        </div>

        {plan.schools.map(sp => (
          <div key={sp.schoolId} className={`p-3 rounded-lg border ${sp.keep ? 'border-slate-200 dark:border-slate-700' : 'border-dashed border-slate-300 dark:border-slate-700 opacity-60'}`}>
            <label className="flex items-center gap-2 text-xs font-black text-slate-800 dark:text-white cursor-pointer mb-2">
              <input type="checkbox" checked={sp.keep} onChange={e => updateSchool(sp.schoolId, s => ({ ...s, keep: e.target.checked }))} />
              <SchoolIcon size={14} className="text-primary" /> {schoolName(sp.schoolId)}
            </label>
            {sp.keep && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {sp.classes.map(c => (
                  <div key={c.id} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={c.keep} onChange={e => updateSchool(sp.schoolId, s => ({ ...s, classes: s.classes.map(x => x.id === c.id ? { ...x, keep: e.target.checked } : x) }))} />
                    <input value={c.name} disabled={!c.keep} onChange={e => updateSchool(sp.schoolId, s => ({ ...s, classes: s.classes.map(x => x.id === c.id ? { ...x, name: e.target.value } : x) }))} className={`${inputCls} ${!c.keep ? 'line-through opacity-50' : ''}`} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        <label className="flex items-start gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
          <input type="checkbox" checked={plan.keepSchedule} onChange={e => setPlan(p => ({ ...p, keepSchedule: e.target.checked }))} className="mt-0.5" />
          Copiar a grade horária atual como rascunho de {plan.year} (você ajusta em Ajustes → Horários).
        </label>

        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed">
          <strong className="block text-[9px] uppercase text-slate-400 mb-1">Começam do zero em {plan.year}</strong>
          Aulas registradas, avaliações e eventos, notas, listas de alunos e lembretes anteriores a {plan.year}.
          Perfil, configurações{data.students.length ? ' e alunos particulares' : ''} continuam.
        </div>
      </div>
    );

    if (step === 2) return (
      <div className="space-y-3">
        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
          As datas foram trazidas do calendário de {currentYear} para {plan.year}. Ajuste conforme o calendário de cada escola.
          Feriados e recessos extras (Carnaval, emendas, aniversário da cidade) são cadastrados depois em Ajustes → Calendário.
        </p>
        {keptSchools.map(sp => {
          const c = sp.calendar;
          const setCal = (change: Partial<typeof c>) => updateSchool(sp.schoolId, s => ({ ...s, calendar: { ...s.calendar, ...change } }));
          return (
            <div key={sp.schoolId} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2">
              <p className="text-xs font-black text-slate-800 dark:text-white flex items-center gap-2"><CalendarRange size={14} className="text-primary" /> {schoolName(sp.schoolId)}</p>
              <div className="grid grid-cols-3 gap-2">
                <div><label className={labelCls}>Início</label><input type="date" value={c.start} onChange={e => setCal({ start: e.target.value })} className={inputCls} /></div>
                <div><label className={labelCls}>Fim</label><input type="date" value={c.end} onChange={e => setCal({ end: e.target.value })} className={inputCls} /></div>
                <div>
                  <label className={labelCls}>Divisão</label>
                  <select value={c.division} onChange={e => { const division = e.target.value as typeof c.division; setCal({ division, terms: splitTerms(c.start, c.end, division) }); }} className={inputCls}>
                    <option value="bimestres">Bimestres</option>
                    <option value="trimestres">Trimestres</option>
                    {c.division === 'personalizado' && <option value="personalizado">Personalizado</option>}
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                {c.terms.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center">
                    <span className="text-[10px] font-black text-slate-500">{t.name}</span>
                    <input type="date" value={t.start} onChange={e => setCal({ terms: c.terms.map((x, j) => j === i ? { ...x, start: e.target.value } : x) })} className={inputCls} />
                    <input type="date" value={t.end} onChange={e => setCal({ terms: c.terms.map((x, j) => j === i ? { ...x, end: e.target.value } : x) })} className={inputCls} />
                  </div>
                ))}
                <button onClick={() => setCal({ terms: splitTerms(c.start, c.end, c.division) })} className="text-[9px] font-black uppercase text-primary">Dividir o ano em partes iguais</button>
              </div>
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center">
                <span className="text-[10px] font-black text-slate-500">Recesso de julho</span>
                <input type="date" value={c.midYearBreak.start} onChange={e => setCal({ midYearBreak: { ...c.midYearBreak, start: e.target.value } })} className={inputCls} />
                <input type="date" value={c.midYearBreak.end} onChange={e => setCal({ midYearBreak: { ...c.midYearBreak, end: e.target.value } })} className={inputCls} />
              </div>
            </div>
          );
        })}
        {calendarProblems.length > 0 && (
          <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-[10px] font-bold text-amber-700 dark:text-amber-400 space-y-0.5">
            {calendarProblems.map((p, i) => <p key={i}>• {p}</p>)}
          </div>
        )}
      </div>
    );

    // Etapa 4
    return (
      <div className="space-y-3">
        <ul className="text-xs text-slate-700 dark:text-slate-200 space-y-1.5">
          {keptSchools.map(sp => (
            <li key={sp.schoolId} className="flex items-start gap-2">
              <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 shrink-0" />
              <span><strong>{schoolName(sp.schoolId)}</strong>: {sp.classes.filter(c => c.keep).length} turma(s), ano letivo de {formatDateBR(sp.calendar.start)} a {formatDateBR(sp.calendar.end)}</span>
            </li>
          ))}
          <li className="flex items-start gap-2">
            <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 shrink-0" />
            <span>{plan.keepSchedule ? `Grade horária copiada como rascunho de ${plan.year}` : 'Grade horária em branco'}</span>
          </li>
        </ul>
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/40 text-[11px] text-red-700 dark:text-red-300 leading-relaxed flex gap-2">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>
            Os registros de {currentYear} ({counts.logs} aulas e {counts.events} avaliações e eventos) serão removidos do app em todos os seus aparelhos.
            Eles ficam guardados no arquivo <strong>{backupFileName}</strong>.
          </span>
        </div>
        <label className="flex items-start gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
          <input type="checkbox" checked={finalConfirmed} onChange={e => setFinalConfirmed(e.target.checked)} className="mt-0.5" />
          Entendi. Quero começar {plan.year}.
        </label>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <h2 className="text-sm font-black text-slate-800 dark:text-white uppercase flex items-center gap-2">
              <Archive className="text-primary" size={18} /> Virada do ano letivo
            </h2>
            {!result && <p className="text-[10px] font-bold text-slate-400 mt-0.5">Etapa {step + 1} de 4 · {STEPS[step]}</p>}
          </div>
          <button onClick={onClose} disabled={running} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {result ? (
            <div className="space-y-3 text-center py-4">
              <Sparkles className="mx-auto text-primary" size={32} />
              <p className="text-base font-black text-slate-800 dark:text-white">{plan.year} começou!</p>
              <p className="text-xs text-slate-500">
                {result.synced ? 'Salvo neste aparelho e na nuvem. Os outros aparelhos recebem a virada ao abrir o app.'
                  : 'Salvo neste aparelho. O envio para a nuvem será feito quando houver conexão.'}
              </p>
              <div className="text-left p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-700 dark:text-slate-200 space-y-1">
                <strong className="block text-[9px] uppercase text-slate-400">Próximos passos</strong>
                <p>1. Ajustes → Calendário: cadastre feriados e recessos de {plan.year}.</p>
                <p>2. Ajustes → Horários: revise a grade de {plan.year}.</p>
                <p>3. Ajustes → Escolas: crie as turmas novas, se houver.</p>
              </div>
            </div>
          ) : renderStep()}
        </div>

        <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex justify-between gap-2 shrink-0">
          {result ? (
            <button onClick={onClose} className="ml-auto px-4 py-2 bg-primary text-white rounded-lg text-[10px] font-black uppercase">Fechar</button>
          ) : (
            <>
              <button onClick={() => (step === 0 ? onClose() : setStep(s => s - 1))} disabled={running} className="px-3 py-2 rounded-lg text-[10px] font-black uppercase text-slate-500 flex items-center gap-1">
                <ArrowLeft size={12} /> {step === 0 ? 'Cancelar' : 'Voltar'}
              </button>
              {step < 3 ? (
                <button onClick={() => setStep(s => s + 1)} disabled={!canAdvance} className="px-4 py-2 bg-primary text-white rounded-lg text-[10px] font-black uppercase disabled:opacity-40 flex items-center gap-1">
                  Avançar <ArrowRight size={12} />
                </button>
              ) : (
                <button onClick={handleStart} disabled={!canAdvance} className="px-4 py-2 bg-primary text-white rounded-lg text-[10px] font-black uppercase disabled:opacity-40">
                  {running ? 'Aplicando…' : `Começar ${plan.year}`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewSchoolYearWizard;
