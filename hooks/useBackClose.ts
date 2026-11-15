import { useEffect, useRef } from 'react';

/**
 * Botão/gesto "voltar" do celular (Android) e do navegador.
 * Cada camada aberta (aba fora do Início, aula aberta no Diário, janela) ganha uma entrada no
 * histórico. Voltar fecha a camada de cima, em vez de sair do app. Quando a camada é fechada pelo
 * próprio app (X, Cancelar, Salvar), a entrada correspondente é retirada do histórico.
 */

type Layer = { id: number; onBack: () => void };

const stack: Layer[] = [];
let nextId = 1;
/** Entradas do histórico que ainda precisam ser retiradas (camadas fechadas pelo app) */
let pendingRemovals = 0;
/** popstate causados pelo próprio app, que devem ser ignorados */
let ignorePops = 0;
let flushScheduled = false;
let listening = false;

const STATE_KEY = 'lecionaDepth';
/** Identifica este carregamento do app: entradas do histórico de antes de recarregar não contam */
const SESSION_KEY = 'lecionaBackSession';
const SESSION = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const onPopState = (e: PopStateEvent) => {
  if (ignorePops > 0) { ignorePops--; return; }
  const ours = e.state?.[SESSION_KEY] === SESSION;
  const depth = ours && typeof e.state?.[STATE_KEY] === 'number' ? e.state[STATE_KEY] : 0;
  // Fecha, de cima para baixo, as camadas acima da posição atual do histórico
  while (stack.length > depth) {
    const layer = stack.pop()!;
    try { layer.onBack(); } catch (err) { console.error(err); }
  }
};

const ensureListening = () => {
  if (listening || typeof window === 'undefined') return;
  window.addEventListener('popstate', onPopState);
  listening = true;
};

const flush = () => {
  flushScheduled = false;
  if (pendingRemovals <= 0) return;
  const n = pendingRemovals;
  pendingRemovals = 0;
  ignorePops++;
  window.history.go(-n);
};

export const pushBackLayer = (onBack: () => void): number => {
  ensureListening();
  const id = nextId++;
  stack.push({ id, onBack });
  const state = { ...(window.history.state || {}), [STATE_KEY]: stack.length, [SESSION_KEY]: SESSION };
  if (pendingRemovals > 0) {
    // Uma camada fechou e outra abriu no mesmo instante: reaproveita a entrada do histórico
    pendingRemovals--;
    window.history.replaceState(state, '');
  } else {
    window.history.pushState(state, '');
  }
  return id;
};

export const removeBackLayer = (id: number) => {
  const idx = stack.findIndex(l => l.id === id);
  if (idx === -1) return; // já fechada pelo voltar
  stack.splice(idx, 1);
  pendingRemovals++;
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
};

/** Enquanto `open` for verdadeiro, o voltar do celular chama `onBack` (que deve fechar a camada). */
export function useBackClose(open: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const id = pushBackLayer(() => onBackRef.current());
    return () => removeBackLayer(id);
  }, [open]);
}

/** Só para os testes */
export const __resetBackStack = () => { stack.length = 0; pendingRemovals = 0; ignorePops = 0; flushScheduled = false; };
