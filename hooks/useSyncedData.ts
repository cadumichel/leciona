import { useState, useEffect, useCallback, useRef } from 'react';
import { AppData, LessonLog } from '../types';
import { deepEqual } from '../utils';
import { INITIAL_DATA } from '../initialData';
import {
  SyncedData,
  trackChanges,
  mergeAppData,
  prepareRestore,
  removeUndefined,
  normalizeForCompare,
  estimateDocBytes,
  FIRESTORE_DOC_LIMIT
} from '../utils/sync';
import { auth, db } from '../services/firebaseConnection';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, setDoc, runTransaction, onSnapshot, Timestamp } from 'firebase/firestore';
import { askConfirm } from '../utils/dialogs';

export const STORAGE_KEY = 'leciona-data-v1';
/** '1' = há alterações locais que ainda não chegaram à nuvem */
export const PENDING_KEY = 'leciona-pending-sync';
/** Última marca de "Excluir todos os dados" já aplicada neste aparelho */
export const WIPE_SEEN_KEY = 'leciona-wipe-seen';
/** Última virada de ano letivo já aplicada neste aparelho */
export const YEAR_RESET_SEEN_KEY = 'leciona-year-reset-seen';
/** Conta (uid) dona dos dados guardados neste aparelho: eles nunca são enviados para outra conta */
export const OWNER_KEY = 'leciona-owner-uid';
/** Alterações que não chegaram à nuvem antes de sair da conta, guardadas até a mesma conta voltar */
export const stashKey = (uid: string) => `leciona-guardado-${uid}`;

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

/** Converte Timestamps do Firestore em texto ISO (recursivo). */
const convertTimestamps = (item: any): any => {
  if (!item) return item;
  if (typeof item === 'object' && typeof item.toDate === 'function') return item.toDate().toISOString();
  if (Array.isArray(item)) return item.map(convertTimestamps);
  if (typeof item === 'object') {
    const out: any = {};
    for (const key in item) out[key] = convertTimestamps(item[key]);
    return out;
  }
  return item;
};

/**
 * Garante a estrutura completa dos dados (campos novos) e aplica as migrações automáticas.
 * Usado tanto para os dados da nuvem quanto para a cópia local.
 */
export const applyDefaultsAndMigrations = (input: any): SyncedData => {
  const finalData = (input || {}) as SyncedData;
  const dataWithDefaults: SyncedData = {
    ...INITIAL_DATA,
    ...finalData,
    schools: finalData.schools || [],
    students: finalData.students || [],
    logs: finalData.logs || [],
    events: finalData.events || [],
    calendars: finalData.calendars || [],
    reminders: finalData.reminders || [],
    schedules: finalData.schedules || [],
    classRecords: finalData.classRecords || [],
    grades: finalData.grades || [],
    customAssessments: finalData.customAssessments || [],
    gradingConfigs: finalData.gradingConfigs || [],
    scheduleVersions: finalData.scheduleVersions || [],
    profile: { ...INITIAL_DATA.profile, ...(finalData.profile || {}) },
    settings: {
      ...INITIAL_DATA.settings,
      ...(finalData.settings || {}),
      advancedModes: {
        ...INITIAL_DATA.settings.advancedModes!,
        ...(finalData.settings?.advancedModes || {})
      }
    }
  };

  // MIGRATION: Schedule Versioning
  // Se temos schedules mas não temos versões, cria a versão inicial
  if (dataWithDefaults.schedules.length > 0 && dataWithDefaults.scheduleVersions.length === 0) {
    console.log("📦 [MIGRATION] Criando primeira versão da grade (2024-01-01)...");
    dataWithDefaults.scheduleVersions = [{
      id: crypto.randomUUID(),
      activeFrom: '2024-01-01',
      createdAt: new Date().toISOString(),
      name: 'Grade Inicial',
      schedules: [...dataWithDefaults.schedules]
    }];
  }

  // MIGRATION: Timezone FIX (Self-Healing)
  // Corrige logs que foram salvos com deslocamento de fuso horário (ex: T21:00:00Z do dia anterior)
  if (dataWithDefaults.logs.length > 0) {
    let migratedCount = 0;
    const logs = dataWithDefaults.logs.map(log => {
      if (!log.date || !log.date.includes('T')) return log;
      const [datePart, timePart] = log.date.split('T');

      // Se o horário for entre 21h e 23h59, provavelmente é o dia seguinte em UTC-3 offset
      if (timePart.startsWith('21:') || timePart.startsWith('22:') || timePart.startsWith('23:')) {
        const d = new Date(datePart + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        const newDate = d.toISOString().split('T')[0] + 'T00:00:00.000Z';
        migratedCount++;
        return { ...log, date: newDate };
      }

      // Se tiver qualquer outro horário que não seja 00:00:00.000Z, normaliza
      if (timePart !== '00:00:00.000Z') {
        migratedCount++;
        return { ...log, date: datePart + 'T00:00:00.000Z' };
      }

      return log;
    });
    if (migratedCount > 0) {
      console.log(`✨ [MIGRATION] Auto-cura de fuso horário: ${migratedCount} logs corrigidos.`);
      dataWithDefaults.logs = logs;
    }
  }

  return dataWithDefaults;
};

/** Dados vindos do Firestore: converte, remove metadados do documento e completa a estrutura. */
export const prepareCloudData = (raw: any): SyncedData => {
  const converted = convertTimestamps(raw);
  // Metadados do documento não fazem parte dos dados do app
  const { updatedAt, wiped, wipedAt, ...rest } = converted || {};
  const result = applyDefaultsAndMigrations(rest);
  const wipeMark = converted?._wipedAt || wipedAt;
  if (wipeMark) result._wipedAt = wipeMark;
  return result;
};

const loadLocalData = (): SyncedData => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? applyDefaultsAndMigrations(JSON.parse(saved)) : (INITIAL_DATA as SyncedData);
  } catch (error) {
    console.error('Erro ao ler dados locais:', error);
    return INITIAL_DATA as SyncedData;
  }
};

const hasContent = (d: Partial<AppData>) =>
  (d.schools?.length || 0) > 0 || (d.logs?.length || 0) > 0 ||
  (d.students?.length || 0) > 0 || (d.scheduleVersions?.length || 0) > 0 || (d.schedules?.length || 0) > 0;

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

/** Registro criado sozinho pelo app (avaliação, evento, trabalho em sala): não tem texto do professor. */
const isAutomaticText = (subject?: string) => /^(Avaliação|Evento|Trabalho em sala): /.test(subject || '');

const joinText = (a?: string, b?: string): string | undefined => {
  const x = (a || '').trim();
  const y = (b || '').trim();
  if (!y || x.includes(y)) return a;
  if (!x || y.includes(x)) return b;
  return `${x}\n${y}`;
};

/**
 * Mesma aula registrada em dois aparelhos com textos diferentes: o registro que fica recebe também
 * o texto do outro (conteúdo, tarefa e observações), para nada escrito pelo professor se perder.
 * O texto de um registro automático ("Avaliação: X") não é juntado ao que o professor escreveu.
 */
export const joinLogTexts = <T extends { subject?: string; homework?: string; notes?: string }>(winner: T, loser: T): T => {
  const subject = isAutomaticText(loser.subject) && !isAutomaticText(winner.subject)
    ? winner.subject
    : joinText(winner.subject, loser.subject);
  const homework = joinText(winner.homework, loser.homework);
  const notes = joinText(winner.notes, loser.notes);
  if (subject === winner.subject && homework === winner.homework && notes === winner.notes) return winner;
  // Carimbo novo: a versão juntada vence as cópias antigas nos outros aparelhos
  return { ...winner, subject, homework, notes, _m: Date.now() };
};

// Função Auxiliar para Deduplicar Logs por (data, escola/aluno, slotId)
// Resolve o problema de aulas duplicadas criadas em dispositivos diferentes antes do sync
export const deduplicateLogs = <T extends { id: string; date: string; schoolId?: string; studentId?: string; slotId?: string; subject?: string; homework?: string; notes?: string; deleted?: boolean; type?: string }>(logs: T[]): T[] => {
  const seen = new Map<string, T>();
  const duplicateIds = new Set<string>();

  for (const log of logs) {
    // Não deduplicar logs deletados ou extras (slotId único gerado dinamicamente)
    if (log.deleted || log.type === 'extra' || log.type === 'substitution') continue;
    if (!log.slotId) continue;

    const dateKey = log.date ? log.date.split('T')[0] : '';
    const instKey = log.schoolId || log.studentId || '';
    const key = `${dateKey}-${instKey}-${log.slotId}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, log);
    } else {
      // Pontuar pelo conteúdo: fica o log com mais dados, e o texto do outro é juntado a ele
      // (antes o texto do outro era descartado sem aviso)
      const scoreOf = (l: typeof log) =>
        (l.subject ? 2 : 0) + (l.homework ? 1 : 0) + (l.notes ? 1 : 0);

      const [winner, loser] = scoreOf(log) > scoreOf(existing) ? [log, existing] : [existing, log];
      duplicateIds.add(loser.id);
      seen.set(key, joinLogTexts(winner, loser));
    }
  }

  if (duplicateIds.size === 0) return logs;

  console.log(`🧹 [DEDUP] Juntando ${duplicateIds.size} log(s) duplicado(s) criados em dispositivos diferentes.`);
  return logs.filter(l => !duplicateIds.has(l.id)).map(l => {
    if (l.deleted || l.type === 'extra' || l.type === 'substitution' || !l.slotId) return l;
    const kept = seen.get(`${l.date ? l.date.split('T')[0] : ''}-${l.schoolId || l.studentId || ''}-${l.slotId}`);
    return kept && kept.id === l.id ? kept : l;
  });
};

/** Junta os dados da nuvem com os deste aparelho (item a item) e une aulas registradas em dobro. */
const mergeWithCloud = (cloud: SyncedData, local: SyncedData): SyncedData => {
  const merged = mergeAppData(cloud, local);
  return {
    ...merged,
    logs: deduplicateLogs(merged.logs as LessonLog[]),
    settings: { ...merged.settings, googleSyncEnabled: true }
  } as SyncedData;
};

type PushResult =
  | { kind: 'saved' }
  | { kind: 'merge'; cloud: SyncedData; normalizedCloud: any }
  | { kind: 'defer' };

/**
 * Grava o documento inteiro na nuvem numa transação: lê o que está no servidor e só grava se for
 * o que este aparelho já conhece. Se outro aparelho ou o conector gravou algo que ainda não vimos,
 * nada é gravado e os dados da nuvem são devolvidos para juntar primeiro ("merge"). Se alguém
 * gravar no meio, o Firestore refaz a transação. Sem conexão a transação falha (não fica na fila).
 */
const pushSafely = (uid: string, payloadData: any, normalized: any, lastCloud: any): Promise<PushResult> =>
  runTransaction(db, async (tx): Promise<PushResult> => {
    const docRef = doc(db, 'users', uid);
    const server = await tx.get(docRef);
    if (server.exists()) {
      const raw = server.data();
      const cloud = prepareCloudData(raw);
      const wipeMark = cloud._wipedAt || (raw.wiped ? String(raw.wipedAt || 'wiped') : undefined);
      if (wipeMark && localStorage.getItem(WIPE_SEEN_KEY) !== wipeMark) return { kind: 'defer' };
      if (cloud._yearResetAt && localStorage.getItem(YEAR_RESET_SEEN_KEY) !== cloud._yearResetAt) return { kind: 'defer' };
      const normalizedCloud = normalizeForCompare(cloud);
      const known = !!lastCloud && deepEqual(normalizedCloud, lastCloud);
      if (!known && !deepEqual(normalizedCloud, normalized)) return { kind: 'merge', cloud, normalizedCloud };
    }
    tx.set(docRef, { ...payloadData, updatedAt: Timestamp.now() });
    return { kind: 'saved' };
  });

interface SyncOptions {
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  /** Espera antes de enviar para a nuvem (agrupa alterações seguidas) */
  cloudDelayMs?: number;
  /** Espera antes de gravar no aparelho */
  localDelayMs?: number;
  /** Espera antes de tentar de novo após falha */
  retryDelayMs?: number;
}

/**
 * Dados do app + sincronização com a nuvem.
 *
 * Regras:
 * - Toda alteração é gravada no aparelho logo em seguida, com ou sem internet.
 *   (Antes, sem internet, o primeiro envio ficava "travado" e nada mais era salvo.)
 * - Alterações ainda não enviadas ficam marcadas como pendentes, inclusive se o app for fechado.
 * - Ao receber dados da nuvem com algo pendente aqui, junta item a item (utils/sync.ts);
 *   sem nada pendente, a nuvem é a versão mais nova.
 */
export const useSyncedData = ({ showError, showWarning, cloudDelayMs = 2000, localDelayMs = 400, retryDelayMs = 30000 }: SyncOptions) => {
  const [data, setData] = useState<SyncedData>(loadLocalData);
  const [user, setUser] = useState<User | null>(null);
  // O Firebase já respondeu se há conta conectada (antes disso "user" é null mesmo conectado)
  const [authReady, setAuthReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  // Desde quando a gravação na nuvem está falhando sem parar (null = não está falhando)
  const [errorSince, setErrorSince] = useState<number | null>(null);
  useEffect(() => {
    if (saveStatus === 'error') setErrorSince(prev => prev ?? Date.now());
    else if (saveStatus === 'saved') setErrorSince(null);
  }, [saveStatus]);
  // Muda para forçar uma nova tentativa de envio (voltou a internet, falhou, chegou dado da nuvem)
  const [syncTick, setSyncTick] = useState(0);

  const dataRef = useRef<SyncedData>(data);
  dataRef.current = data;
  const userRef = useRef<User | null>(null);

  // Estado da sincronização (refs: não precisam redesenhar a tela)
  const pendingRef = useRef<boolean>(localStorage.getItem(PENDING_KEY) !== '0'); // sem marca (versão antiga) = trata como pendente
  const cloudReadyRef = useRef(false);          // já recebemos o documento do servidor nesta sessão
  const lastCloudRef = useRef<any>(null);       // o que sabemos estar na nuvem (normalizado)
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const sizeWarnedRef = useRef(false);

  const markPending = useCallback(() => {
    pendingRef.current = true;
    try { localStorage.setItem(PENDING_KEY, '1'); } catch { /* ignora */ }
  }, []);

  const clearPending = useCallback(() => {
    pendingRef.current = false;
    try { localStorage.setItem(PENDING_KEY, '0'); } catch { /* ignora */ }
  }, []);

  /** Tira os dados deste aparelho (a tela volta ao estado inicial). Só o que já está na nuvem ou guardado. */
  const resetLocal = useCallback(() => {
    pendingRef.current = false;
    cloudReadyRef.current = false;
    lastCloudRef.current = null;
    const empty = INITIAL_DATA as SyncedData;
    dataRef.current = empty;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(PENDING_KEY, '0');
      localStorage.removeItem(OWNER_KEY);
    } catch { /* ignora */ }
    setData(empty);
  }, []);

  // --- CÓPIA LOCAL: salva sempre, com ou sem internet ---
  const persistLocal = useCallback((d: SyncedData) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
      localStorage.setItem(PENDING_KEY, pendingRef.current ? '1' : '0');
    } catch (error) {
      console.error('❌ Erro ao salvar no aparelho:', error);
      showError('Não foi possível salvar no aparelho (memória cheia?). Faça um backup em Ajustes.');
    }
  }, [showError]);

  useEffect(() => {
    const t = setTimeout(() => persistLocal(dataRef.current), localDelayMs);
    return () => clearTimeout(t);
  }, [data, persistLocal, localDelayMs]);

  // Ao sair/minimizar o app no celular, grava imediatamente
  useEffect(() => {
    const flush = () => persistLocal(dataRef.current);
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [persistLocal]);

  // --- ENVIO PARA A NUVEM ---
  const saveToCloud = useCallback(async () => {
    const currentUser = userRef.current;
    if (!currentUser || !cloudReadyRef.current || !pendingRef.current) return;
    if (saveInFlightRef.current) {
      // Um envio de cada vez; o próximo sai quando este terminar
      saveQueuedRef.current = true;
      return;
    }

    const snapshot = dataRef.current;
    const payloadData = removeUndefined({
      ...snapshot,
      settings: { ...snapshot.settings, googleSyncEnabled: true }
    });

    const bytes = estimateDocBytes(payloadData);
    if (bytes > FIRESTORE_DOC_LIMIT * 0.98) {
      setSaveStatus('error');
      if (!sizeWarnedRef.current) {
        sizeWarnedRef.current = true;
        showError(`Seus dados (${(bytes / 1048576).toFixed(2)} MB) passaram do limite da nuvem (1 MB). Eles continuam salvos neste aparelho. Faça um backup em Ajustes.`);
      }
      return;
    }
    if (bytes > FIRESTORE_DOC_LIMIT * 0.85 && !sizeWarnedRef.current) {
      sizeWarnedRef.current = true;
      showWarning(`Seus dados ocupam ${(bytes / 1048576).toFixed(2)} MB de 1 MB disponível na nuvem.`);
    }

    // Sem internet nada é enviado nem fica na fila do Firestore: os dados continuam salvos no
    // aparelho e o envio acontece quando a conexão voltar (evento "online"). Antes, a gravação do
    // documento inteiro ficava na fila e, ao reconectar, passava por cima do que outro aparelho
    // ou o conector tivesse gravado nesse meio-tempo.
    if (navigator.onLine === false) {
      setSaveStatus('pending');
      return;
    }

    saveInFlightRef.current = true;
    setSaveStatus('saving');
    const normalized = normalizeForCompare(payloadData);

    try {
      const result = await withTimeout(pushSafely(currentUser.uid, payloadData, normalized, lastCloudRef.current), 20000);
      if (result.kind === 'merge') {
        console.log('🔀 [SYNC] A nuvem mudou desde a última leitura: juntando antes de enviar.');
        lastCloudRef.current = result.normalizedCloud;
        setData(prev => mergeWithCloud(result.cloud, prev));
        setSaveStatus('pending');
        setSyncTick(t => t + 1);
      } else if (result.kind === 'defer') {
        // Exclusão total ou virada de ano feita em outro aparelho: quem aplica é o recebimento
        setSaveStatus('pending');
      } else {
        lastCloudRef.current = normalized;
        if (dataRef.current === snapshot) clearPending();
        setLastSavedTime(new Date().toLocaleTimeString());
        setSaveStatus(pendingRef.current ? 'pending' : 'saved');
      }
    } catch (error: any) {
      console.error('❌ Erro ao salvar no Firestore:', { code: error?.code, message: error?.message });
      setSaveStatus('error');
      // Tenta de novo depois (os dados continuam salvos no aparelho)
      setTimeout(() => setSyncTick(t => t + 1), retryDelayMs);
    } finally {
      saveInFlightRef.current = false;
      if (saveQueuedRef.current) {
        saveQueuedRef.current = false;
        setSyncTick(t => t + 1);
      }
    }
  }, [showError, showWarning, clearPending, retryDelayMs]);

  // Envia pouco depois da última alteração
  useEffect(() => {
    if (!user || !pendingRef.current) return;
    setSaveStatus(prev => (prev === 'saving' ? prev : 'pending'));
    const t = setTimeout(() => { void saveToCloud(); }, cloudDelayMs);
    return () => clearTimeout(t);
  }, [data, user, syncTick, saveToCloud, cloudDelayMs]);

  // Voltou a internet: tenta enviar
  useEffect(() => {
    const onOnline = () => setSyncTick(t => t + 1);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  // --- RECEBIMENTO DA NUVEM (tempo real) ---
  useEffect(() => {
    let unsubscribeSnapshot: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      userRef.current = currentUser;
      cloudReadyRef.current = false;
      lastCloudRef.current = null;

      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }

      if (!currentUser) {
        setData(prev => ({ ...prev, settings: { ...prev.settings, googleSyncEnabled: false } }));
        setSaveStatus('saved');
        return;
      }

      // Os dados guardados neste aparelho pertencem a uma conta. Se quem entrou é outra conta,
      // eles não são mostrados nem enviados para ela (antes eram copiados para a conta nova).
      try {
        const owner = localStorage.getItem(OWNER_KEY);
        if (owner && owner !== currentUser.uid) {
          console.log('👤 Outra conta entrou neste aparelho: os dados da conta anterior não são usados.');
          if (pendingRef.current && hasContent(dataRef.current)) {
            localStorage.setItem(stashKey(owner), JSON.stringify(dataRef.current));
          }
          resetLocal();
        }
        // Alterações desta conta que não tinham chegado à nuvem quando ela saiu: voltam agora
        const stashed = localStorage.getItem(stashKey(currentUser.uid));
        if (stashed) {
          const restored = applyDefaultsAndMigrations(JSON.parse(stashed));
          dataRef.current = restored;
          setData(restored);
          markPending();
          localStorage.setItem(STORAGE_KEY, stashed);
          localStorage.removeItem(stashKey(currentUser.uid));
        }
        localStorage.setItem(OWNER_KEY, currentUser.uid);
      } catch (error) {
        console.error('Erro ao conferir a conta dona dos dados locais:', error);
      }

      const docRef = doc(db, 'users', currentUser.uid);
      unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
        const meta = docSnap.metadata;
        // Eco das nossas próprias gravações ainda não confirmadas
        if (meta.hasPendingWrites) return;

        if (!docSnap.exists()) {
          // Sem internet o Firestore pode dizer "não existe" só porque não consultou o servidor:
          // não cria nada nesse caso (antes isso podia sobrescrever a nuvem com dados antigos)
          if (meta.fromCache) return;
          console.log('☁️ Primeiro uso nesta conta: enviando os dados deste aparelho.');
          cloudReadyRef.current = true;
          markPending();
          setSyncTick(t => t + 1);
          return;
        }

        const raw = docSnap.data();
        const cloud = prepareCloudData(raw);
        const wipeMark: string | undefined = cloud._wipedAt || (raw.wiped ? String(raw.wipedAt || 'wiped') : undefined);

        // "Excluir todos os dados" feito em outro aparelho: aplica uma vez
        if (wipeMark && (raw.wiped === true || cloud._wipedAt) && localStorage.getItem(WIPE_SEEN_KEY) !== wipeMark) {
          console.log('🗑️ Exclusão total detectada. Aplicando neste aparelho.');
          const wipedData = { ...cloud, _wipedAt: wipeMark, settings: { ...cloud.settings, googleSyncEnabled: true } } as SyncedData;
          pendingRef.current = false;
          cloudReadyRef.current = true;
          lastCloudRef.current = normalizeForCompare(wipedData);
          try {
            localStorage.setItem(WIPE_SEEN_KEY, wipeMark);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(wipedData));
            localStorage.setItem(PENDING_KEY, '0');
          } catch { /* ignora */ }
          setData(wipedData);
          return;
        }

        // Virada do ano letivo feita em outro aparelho: aplica uma vez, sem juntar com o ano anterior
        const yearMark = cloud._yearResetAt;
        if (yearMark && localStorage.getItem(YEAR_RESET_SEEN_KEY) !== yearMark) {
          console.log(`📅 Virada para ${cloud._schoolYear || 'o novo ano letivo'} detectada. Aplicando neste aparelho.`);
          const newYearData = { ...cloud, settings: { ...cloud.settings, googleSyncEnabled: true } } as SyncedData;
          pendingRef.current = false;
          cloudReadyRef.current = true;
          lastCloudRef.current = normalizeForCompare(newYearData);
          try {
            localStorage.setItem(YEAR_RESET_SEEN_KEY, yearMark);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newYearData));
            localStorage.setItem(PENDING_KEY, '0');
          } catch { /* ignora */ }
          setData(newYearData);
          return;
        }

        const normalizedCloud = normalizeForCompare(cloud);
        cloudReadyRef.current = true;

        // Confirmação do servidor do que nós mesmos enviamos
        if (lastCloudRef.current && deepEqual(normalizedCloud, lastCloudRef.current)) {
          if (pendingRef.current) setSyncTick(t => t + 1);
          return;
        }
        lastCloudRef.current = normalizedCloud;

        // Nuvem vazia (sem exclusão total) e aparelho com dados: nunca aceitar o vazio
        if (!hasContent(cloud) && hasContent(dataRef.current)) markPending();

        if (pendingRef.current) {
          // Há alterações deste aparelho que a nuvem não tem: junta item a item
          console.log('🔀 [SYNC] Juntando dados da nuvem com alterações deste aparelho.');
          setData(prev => mergeWithCloud(cloud, prev));
          setSyncTick(t => t + 1);
        } else {
          // Nada pendente aqui: a nuvem é a versão mais nova
          setData({ ...cloud, settings: { ...cloud.settings, googleSyncEnabled: true } } as SyncedData);
        }
      }, (error) => {
        console.error('❌ Erro no Sync Realtime (Firestore onSnapshot):', {
          code: (error as any).code,
          message: (error as any).message,
          dica: (error as any).code === 'permission-denied'
            ? '⚠️ Verifique as Regras de Segurança do Firestore'
            : 'Verifique sua conexão de internet'
        });
      });
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeSnapshot) unsubscribeSnapshot();
    };
  }, [markPending, resetLocal]);

  /** Alteração feita no app: marca o que mudou (para a junção entre aparelhos) e agenda o envio. */
  const updateData = useCallback((newData: Partial<AppData>) => {
    markPending();
    setData(prev => trackChanges(prev, { ...prev, ...newData } as SyncedData));
  }, [markPending]);

  /**
   * Sair da conta: envia o que estiver pendente e depois tira os dados deste aparelho, para quem
   * usar o navegador em seguida não ver nem receber os dados (nomes de alunos). Se a nuvem não
   * recebeu tudo, pergunta antes; ao confirmar, as alterações ficam guardadas só para esta conta
   * e voltam quando ela entrar de novo.
   */
  const logout = useCallback(async () => {
    const currentUser = userRef.current;
    persistLocal(dataRef.current);
    if (!currentUser) {
      try { await signOut(auth); } catch (error) { console.error("Erro no logout:", error); }
      return;
    }

    let sent = !pendingRef.current;
    if (!sent && cloudReadyRef.current && navigator.onLine !== false) {
      try {
        // Até 3 tentativas: se a nuvem tiver novidade, junta e envia de novo
        for (let i = 0; i < 3 && !sent; i++) {
          const snapshot = dataRef.current;
          const payload = removeUndefined({
            ...snapshot,
            settings: { ...snapshot.settings, lastSyncAt: new Date().toISOString(), googleSyncEnabled: true }
          });
          const normalized = normalizeForCompare(payload);
          const result = await withTimeout(pushSafely(currentUser.uid, payload, normalized, lastCloudRef.current), 8000);
          if (result.kind === 'saved') {
            lastCloudRef.current = normalized;
            sent = dataRef.current === snapshot;
          } else if (result.kind === 'merge') {
            lastCloudRef.current = result.normalizedCloud;
            dataRef.current = mergeWithCloud(result.cloud, dataRef.current);
          } else {
            break;
          }
        }
      } catch (error) {
        console.error("Erro ao salvar antes do logout:", error);
      }
    }

    if (!sent) {
      const leave = await askConfirm({
        title: 'Alterações ainda não enviadas',
        message: 'Não foi possível enviar suas últimas alterações para a nuvem. Se sair agora, elas ficam guardadas neste aparelho e voltam quando você entrar de novo com esta conta. Sair mesmo assim?',
        confirmLabel: 'Sair',
        cancelLabel: 'Continuar conectado'
      });
      if (!leave) {
        // Continua conectado: o que foi juntado nas tentativas aparece na tela e segue pendente
        setData(dataRef.current);
        persistLocal(dataRef.current);
        setSyncTick(t => t + 1);
        return;
      }
      try {
        localStorage.setItem(stashKey(currentUser.uid), JSON.stringify(dataRef.current));
      } catch (error) {
        console.error('Erro ao guardar as alterações pendentes:', error);
        showError('Não foi possível guardar as alterações neste aparelho. Você continua conectado.');
        return;
      }
    }

    try {
      await signOut(auth);
    } catch (error) {
      console.error("Erro no logout:", error);
      return;
    }
    resetLocal();
  }, [persistLocal, resetLocal, showError]);

  /** Restaurar backup: grava no aparelho e na nuvem ANTES de recarregar (antes recarregava sem salvar). */
  const restoreData = useCallback(async (backup: AppData) => {
    const restored = prepareRestore(dataRef.current, applyDefaultsAndMigrations(backup));
    pendingRef.current = true;
    dataRef.current = restored;
    persistLocal(restored);
    setData(restored);

    const currentUser = userRef.current;
    if (currentUser) {
      try {
        const payload = removeUndefined({ ...restored, settings: { ...restored.settings, googleSyncEnabled: true } });
        await withTimeout(setDoc(doc(db, 'users', currentUser.uid), { ...payload, updatedAt: Timestamp.now() }), 10000);
        clearPending();
        persistLocal(restored);
      } catch (error) {
        console.warn('Backup restaurado no aparelho; o envio para a nuvem será feito quando houver conexão.', error);
      }
    }
  }, [persistLocal, clearPending]);

  /**
   * Virada do ano letivo: substitui os dados pelo novo ano (já montado por utils/newSchoolYear.ts),
   * grava no aparelho e tenta gravar na nuvem antes de concluir. Os outros aparelhos aplicam a
   * virada pela marca `_yearResetAt`. Retorna se a nuvem já recebeu.
   */
  const startNewSchoolYear = useCallback(async (newYear: SyncedData): Promise<boolean> => {
    if (newYear._yearResetAt) {
      try { localStorage.setItem(YEAR_RESET_SEEN_KEY, newYear._yearResetAt); } catch { /* ignora */ }
    }
    pendingRef.current = true;
    dataRef.current = newYear;
    persistLocal(newYear);
    setData(newYear);

    const currentUser = userRef.current;
    if (!currentUser) return false;
    try {
      const payload = removeUndefined({ ...newYear, settings: { ...newYear.settings, googleSyncEnabled: true } });
      await withTimeout(setDoc(doc(db, 'users', currentUser.uid), { ...payload, updatedAt: Timestamp.now() }), 10000);
      lastCloudRef.current = normalizeForCompare(payload);
      clearPending();
      persistLocal(newYear);
      return true;
    } catch (error) {
      console.warn('Novo ano salvo no aparelho; o envio para a nuvem será feito quando houver conexão.', error);
      return false;
    }
  }, [persistLocal, clearPending]);

  const requestSync = useCallback(() => setSyncTick(t => t + 1), []);

  return { data, user, authReady, errorSince, saveStatus, lastSavedTime, updateData, logout, restoreData, startNewSchoolYear, requestSync };
};
