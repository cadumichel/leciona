import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { DialogRequest, setDialogListener } from '../utils/dialogs';
import { useBackClose } from '../hooks/useBackClose';

/**
 * Janela de confirmação do app (substitui confirm() e prompt() do navegador).
 * Os pedidos chegam por `askConfirm` / `askText` (utils/dialogs.ts) e aparecem um de cada vez.
 */
const AppDialogs: React.FC = () => {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDialogListener(req => setQueue(q => [...q, req]));
    return () => setDialogListener(null);
  }, []);

  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    setText('');
    const t = setTimeout(() => (current.kind === 'text' ? inputRef.current : confirmRef.current)?.focus(), 30);
    return () => clearTimeout(t);
  }, [current]);

  const finish = (ok: boolean) => {
    if (!current) return;
    if (current.kind === 'confirm') current.resolve(ok);
    else current.resolve(ok ? text : null);
    setQueue(q => q.slice(1));
  };

  // Voltar do celular = Cancelar
  useBackClose(!!current, () => finish(false));

  if (!current) return null;
  const { title, message, confirmLabel, cancelLabel, danger } = current.options;
  const Icon = danger ? AlertTriangle : HelpCircle;

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[10000] flex items-center justify-center p-4 animate-in fade-in"
      onClick={e => { if (e.target === e.currentTarget) finish(false); }}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        if (e.key === 'Enter' && current.kind === 'text') { e.preventDefault(); finish(true); }
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 md:p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto space-y-4">
        <div className="flex gap-3">
          <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${danger ? 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'}`}>
            <Icon size={20} />
          </div>
          <div className="space-y-1 min-w-0">
            {title && <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white">{title}</h3>}
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300 whitespace-pre-line break-words">{message}</p>
          </div>
        </div>
        {current.kind === 'text' && (
          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={current.options.placeholder}
            className="w-full p-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-bold text-slate-800 dark:text-white outline-none focus:border-blue-500"
          />
        )}
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => finish(false)}
            className="min-h-[44px] px-4 rounded-xl text-xs font-black uppercase text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            {cancelLabel || 'Cancelar'}
          </button>
          <button
            ref={confirmRef}
            onClick={() => finish(true)}
            className={`min-h-[44px] px-4 rounded-xl text-xs font-black uppercase text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {confirmLabel || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppDialogs;
