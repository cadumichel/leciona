import React, { useMemo, useState } from 'react';
import { CheckSquare, ChevronDown, ChevronRight, Square, X, CalendarX } from 'lucide-react';
import { AppData } from '../types';
import { LessonDisplayItem } from '../utils/lessonStats';
import { groupPendencies, PendencyGroup } from '../utils/pendencies';

/**
 * Lista de registros pendentes do Diário: por turma, período atual primeiro (os anteriores ficam
 * recolhidos), com seleção para marcar várias aulas como "não houve aula" de uma vez.
 */

interface Props {
  data: AppData;
  items: LessonDisplayItem[];
  today: string;
  onOpen: (item: LessonDisplayItem) => void;
  onMarkNoLesson: (items: LessonDisplayItem[]) => void;
  /** Quantas aulas a última marcação em lote mudou (0 = nada para desfazer) */
  undoCount?: number;
  onUndo?: () => void;
}

const VISIBLE_DATES = 8;

const dateLabel = (item: LessonDisplayItem) => {
  const d = new Date(item.date + 'T00:00:00');
  const wd = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  const dm = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${dm} · ${item.slot.startTime}`;
};

const PendingLessonsPanel: React.FC<Props> = ({ data, items, today, onOpen, onMarkNoLesson, undoCount = 0, onUndo }) => {
  const groups = useMemo(() => groupPendencies(data, items, today), [data, items, today]);
  const [showOlder, setShowOlder] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const currentCount = groups.current.reduce((n, g) => n + g.items.length, 0);
  const olderCount = groups.older.reduce((n, g) => n + g.items.length, 0);
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleGroup = (g: PendencyGroup) => setSelected(prev => {
    const next = new Set(prev);
    const all = g.items.every(i => next.has(i.id));
    g.items.forEach(i => (all ? next.delete(i.id) : next.add(i.id)));
    return next;
  });
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()); setConfirming(false); };
  const confirm = () => {
    const list = [...selected].map(id => byId.get(id)).filter(Boolean) as LessonDisplayItem[];
    onMarkNoLesson(list);
    stopSelecting();
  };

  const renderGroup = (g: PendencyGroup, sectionKey: string) => {
    const key = `${sectionKey}:${g.key}`;
    const isOpen = expanded.has(key);
    const visible = isOpen ? g.items : g.items.slice(0, VISIBLE_DATES);
    const allSelected = g.items.every(i => selected.has(i.id));
    return (
      <div key={key} className="bg-white dark:bg-slate-900 border border-red-100 dark:border-red-900/30 rounded-xl p-3 md:p-4">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-2 min-w-0">
            {selecting && (
              <button onClick={() => toggleGroup(g)} className="shrink-0 text-red-600" aria-label={allSelected ? 'Desmarcar a turma' : 'Selecionar a turma inteira'}>
                {allSelected ? <CheckSquare size={20} /> : <Square size={20} />}
              </button>
            )}
            <div className="min-w-0">
              <h4 className="text-sm font-black text-slate-800 dark:text-white truncate">{g.className}</h4>
              <p className="text-xs font-semibold text-slate-500 truncate">{g.institutionName}</p>
            </div>
          </div>
          <span className="shrink-0 text-xs font-black text-red-600 bg-red-50 dark:bg-red-900/30 px-2.5 py-1 rounded-full">
            {g.items.length} {g.items.length === 1 ? 'pendente' : 'pendentes'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {visible.map(item => {
            const isSel = selected.has(item.id);
            return (
              <button
                key={item.id}
                onClick={() => (selecting ? toggle(item.id) : onOpen(item))}
                className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${selecting && isSel
                  ? 'bg-red-600 border-red-600 text-white'
                  : 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-900/40 text-red-700 dark:text-red-300 hover:border-red-300'}`}
              >
                {dateLabel(item)}
              </button>
            );
          })}
          {g.items.length > VISIBLE_DATES && (
            <button
              onClick={() => setExpanded(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
              className="px-3 py-2 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800"
            >
              {isOpen ? 'Mostrar menos' : `+ ${g.items.length - VISIBLE_DATES} datas`}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3 animate-in slide-in-from-top-4">
      {undoCount > 0 && onUndo && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-800 text-white">
          <span className="text-sm font-bold">{undoCount} {undoCount === 1 ? 'aula marcada' : 'aulas marcadas'} como "não houve aula".</span>
          <button onClick={onUndo} className="shrink-0 px-3 py-2 rounded-lg text-xs font-black uppercase bg-white/15 hover:bg-white/25">Desfazer</button>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
          {selecting ? 'Toque nas aulas que não aconteceram.' : 'Toque numa data para registrar a aula.'}
        </p>
        {selecting ? (
          <button onClick={stopSelecting} className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-black uppercase text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800"><X size={14} /> Cancelar</button>
        ) : (
          <button onClick={() => setSelecting(true)} className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-black uppercase text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/30 border border-red-100 dark:border-red-900/40"><CheckSquare size={14} /> Selecionar</button>
        )}
      </div>

      {currentCount > 0 && (
        <div className="space-y-2">
          <h3 className="px-1 text-xs font-black uppercase text-slate-500">
            {groups.currentLabel ? `Período atual (${groups.currentLabel})` : 'Período atual'} · {currentCount}
          </h3>
          <div className="grid lg:grid-cols-2 gap-3">{groups.current.map(g => renderGroup(g, 'atual'))}</div>
        </div>
      )}

      {olderCount > 0 && (
        <div className="space-y-2">
          <button onClick={() => setShowOlder(s => !s)} className="w-full flex items-center gap-2 px-1 py-1 text-xs font-black uppercase text-slate-500">
            {showOlder ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Períodos anteriores · {olderCount}
          </button>
          {showOlder && <div className="grid lg:grid-cols-2 gap-3">{groups.older.map(g => renderGroup(g, 'anteriores'))}</div>}
        </div>
      )}

      {selecting && selected.size > 0 && (
        <div className="sticky bottom-24 lg:bottom-4 z-30 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-3 md:p-4">
          {confirming ? (
            <div className="space-y-3">
              <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                Marcar {selected.size} {selected.size === 1 ? 'aula' : 'aulas'} como "não houve aula"? {selected.size === 1 ? 'Ela sai' : 'Elas saem'} das pendências e não {selected.size === 1 ? 'conta' : 'contam'} como aula dada.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirming(false)} className="flex-1 py-3 rounded-xl text-xs font-black uppercase text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800">Voltar</button>
                <button onClick={confirm} className="flex-1 py-3 rounded-xl text-xs font-black uppercase text-white bg-red-600 hover:bg-red-700">Confirmar</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-black text-slate-700 dark:text-slate-200">{selected.size} {selected.size === 1 ? 'selecionada' : 'selecionadas'}</span>
              <button onClick={() => setConfirming(true)} className="flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-black uppercase text-white bg-red-600 hover:bg-red-700"><CalendarX size={16} /> Não houve aula</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PendingLessonsPanel;
