import React, { useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';

export type SortOrder = 'asc' | 'desc';

/** Ordem por data de uma lista (mais antigos/mais recentes primeiro), lembrada neste aparelho. */
export const useSortOrder = (key: string, initial: SortOrder): [SortOrder, () => void] => {
  const storageKey = `leciona-sort-${key}`;
  const [order, setOrder] = useState<SortOrder>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved === 'asc' || saved === 'desc' ? saved : initial;
    } catch { return initial; }
  });
  const toggle = () => setOrder(prev => {
    const next = prev === 'asc' ? 'desc' : 'asc';
    try { localStorage.setItem(storageKey, next); } catch { /* sem armazenamento: vale só nesta visita */ }
    return next;
  });
  return [order, toggle];
};

/** Compara datas (texto ISO) na ordem escolhida. */
export const byDate = (order: SortOrder) => (a: { date: string }, b: { date: string }) =>
  order === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);

/** O mesmo botão do Diário (Histórico/Planejamento), com o nome da ordem ao lado. */
const SortOrderButton: React.FC<{ order: SortOrder; onToggle: () => void; className?: string }> = ({ order, onToggle, className = '' }) => (
  <button
    onClick={onToggle}
    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-tight transition-all text-slate-500 bg-slate-100 dark:bg-slate-800 dark:text-slate-300 hover:text-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0 ${className}`}
    title={order === 'asc' ? 'Mais antigos primeiro (toque para inverter)' : 'Mais recentes primeiro (toque para inverter)'}
  >
    {order === 'asc' ? <ArrowUpNarrowWide size={13} /> : <ArrowDownWideNarrow size={13} />}
    <span>{order === 'asc' ? 'Mais antigos' : 'Mais recentes'}</span>
  </button>
);

export default SortOrderButton;
