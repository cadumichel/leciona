/**
 * Rascunho do registro de aula (Diário).
 * Enquanto o professor digita, o texto fica guardado neste aparelho (localStorage). Se ele tocar
 * em Voltar, trocar de aba ou fechar o app antes de salvar, o texto volta ao reabrir a mesma aula.
 * Só guarda conteúdo, tarefa e notas (não guarda chamada nem ocorrências) e nunca vai para a nuvem.
 */

export interface DraftText {
  subject: string;
  homework: string;
  notes: string;
}

export interface LessonDraft extends DraftText {
  savedAt: string; // ISO
}

export const DRAFTS_KEY = 'leciona-rascunhos';
/** Rascunhos mais antigos que isso são descartados */
export const DRAFT_MAX_AGE_DAYS = 14;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const defaultStore = (): Store | null => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

/** Identifica a aula: escola/aluno, horário e dia (aula extra usa o próprio registro). */
export const lessonDraftKey = (institutionId: string, shiftId: string, slotId: string, date: string) =>
  `${institutionId}|${shiftId === 'extra' ? 'extra' : 'grade'}|${slotId}|${date.slice(0, 10)}`;

export const pickText = (f: Partial<DraftText>): DraftText => ({
  subject: f.subject || '',
  homework: f.homework || '',
  notes: f.notes || '',
});

export const sameText = (a: DraftText, b: DraftText) =>
  a.subject === b.subject && a.homework === b.homework && a.notes === b.notes;

export const isEmptyText = (t: DraftText) => !t.subject.trim() && !t.homework.trim() && !t.notes.trim();

const readAll = (store: Store | null, now: Date): Record<string, LessonDraft> => {
  if (!store) return {};
  try {
    const raw = JSON.parse(store.getItem(DRAFTS_KEY) || '{}');
    if (!raw || typeof raw !== 'object') return {};
    const limit = now.getTime() - DRAFT_MAX_AGE_DAYS * 86400000;
    const out: Record<string, LessonDraft> = {};
    for (const [k, v] of Object.entries(raw as Record<string, LessonDraft>)) {
      if (v && typeof v.savedAt === 'string' && new Date(v.savedAt).getTime() >= limit) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
};

const writeAll = (store: Store | null, all: Record<string, LessonDraft>) => {
  if (!store) return;
  try {
    if (Object.keys(all).length === 0) store.removeItem(DRAFTS_KEY);
    else store.setItem(DRAFTS_KEY, JSON.stringify(all));
  } catch { /* aparelho sem espaço ou modo privado: segue sem rascunho */ }
};

export const loadDraft = (key: string, now = new Date(), store = defaultStore()): LessonDraft | null =>
  readAll(store, now)[key] || null;

/** Guarda o texto; texto vazio apaga o rascunho. */
export const saveDraft = (key: string, text: DraftText, now = new Date(), store = defaultStore()) => {
  const all = readAll(store, now);
  if (isEmptyText(text)) delete all[key];
  else {
    const prev = all[key];
    // Mesmo texto: mantém a hora original do rascunho
    all[key] = prev && sameText(prev, text) ? prev : { ...pickText(text), savedAt: now.toISOString() };
  }
  writeAll(store, all);
};

export const removeDraft = (key: string, now = new Date(), store = defaultStore()) => {
  const all = readAll(store, now);
  if (!(key in all)) return;
  delete all[key];
  writeAll(store, all);
};
