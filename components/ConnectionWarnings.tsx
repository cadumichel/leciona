import React, { useEffect, useState } from 'react';
import { CloudOff, LogIn, RefreshCw } from 'lucide-react';

/**
 * Avisos de conta desconectada: sem a conta Google conectada, o que se registra fica só neste
 * aparelho e não chega aos outros (nem ao conector do Claude).
 */

/** Falha de gravação na nuvem há mais tempo que isto vira faixa de aviso */
export const SAVE_ERROR_WARNING_MS = 10 * 60 * 1000;

const POPUP_SEEN_KEY = 'leciona-disconnected-popup-seen';

/** Janela ao abrir o app desconectado (uma vez por abertura do app) */
export const DisconnectedPopup: React.FC<{ show: boolean; onConnect: () => void }> = ({ show, onConnect }) => {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(POPUP_SEEN_KEY) === '1'; } catch { return false; }
  });
  if (!show || dismissed) return null;

  const close = () => {
    setDismissed(true);
    try { sessionStorage.setItem(POPUP_SEEN_KEY, '1'); } catch { /* ignora */ }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white dark:bg-slate-900 w-full max-w-sm p-6 rounded-[32px] shadow-2xl animate-in zoom-in-95 duration-300 border border-slate-100 dark:border-slate-800">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mb-4">
            <CloudOff size={32} />
          </div>
          <h3 className="text-xl font-black text-slate-800 dark:text-white mb-2">Conta Google desconectada</h3>
          <p className="text-sm font-medium text-slate-500 mb-6">
            O que você registrar agora fica <b>só neste aparelho</b>: não vai para a nuvem nem para os seus outros aparelhos.
          </p>
          <button
            onClick={() => { close(); onConnect(); }}
            className="w-full py-3 bg-primary text-white rounded-xl font-black uppercase tracking-wider flex items-center justify-center gap-2 mb-2"
          >
            <LogIn size={16} /> Conectar agora
          </button>
          <button
            onClick={close}
            className="w-full py-3 text-slate-500 dark:text-slate-400 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Continuar sem conectar
          </button>
        </div>
      </div>
    </div>
  );
};

/** Faixa no topo da tela: desconectado, ou gravação na nuvem falhando há mais de 10 minutos */
export const ConnectionBanner: React.FC<{
  disconnected: boolean;
  errorSince: number | null;
  onConnect: () => void;
  onRetry: () => void;
}> = ({ disconnected, errorSince, onConnect, onRetry }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (errorSince === null) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [errorSince]);

  if (disconnected) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-900/40 px-4 py-2 flex items-center gap-3">
        <CloudOff size={16} className="text-red-500 shrink-0" />
        <p className="flex-1 text-[11px] md:text-xs font-bold text-red-700 dark:text-red-300">
          Conta desconectada: o que você registrar fica só neste aparelho.
        </p>
        <button onClick={onConnect} className="shrink-0 px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
          <LogIn size={12} /> Conectar
        </button>
      </div>
    );
  }

  if (errorSince !== null && now - errorSince >= SAVE_ERROR_WARNING_MS) {
    const minutes = Math.floor((now - errorSince) / 60000);
    return (
      <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-900/40 px-4 py-2 flex items-center gap-3">
        <CloudOff size={16} className="text-amber-600 shrink-0" />
        <p className="flex-1 text-[11px] md:text-xs font-bold text-amber-800 dark:text-amber-300">
          Há {minutes} minutos suas alterações não chegam à nuvem. Elas estão guardadas neste aparelho. Confira a internet.
        </p>
        <button onClick={onRetry} className="shrink-0 px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
          <RefreshCw size={12} /> Tentar de novo
        </button>
      </div>
    );
  }

  return null;
};

/** Aviso dentro das janelas de registro (Diário e Avaliações) */
export const DisconnectedNotice: React.FC<{ onConnect?: () => void }> = ({ onConnect }) => (
  <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 flex items-center gap-3">
    <CloudOff size={18} className="text-red-500 shrink-0" />
    <p className="flex-1 text-[11px] font-bold text-red-700 dark:text-red-300">
      Conta desconectada: este registro ficará só neste aparelho até você conectar.
    </p>
    {onConnect && (
      <button onClick={onConnect} className="shrink-0 px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-black uppercase tracking-wider">
        Conectar
      </button>
    )}
  </div>
);
