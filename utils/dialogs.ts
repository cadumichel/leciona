/**
 * Avisos e perguntas dentro do próprio app, no lugar das janelinhas do navegador
 * (alert, confirm e prompt). Funciona em qualquer arquivo, inclusive fora de componentes:
 *   notify('Aula copiada.', 'success')
 *   if (!(await askConfirm({ message: 'Remover?', danger: true }))) return;
 *   const texto = await askText({ message: 'Digite EXCLUIR' });
 * Quem desenha é `components/AppDialogs.tsx` (montado no App). Sem ele (ex.: testes),
 * cai nas janelinhas do navegador.
 */

export type NoticeType = 'success' | 'error' | 'warning' | 'info';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Botão vermelho, para ações que apagam algo. */
  danger?: boolean;
}

export interface TextOptions extends ConfirmOptions {
  placeholder?: string;
}

export type DialogRequest =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'text'; options: TextOptions; resolve: (value: string | null) => void };

type NoticeListener = (message: string, type: NoticeType) => void;
type DialogListener = (request: DialogRequest) => void;

let noticeListener: NoticeListener | null = null;
let dialogListener: DialogListener | null = null;

export const setNoticeListener = (fn: NoticeListener | null) => { noticeListener = fn; };
export const setDialogListener = (fn: DialogListener | null) => { dialogListener = fn; };

/** Aviso rápido no canto da tela (some sozinho). */
export function notify(message: string, type: NoticeType = 'info'): void {
  if (noticeListener) noticeListener(message, type);
  else if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(message);
}

const toOptions = <T extends ConfirmOptions>(o: T | string): T => (typeof o === 'string' ? { message: o } as T : o);

/** Pergunta com "Confirmar" e "Cancelar". Resolve true só se confirmar. */
export function askConfirm(options: ConfirmOptions | string): Promise<boolean> {
  const opts = toOptions(options);
  if (!dialogListener) {
    return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(opts.message) : false);
  }
  return new Promise(resolve => dialogListener!({ kind: 'confirm', options: opts, resolve }));
}

/** Pergunta com campo de texto. Resolve o texto digitado, ou null se cancelar. */
export function askText(options: TextOptions | string): Promise<string | null> {
  const opts = toOptions(options);
  if (!dialogListener) {
    return Promise.resolve(typeof window !== 'undefined' && typeof window.prompt === 'function' ? window.prompt(opts.message) : null);
  }
  return new Promise(resolve => dialogListener!({ kind: 'text', options: opts, resolve }));
}

export const notifySuccess = (message: string) => notify(message, 'success');
export const notifyError = (message: string) => notify(message, 'error');
export const notifyWarning = (message: string) => notify(message, 'warning');
