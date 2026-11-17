import React, { useEffect, useMemo, useState } from 'react';
import { Archive, BookOpen, ClipboardList, FileDown, Loader2, Search, X } from 'lucide-react';
import { AppData } from '../types';
import { downloadCSV, formatDateBR } from '../utils';
import { getClassName } from '../utils/classRefs';
import { buildAssessmentRows, buildLogRows } from '../utils/exportRows';
import { archivedAssessments, archivedClassNames, archivedLessons, assessmentLabel } from '../utils/archivedYear';
import { AnoGuardado, baixarCopiaDoAno, lerAno, listarAnos } from '../utils/arquivoAnos';
import { notifyError } from '../utils/dialogs';
import { useBackClose } from '../hooks/useBackClose';

/**
 * Ajustes → Anos anteriores: os anos guardados na nuvem na virada do ano letivo, só para consulta.
 * Nada daqui volta para os dados em uso. O quadro só aparece quando existe algum ano guardado.
 */

const PAGE = 100;
const selectCls = 'bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-2 text-xs font-bold dark:text-white min-w-0';

const YearViewer: React.FC<{ ano: number; dados: AppData; onClose: () => void }> = ({ ano, dados, onClose }) => {
  const [tab, setTab] = useState<'aulas' | 'avaliacoes'>('aulas');
  const [schoolId, setSchoolId] = useState('');
  const [className, setClassName] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  useBackClose(true, onClose);

  const schools = useMemo(() => (dados.schools || []).filter(s => !s.deleted), [dados]);
  const classNames = useMemo(() => archivedClassNames(dados, schoolId || undefined), [dados, schoolId]);
  const filter = { schoolId: schoolId || undefined, className: className || undefined, search };
  const lessons = useMemo(() => archivedLessons(dados, filter), [dados, schoolId, className, search]);
  const assessments = useMemo(() => archivedAssessments(dados, filter), [dados, schoolId, className, search]);
  useEffect(() => setLimit(PAGE), [tab, schoolId, className, search]);

  const schoolName = (id?: string) => dados.schools.find(s => s.id === id)?.name || '';
  const total = tab === 'aulas' ? lessons.length : assessments.length;

  const tabButton = (id: typeof tab, label: string, count: number, Icon: typeof BookOpen) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 px-3 py-2 rounded-lg text-[10px] font-black uppercase flex items-center justify-center gap-1.5 ${tab === id ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}
    >
      <Icon size={13} /> {label} ({count})
    </button>
  );

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 w-full max-w-3xl h-[90vh] rounded-2xl shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <h2 className="text-sm font-black text-slate-800 dark:text-white uppercase flex items-center gap-2">
              <Archive className="text-primary" size={18} /> Ano letivo {ano}
            </h2>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5">Somente consulta. Nada aqui altera os dados de agora.</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"><X size={18} /></button>
        </div>

        <div className="p-3 space-y-2 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex gap-2">
            {tabButton('aulas', 'Aulas', lessons.length, BookOpen)}
            {tabButton('avaliacoes', 'Avaliações', assessments.length, ClipboardList)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1.4fr] gap-2">
            <select value={schoolId} onChange={e => { setSchoolId(e.target.value); setClassName(''); }} className={selectCls} aria-label="Escola">
              <option value="">Todas as escolas</option>
              {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={className} onChange={e => setClassName(e.target.value)} className={selectCls} aria-label="Turma">
              <option value="">Todas as turmas</option>
              {classNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <label className="col-span-2 sm:col-span-1 flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar no conteúdo" className="w-full bg-transparent py-2 text-xs font-bold dark:text-white outline-none" />
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
          {total === 0 && <p className="text-xs text-slate-500 text-center py-8">Nada encontrado com esses filtros.</p>}

          {tab === 'aulas' && lessons.slice(0, limit).map(l => (
            <div key={l.id} className="p-3 rounded-lg border border-slate-100 dark:border-slate-800">
              <p className="text-[10px] font-black uppercase text-slate-400">
                {formatDateBR(l.date)} · <span className="text-primary">{getClassName(dados, l.schoolId, l.classId)}</span> · {schoolName(l.schoolId)}
                {l.type === 'extra' ? ' · aula extra' : l.type === 'substitution' ? ' · substituição' : ''}
              </p>
              <p className="text-xs text-slate-800 dark:text-slate-100 mt-1 whitespace-pre-wrap break-words">{l.subject || 'Sem conteúdo cadastrado'}</p>
              {l.homework && <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap break-words"><strong>Tarefa:</strong> {l.homework}</p>}
              {l.notes && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 whitespace-pre-wrap break-words"><strong>Notas:</strong> {l.notes}</p>}
            </div>
          ))}

          {tab === 'avaliacoes' && assessments.slice(0, limit).map(e => (
            <div key={e.id} className="p-3 rounded-lg border border-slate-100 dark:border-slate-800">
              <p className="text-[10px] font-black uppercase text-slate-400">
                {formatDateBR(e.date)} · <span className="text-primary">{getClassName(dados, e.schoolId, e.classId)}</span> · {schoolName(e.schoolId)} · {assessmentLabel(e)}
              </p>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-100 mt-1 break-words">{e.title}</p>
              {e.description && <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 whitespace-pre-wrap break-words">{e.description}</p>}
            </div>
          ))}

          {total > limit && (
            <button onClick={() => setLimit(n => n + PAGE)} className="w-full py-2 text-[10px] font-black uppercase text-primary">
              Mostrar mais ({total - limit} restantes)
            </button>
          )}
        </div>

        <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2 shrink-0">
          <button onClick={() => downloadCSV(buildLogRows(dados, lessons), `leciona_diarios_${ano}`)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
            <FileDown size={13} /> Planilha das aulas
          </button>
          <button onClick={() => downloadCSV(buildAssessmentRows(dados, assessments), `leciona_avaliacoes_${ano}`)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
            <FileDown size={13} /> Planilha das avaliações
          </button>
          <button onClick={() => baixarCopiaDoAno(dados, ano)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
            <FileDown size={13} /> Cópia completa (.json)
          </button>
        </div>
      </div>
    </div>
  );
};

const ArchivedYears: React.FC<{ conectado: boolean }> = ({ conectado }) => {
  const [anos, setAnos] = useState<AnoGuardado[]>([]);
  const [abrindo, setAbrindo] = useState<number | null>(null);
  const [aberto, setAberto] = useState<{ ano: number; dados: AppData } | null>(null);

  useEffect(() => {
    if (!conectado) { setAnos([]); return; }
    let vivo = true;
    // Sem internet ou sem resposta: o quadro simplesmente não aparece
    listarAnos().then(lista => { if (vivo) setAnos(lista); }).catch(() => { });
    return () => { vivo = false; };
  }, [conectado]);

  const abrir = async (ano: number) => {
    setAbrindo(ano);
    try {
      setAberto({ ano, dados: await lerAno(ano) });
    } catch (e) {
      notifyError(e instanceof Error ? e.message : 'Não foi possível abrir o ano.');
    } finally {
      setAbrindo(null);
    }
  };

  if (anos.length === 0) return null;

  return (
    <section className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
      <h3 className="text-[13px] font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2">
        <Archive className="text-primary" size={18} /> Anos anteriores
      </h3>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed mt-1 mb-3">
        Guardados na nuvem do Leciona na virada do ano, sem prazo para apagar. Servem para consulta.
      </p>
      <div className="space-y-2">
        {anos.map(a => (
          <div key={a.ano} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
            <div>
              <p className="text-sm font-black text-slate-800 dark:text-white">{a.ano}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {a.resumo.registrosDoDiario} aulas, {a.resumo.avaliacoes} avaliações, {a.resumo.turmas} turmas · guardado em {formatDateBR(a.guardadoEm.slice(0, 10))}
              </p>
            </div>
            <button
              onClick={() => abrir(a.ano)}
              disabled={abrindo !== null}
              className="shrink-0 px-4 py-2.5 bg-primary text-white rounded-lg font-black uppercase text-[10px] tracking-tight flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {abrindo === a.ano ? <Loader2 size={14} className="animate-spin" /> : <BookOpen size={14} />} Consultar
            </button>
          </div>
        ))}
      </div>
      {aberto && <YearViewer ano={aberto.ano} dados={aberto.dados} onClose={() => setAberto(null)} />}
    </section>
  );
};

export default ArchivedYears;
