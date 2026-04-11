import React, { useState, useEffect, useCallback, useRef } from 'react';
// Hook de Debounce para evitar excesso de gravações
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
}
import {
  LayoutDashboard,
  School as SchoolIcon,
  CalendarClock,
  BookOpen,
  FileCheck,
  Settings,
  CalendarDays,
  Users,
  Lightbulb,
  Cloud,
  X,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Clock,
  Sliders,
  LogOut,
  CalendarRange,
  GraduationCap
} from 'lucide-react';
import { AppData, ScheduleEntry, DayOfWeek } from './types';
import {
  parseTimeToMinutes,
  getCurrentTimeInMinutes,
  isWeekend,
  getDayOfWeekFromDate,
  checkTimeOverlap,
  deepEqual
} from './utils';
import Dashboard from './components/Dashboard';
import LessonLogger from './components/LessonLogger';
import AssessmentManagement from './components/AssessmentManagement';
import AgendaManagement from './components/AgendaManagement';
import SettingsPanel from './components/SettingsPanel';
import StudentManagement from './components/StudentManagement';
import ReminderManagement from './components/ReminderManagement';

import GradesManagement from './components/GradesManagement'; // Novo Componente
import SyncStatus from './components/SyncStatus'; // Componente de Status de Sync
import { ToastProvider, useToast } from './hooks/useToast';
import { useAsyncLock } from './utils/validation';

// Firebase Imports
import { auth, db, googleProvider } from './services/firebaseConnection';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, Timestamp } from 'firebase/firestore';

const STORAGE_KEY = 'leciona-data-v1';

export const INITIAL_DATA: AppData = {
  profile: { name: '', subjects: [], setupCompleted: false },
  schools: [],
  students: [],
  classRecords: [],
  schedules: [],
  scheduleVersions: [], // Inicializa array de versões
  logs: [],
  events: [],
  calendars: [],
  reminders: [],
  grades: [], // Inicializa array de notas
  customAssessments: [], // Inicializa array de avaliações personalizadas
  gradingConfigs: [], // Inicializa configurações de média
  settings: {
    alertBeforeMinutes: 5,
    alertAfterLesson: false,
    alertAfterShift: true,
    alertAfterShiftDelay: 0,
    alertType: 'notification',
    alertNotificationStyle: 'silent',
    isPrivateTeacher: false,
    googleSyncEnabled: false,
    showQuickStartGuide: true,
    themeColor: '#2563eb',
    darkMode: false,
    showDailyQuote: true,
    advancedModes: {
      individualOccurrence: false,
      grades: false
    },
    termsAccepted: false
  }
};

export const QuickStartGuide: React.FC<{ onDismiss: () => void; onNavigate: (tab: string) => void }> = ({ onDismiss, onNavigate }) => (
  <div className="bg-primary text-white p-4 md:p-6 rounded-[24px] md:rounded-[32px] shadow-xl shadow-primary/20 mb-4 relative overflow-hidden animate-in fade-in zoom-in-95 duration-500">
    <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
      <Lightbulb size={60} className="md:w-[90px] md:h-[90px]" />
    </div>
    <button onClick={onDismiss} className="absolute top-3 right-3 p-1.5 hover:bg-white/20 rounded-full transition-colors z-20">
      <X size={16} />
    </button>
    <div className="relative z-10">
      <span className="text-[8px] md:text-[9px] font-black uppercase tracking-[0.2em] opacity-80">Bem-Vindo</span>
      <h2 className="text-lg md:text-xl font-black mt-0.5 mb-1.5 tracking-tight">Vamos começar?</h2>
      <p className="text-[10px] md:text-xs font-medium opacity-90 max-w-3xl leading-relaxed">
        Para começar a usar o leciona cadastre seu perfil e as informações sobre as instituições em que trabalha. Para iniciar é necessário que pelo menos uma escola, um ano letivo e um horário de aula estejam cadastrados.
      </p>
    </div>
  </div>
);

// Função Auxiliar para Mesclar Arrays por ID
const mergeArrays = <T extends { id: string; deleted?: boolean; deletedAt?: string }>(cloudArr: T[] = [], localArr: T[] = []): T[] => {
  const map = new Map<string, T>();

  // 1. Base: Start with Cloud Data
  cloudArr.forEach(item => map.set(item.id, item));

  // 2. Merge: Apply Local Changes
  localArr.forEach(localItem => {
    const cloudItem = map.get(localItem.id);

    if (!cloudItem) {
      // Item exists only locally (New item created offline/recently) -> Keep it
      map.set(localItem.id, localItem);
    } else {
      // Conflict: Item exists in both
      // Check for Soft Delete precedence
      if (localItem.deleted) {
        // If Local is deleted...
        if (!cloudItem.deleted) {
          // ...and Cloud is NOT, assume Local deletion is effective (pending sync) -> Local wins
          map.set(localItem.id, localItem);
        } else {
          // ...and Cloud is ALSO deleted, keep the one with newer deletedAt (optional, but safe)
          const localTime = localItem.deletedAt ? new Date(localItem.deletedAt).getTime() : 0;
          const cloudTime = cloudItem.deletedAt ? new Date(cloudItem.deletedAt).getTime() : 0;
          if (localTime > cloudTime) {
            map.set(localItem.id, localItem);
          }
        }
      }
      // If Local is Active and Cloud is Deleted -> Cloud wins (Deletion propagates)
      // If Local is Active and Cloud is Active -> Cloud wins (Cloud authority for content updates)
    }
  });

  return Array.from(map.values());
};

// Função Auxiliar para Deduplicar Logs por (data, escola/aluno, slotId)
// Resolve o problema de aulas duplicadas criadas em dispositivos diferentes antes do sync
const deduplicateLogs = <T extends { id: string; date: string; schoolId?: string; studentId?: string; slotId?: string; subject?: string; homework?: string; notes?: string; deleted?: boolean; type?: string }>(logs: T[]): T[] => {
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
      // Pontuar pelo conteúdo: preferir o log com mais dados
      const scoreOf = (l: typeof log) =>
        (l.subject ? 2 : 0) + (l.homework ? 1 : 0) + (l.notes ? 1 : 0);

      if (scoreOf(log) > scoreOf(existing)) {
        // Novo log tem mais conteúdo: descartar o antigo
        duplicateIds.add(existing.id);
        seen.set(key, log);
      } else {
        // Manter o existente: descartar o novo
        duplicateIds.add(log.id);
      }
    }
  }

  if (duplicateIds.size === 0) return logs;

  console.log(`🧹 [DEDUP] Removendo ${duplicateIds.size} log(s) duplicado(s) criados em dispositivos diferentes.`);
  return logs.filter(l => !duplicateIds.has(l.id));
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [data, setData] = useState<AppData>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : INITIAL_DATA;
  });

  const [user, setUser] = useState<User | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [preSelectedLesson, setPreSelectedLesson] = useState<{ schedule: ScheduleEntry; date: string } | null>(null);
  const [autoShowPendencies, setAutoShowPendencies] = useState(false);
  const [notificationPopup, setNotificationPopup] = useState<{ title: string; message: string; isOpen: boolean }>({ title: '', message: '', isOpen: false });

  const lastNotifiedSlot = useRef<string>('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedData = useRef<AppData | null>(null); // Ref para deep compare do save (Objeto, não string)

  // Security fixes: Toast notifications and async lock
  const { showError, showSuccess, showWarning } = useToast();
  const { isLocked: isLoggingIn, runWithLock } = useAsyncLock();


  const sanitizeFirestoreData = (cloudData: any): AppData => {
    const sanitize = (item: any) => {
      if (!item) return item;
      if (typeof item === 'object' && item.toDate && typeof item.toDate === 'function') {
        return item.toDate().toISOString();
      }
      if (Array.isArray(item)) {
        return item.map(sanitize);
      }
      if (typeof item === 'object') {
        const newItem: any = {};
        for (const key in item) {
          newItem[key] = sanitize(item[key]);
        }
        return newItem;
      }
      return item;
    };

    const sanitized = sanitize(cloudData);

    // Remove metadados que não fazem parte do AppData para evitar poluição do state e loops
    // @ts-ignore
    const { updatedAt, wiped, ...purifiedData } = sanitized;

    const finalData = purifiedData as AppData;

    // Garantir que campos novos existam para evitar crash em modos avançados
    const dataWithDefaults = {
      ...INITIAL_DATA, // Garante estrutura base
      ...finalData,
      classRecords: finalData.classRecords || [],
      grades: finalData.grades || [],
      customAssessments: finalData.customAssessments || [],
      gradingConfigs: finalData.gradingConfigs || [],
      scheduleVersions: finalData.scheduleVersions || [],
      settings: {
        ...INITIAL_DATA.settings,
        ...finalData.settings,
        advancedModes: {
          ...INITIAL_DATA.settings.advancedModes,
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

    return dataWithDefaults;
  };

  // Monitorar Autenticação e Carregar Dados do Firestore
  // Monitorar Autenticação e Carregar Dados do Firestore (Realtime)
  useEffect(() => {
    let unsubscribeSnapshot: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      console.log("🔐 Estado de Autenticação:", {
        userId: currentUser?.uid || "NÃO AUTENTICADO",
        email: currentUser?.email || "N/A",
        displayName: currentUser?.displayName || "N/A"
      });
      setUser(currentUser);

      // Se houver troca de usuário ou logout, cancela listener anterior
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }

      if (currentUser) {
        setIsSyncing(true);
        try {
          const docRef = doc(db, "users", currentUser.uid);

          // REALTIME LISTENER (onSnapshot)
          // Garante que se um dispositivo der Wipe, este aqui receba o evento na hora
          unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
            // Sempre libera o estado de sync ao receber qualquer coisa do snapshot
            // Mas cuidado: se for apenas eco, não queremos afetar o loading state se for gerido por outro lugar?
            // No, isSyncing is global sync lock. If snapshot returns, we are synced.

            if (docSnap.exists()) {
              const rawData = docSnap.data();

              // VERIFICAÇÃO DE WIPE (HARD RESET)
              const isWiped = rawData.wiped === true;

              // Se o dado vier da cache local (antes de syncar), ignoramos "wiped" se quisermos?
              // Não, se estiver wiped no cache local também deve valer.
              // Mas o perigo é: eu acabei de salvar (pending write) -> snapshot volta -> loop?
              // O onSnapshot dispara quando 'saveData' escreve.
              // Check metadata.hasPendingWrites? Se for true, fui eu que escrevi.
              if (docSnap.metadata.hasPendingWrites) {
                // Fui eu que escrevi. Se eu escrevi um 'wiped', ok. Se escrevi dados normais, ok.
                // Geralmente ignoramos updates locais para evitar re-render ou loop lógica,
                // MAS se o servidor mandar 'wiped', não terá pendingWrites (veio de outro device).
                if (!isWiped) {
                  // Ignora eco local se não for wipe para evitar loop de sincronização e perda de dados temporários (digitação)
                  return; // Data was written by us, so we are "synced" relative to this specific write.
                }
              }

              const cloudData = sanitizeFirestoreData(rawData);

              // ECHO CANCELLATION (CRÍTICO)
              // Compara o que veio da nuvem com o que NÓS acabamos de salvar.
              // Normalizar cloudData para garantir que undefined/null/keys sejam tratados igual ao lastSavedData (que é JSON)
              const normalizedCloudData = JSON.parse(JSON.stringify(cloudData));

              if (deepEqual(normalizedCloudData, lastSavedData.current)) {
                // É apenas o servidor confirmando o que enviamos.
                setIsSyncing(false);
                return;
              }

              console.log('📥 [SNAPSHOT] Dados novos reais detectados! Atualizando estado local...');

              const localData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<AppData>;
              let mergedData: AppData;

              if (isWiped) {
                console.log("🗑️ Detectado Hard Reset (Realtime). Limpando tudo...");
                mergedData = {
                  ...cloudData, // Estado vazio vindo da nuvem
                  settings: { ...cloudData.settings, googleSyncEnabled: true }
                };
                localStorage.removeItem(STORAGE_KEY);

                // Importante: atualizar o estado para vazio imediatamente
                setData(mergedData);
                // Não precisa atualizar lastSavedData aqui pois isWiped é caso especial
                setIsSyncing(false);
                return;
              }

              // =====================================================
              // 🛡️ PROTEÇÃO UPSTREAM SYNC (ANTI-PERDA DE DADOS)
              // =====================================================
              // Cenário: Usuário criou dados localmente (onboarding),
              // mas o Firestore ainda está vazio (upload não ocorreu).
              // Se aceitarmos o estado vazio da nuvem, perdemos tudo!

              const localHasData = (
                (localData.schools && localData.schools.length > 0) ||
                (localData.schedules && localData.schedules.length > 0) ||
                (localData.logs && localData.logs.length > 0) ||
                (localData.students && localData.students.length > 0)
              );

              const cloudIsEmpty = (
                (!cloudData.schools || cloudData.schools.length === 0) &&
                (!cloudData.schedules || cloudData.schedules.length === 0) &&
                (!cloudData.logs || cloudData.logs.length === 0) &&
                (!cloudData.students || cloudData.students.length === 0)
              );

              if (localHasData && cloudIsEmpty) {
                console.log("🛡️ UPSTREAM SYNC PROTECTION ATIVADA!");
                console.log("   └─ Local possui dados, mas nuvem está vazia.");
                console.log("   └─ FORÇANDO upload dos dados locais para prevenir perda de dados...");

                // Força upload imediato dos dados locais para a nuvem
                const uploadPayload = {
                  ...localData,
                  settings: { ...localData.settings, googleSyncEnabled: true },
                  updatedAt: Timestamp.now()
                };

                setDoc(docRef, uploadPayload)
                  .then(() => {
                    console.log("✅ Dados locais enviados com sucesso para Firestore");
                    lastSavedData.current = JSON.parse(JSON.stringify(localData));
                  })
                  .catch((error) => {
                    console.error("❌ Erro ao forçar upload de dados locais:", error);
                  });

                // NÃO atualiza o estado com dados vazios da nuvem
                setIsSyncing(false);
                return;
              }
              // =====================================================
              // FIM DA PROTEÇÃO UPSTREAM SYNC
              // =====================================================

              // Se não foi wipe, faz o merge normal
              mergedData = {
                ...cloudData,
                events: mergeArrays(cloudData.events, localData.events),
                reminders: mergeArrays(cloudData.reminders, localData.reminders),
                // FIX: Deduplica após o merge para resolver race condition multi-device
                logs: deduplicateLogs(mergeArrays(cloudData.logs, localData.logs)),
                schools: mergeArrays(cloudData.schools, localData.schools),
                students: mergeArrays(cloudData.students, localData.students),

                // CRÍTICO: Arrays que faltavam no merge e causavam perda de dados (overwrite)
                calendars: mergeArrays(cloudData.calendars, localData.calendars),
                schedules: mergeArrays(cloudData.schedules, localData.schedules),
                scheduleVersions: mergeArrays(cloudData.scheduleVersions, localData.scheduleVersions),
                classRecords: mergeArrays(cloudData.classRecords, localData.classRecords),
                grades: mergeArrays(cloudData.grades, localData.grades),
                customAssessments: mergeArrays(cloudData.customAssessments, localData.customAssessments),
                gradingConfigs: mergeArrays(cloudData.gradingConfigs, localData.gradingConfigs),

                settings: { ...cloudData.settings, googleSyncEnabled: true }
              };

              setData(mergedData);
              // ATUALIZAÇÃO CRÍTICA: Sincronizar lastSavedData com o que acabamos de aceitar da nuvem
              // Isso previne que o auto-save dispare desnecessariamente tentando salvar de volta o que acabamos de receber
              lastSavedData.current = JSON.parse(JSON.stringify(mergedData));

            } else {
              // Doc não existe (Primeiro uso ou deletado manualmente no console)
              // Cria doc inicial
              setDoc(docRef, { ...data, settings: { ...data.settings, googleSyncEnabled: true } });
            }

            setIsSyncing(false);
          }, (error) => {
            console.error("❌ Erro no Sync Realtime (Firestore onSnapshot):", {
              code: (error as any).code,
              message: (error as any).message,
              userId: currentUser?.uid,
              dica: (error as any).code === 'permission-denied'
                ? '⚠️ Verifique as Regras de Segurança do Firestore'
                : 'Verifique sua conexão de internet'
            });
            setIsSyncing(false);
          });

        } catch (error) {
          console.error("Erro ao configurar sync:", error);
          setIsSyncing(false);
        }
      } else {
        // Logout
        setData(prev => ({ ...prev, settings: { ...prev.settings, googleSyncEnabled: false } }));
        setIsSyncing(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeSnapshot) unsubscribeSnapshot();
    };
  }, []);

  // Salvar no LocalStorage (Offline) e Sync (Online)
  // --- LÓGICA DE AUTO-SAVE OTIMIZADA (DEBOUNCE 2s) ---
  const debouncedData = useDebounce(data, 2000);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  // Efeito 1: Detectar mudanças imediatas (Visual: Pendente)
  useEffect(() => {
    // Se os dados mudaram em relação ao que foi salvo/debounced, marca como pendente
    if (data !== debouncedData) {
      console.log('🔄 [SYNC] Mudança detectada nos dados. Aguardando debounce...');
      setSaveStatus('pending');
    }
  }, [data, debouncedData]);

  // Efeito 2: Salvar quando o Debounce estabilizar
  useEffect(() => {
    // Ignorar a montagem inicial se não houver mudanças reais ou se estiver syncando
    if (isSyncing) {
      return;
    }

    const saveData = async () => {
      console.log('💾 [SYNC] Debounce finalizado. Iniciando verificação de salvamento...');

      // Evita salvamento redundante se os dados não mudaram (Deep Compare REAL)
      // Normalizar debouncedData (remover undefineds) para bater com lastSavedData (que é JSON puro)
      const normalizedDebounced = JSON.parse(JSON.stringify(debouncedData));

      // Isso quebra o loop: Snapshot -> setData -> Debounce -> Save -> Snapshot
      if (deepEqual(normalizedDebounced, lastSavedData.current)) {
        console.log('⏭️ [SYNC] Nenhuma alteração real (DeepEqual). Salvamento pulado.');
        setSaveStatus('saved');
        return;
      }

      setSaveStatus('saving');

      // 1. Salvar LocalStorage (Síncrono e imediato para garantir offline)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(debouncedData));

      // 2. Atualizar Tema (Efeito colateral visual)
      const root = document.documentElement;
      if (debouncedData.settings.darkMode) root.classList.add('dark');
      else root.classList.remove('dark');
      root.style.setProperty('--primary-color', debouncedData.settings.themeColor);
      root.style.setProperty('--primary-light', debouncedData.settings.themeColor + '15');
      root.style.setProperty('--primary-medium', debouncedData.settings.themeColor + '40');

      // 3. Salvar no Firebase (se logado)
      if (user) {
        setIsSyncing(true);
        console.log('🚀 [SYNC] Enviando dados para o Firestore...');
        try {
          // Função auxiliar para remover undefined (Firestore não aceita undefined)
          const removeUndefined = (obj: any): any => {
            if (obj === null || obj === undefined) return null;
            if (Array.isArray(obj)) {
              return obj.map(item => removeUndefined(item)).filter(item => item !== undefined);
            }
            if (typeof obj === 'object' && obj.constructor === Object) {
              const cleaned: any = {};
              Object.keys(obj).forEach(key => {
                const value = removeUndefined(obj[key]);
                if (value !== undefined) {
                  cleaned[key] = value;
                }
              });
              return cleaned;
            }
            return obj;
          };

          // Prepara dados para nuvem com timestamp e remove undefined
          const payload = removeUndefined({
            ...debouncedData,
            updatedAt: Timestamp.now()
          });

          // ATUALIZAÇÃO OTIMISTA (CRÍTICO PARA EVITAR LOOP)
          // Atualiza a referência ANTES de enviar. 
          // Se o onSnapshot voltar "instantaneamente" (antes do await setDoc terminar),
          // ele já vai encontrar o lastSavedData atualizado e vai ignorar o eco.
          lastSavedData.current = JSON.parse(JSON.stringify(debouncedData));

          await setDoc(doc(db, "users", user.uid), payload);
          console.log('✅ [SYNC] Sucesso! Dados salvos no Firestore.');
          setLastSavedTime(new Date().toLocaleTimeString());
          setSaveStatus('saved');

          // lastSavedData.current já foi atualizado acima para race condition protection

        } catch (error) {
          console.error("❌ Erro ao salvar no Firestore:", {
            code: (error as any).code,
            message: (error as any).message,
            userId: user?.uid,
            erro: error
          });
          setSaveStatus('error');
        } finally {
          setIsSyncing(false);
        }
      } else {
        // Se offline, apenas atualiza ref e status
        lastSavedData.current = JSON.parse(JSON.stringify(debouncedData));
        setLastSavedTime(new Date().toLocaleTimeString());
        setSaveStatus('saved');
      }
    };

    saveData();
  }, [debouncedData, user, isSyncing]);




  // Funções de Autenticação - FIX: Mensagens de erro claras + proteção contra duplo clique
  const handleLogin = async (forceAccountSelection = false) => {
    await runWithLock(async () => {
      try {
        if (forceAccountSelection) {
          googleProvider.setCustomParameters({
            prompt: 'select_account'
          });
        }
        await signInWithPopup(auth, googleProvider);
        // Reset custom parameters after login
        googleProvider.setCustomParameters({});
        showSuccess('Login realizado com sucesso!');
      } catch (error: any) {
        console.error("Erro no login:", error);
        let msg = "Erro ao conectar conta Google.";
        if (error.code === 'auth/popup-closed-by-user') {
          msg = "Login cancelado pelo usuário.";
        } else if (error.code === 'auth/unauthorized-domain') {
          msg = "Domínio não autorizado no Firebase.";
        }
        showError(msg);
      }
    });
  };

  const handleLogout = async () => {
    // FIX: Forçar salvamento antes de sair para garantir que exclusões recentes sejam persistidas
    if (user) {
      setIsSyncing(true);
      try {
        // Salva o estado ATUAL imediatamente, sem esperar timeout
        const dataToSave = {
          ...data,
          settings: {
            ...data.settings,
            lastSyncAt: new Date().toISOString()
          }
        };
        await setDoc(doc(db, "users", user.uid), dataToSave);
        console.log("Dados sincronizados com sucesso antes do logout.");
      } catch (error) {
        console.error("Erro ao salvar antes do logout:", error);
        alert("Aviso: Não foi possível salvar seus dados na nuvem antes de sair. Verifique sua conexão.");
      } finally {
        setIsSyncing(false);
      }
    }

    try {
      await signOut(auth);
      // Opcional: Limpar dados locais sensíveis ou resetar para INITIAL_DATA se desejar
      // setData(INITIAL_DATA); 
    } catch (error) {
      console.error("Erro no logout:", error);
    }
  };

  const updateData = (newData: Partial<AppData>) => {
    setData(prev => ({ ...prev, ...newData }));
  };

  const handleNavigateToPendencies = () => {
    setAutoShowPendencies(true);
    setActiveTab('lessons');
  };

  // --- SISTEMA DE ALERTAS & NOTIFICAÇÕES ---
  useEffect(() => {
    const checkContentAlerts = () => {
      const nowMins = getCurrentTimeInMinutes();
      const today = new Date().getDay() as DayOfWeek;
      const todayStr = new Date().toLocaleDateString('en-CA');

      // 1. Verificação de Alertas de Aula (Fim de Aula / Fim de Turno)
      if (data.settings.alertAfterLesson || data.settings.alertAfterShift) {
        data.schedules.forEach(s => {
          if (Number(s.dayOfWeek) !== today || s.classId === 'window') return;

          const school = data.schools.find(sc => sc.id === s.schoolId);
          const shift = school?.shifts.find(sh => sh.id === s.shiftId);
          const slot = shift?.slots.find(sl => sl.id === s.slotId);
          if (!slot) return;

          // Verifica se é a última aula do turno para aplicar a lógica de "Alerta de Turno"
          // Encontra todos os slots deste turno que têm aula agendada hoje
          const shiftSlots = shift?.slots.filter(sl => sl.type === 'class') || [];
          const lastSlotOfShift = shiftSlots.length > 0 ? shiftSlots[shiftSlots.length - 1] : null;
          const isLastLesson = lastSlotOfShift?.id === s.slotId;

          const endMins = parseTimeToMinutes(slot.endTime);

          let triggerMins = endMins - data.settings.alertBeforeMinutes;
          // Se for a última aula E alerta de turno estiver ativo, usa o delay configurado
          if (isLastLesson && data.settings.alertAfterShift) {
            triggerMins = endMins + (data.settings.alertAfterShiftDelay || 0);
          }

          // Lógica de Disparo:
          // Se "Alerta por Aula" estiver ativo -> Dispara em todas.
          // Se "Alerta por Aula" estiver OFF, mas "Alerta por Turno" estiver ON -> Dispara APENAS na última.
          const shouldAlert = data.settings.alertAfterLesson || (data.settings.alertAfterShift && isLastLesson);

          // Verifica se está no momento do disparo (com janela de 5 min)
          if (shouldAlert && nowMins >= triggerMins && nowMins < triggerMins + 5) {
            const slotKey = `${todayStr}-${s.slotId}`;
            if (lastNotifiedSlot.current !== slotKey) {
              const hasLog = data.logs.some(l => l.date.startsWith(todayStr) && l.slotId === s.slotId);

              // Se não tiver log dessa aula, OU se for a última aula (mesmo tendo log) e tiver alerta de turno ativado
              if (!hasLog || (isLastLesson && data.settings.alertAfterShift)) {

                let pendingCount = 0;
                // Calculo de pendências do turno se for a última aula
                if (isLastLesson && data.settings.alertAfterShift) {
                  pendingCount = shiftSlots.reduce((acc, currentSlot) => {
                    const slotHasLog = data.logs.some(l => l.date.startsWith(todayStr) && l.slotId === currentSlot.id);
                    // Considera pendente se não tem log e o horário já passou (ou é o atual)
                    const isPastOrCurrent = parseTimeToMinutes(currentSlot.endTime) <= endMins;
                    return (!slotHasLog && isPastOrCurrent) ? acc + 1 : acc;
                  }, 0);

                  // Se não houver pendências e já tiver log na atual, não precisa notificar nada
                  if (pendingCount === 0 && hasLog) return;
                }

                lastNotifiedSlot.current = slotKey;

                if (data.settings.alertType === 'popup') {
                  let msg = "";
                  if (isLastLesson && data.settings.alertAfterShift) {
                    if (pendingCount > 0) {
                      msg = `O turno na ${school?.name} acabou. Você tem ${pendingCount} aula(s) sem registro!`;
                    } else if (!hasLog) {
                      msg = `A aula de ${s.classId} está terminando. Registre o conteúdo!`;
                    }
                  } else if (!hasLog) {
                    msg = `A aula de ${s.classId} está terminando. Registre o conteúdo!`;
                  }

                  if (msg) {
                    setNotificationPopup({
                      title: isLastLesson && data.settings.alertAfterShift ? 'Fim de Turno' : 'Fim de Aula',
                      message: msg,
                      isOpen: true
                    });
                  }
                } else if ("Notification" in window && Notification.permission === "granted") {
                  let msg = "";

                  if (isLastLesson && data.settings.alertAfterShift) {
                    if (pendingCount > 0) {
                      msg = `O turno na ${school?.name} acabou. Você tem ${pendingCount} aula(s) sem registro!`;
                    } else if (!hasLog) {
                      msg = `A aula de ${s.classId} está terminando. Registre o conteúdo!`;
                    }
                  } else if (!hasLog) {
                    msg = `A aula de ${s.classId} está terminando. Registre o conteúdo!`;
                  }

                  if (msg) {
                    const style = data.settings.alertNotificationStyle || 'sound';
                    const options: NotificationOptions = { body: msg, silent: false };

                    if (style === 'silent') {
                      options.silent = true;
                    } else if (style === 'vibration') {
                      options.silent = true;
                      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
                    }

                    new Notification("Leciona: Lembrete de Registro", options);
                  }
                }
              }
            }
          }
        });
      }

      // 2. Verificação de Alarmes de Lembretes
      data.reminders.forEach(reminder => {
        if (reminder.alarmTime && !reminder.alarmTriggered) {
          const alarmDate = new Date(reminder.alarmTime);
          // Verifica se está dentro do minuto do alarme
          const diffMs = alarmDate.getTime() - new Date().getTime();

          // Se a diferença for pequena (ex: entre -1 min e +1 min) ou se já passou e não foi notificado
          // Aqui vamos considerar: disparar se já passou da hora e ainda não disparou (mas não muito antigo, ex: 24h)
          if (diffMs <= 0 && diffMs > -86400000) {
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(`Lembrete: ${reminder.title}`, { body: reminder.content });
            }

            // Marca como disparado para não repetir
            // Verifica se JÁ está marcado (redundância para evitar loop)
            const alreadyTriggered = data.reminders.find(r => r.id === reminder.id)?.alarmTriggered;
            if (!alreadyTriggered) {
              updateData({
                reminders: data.reminders.map(r => r.id === reminder.id ? { ...r, alarmTriggered: true } : r)
              });
            }
          }
        }
      });

    };

    // Solicita permissão ao carregar se necessário
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    const interval = setInterval(checkContentAlerts, 30000); // Verifica a cada 30s
    return () => clearInterval(interval);
  }, [data]);

  // Lógica de Onboarding
  const isOnboarding = !data.profile.setupCompleted;

  useEffect(() => {
    if (isOnboarding && activeTab !== 'settings') {
      setActiveTab('settings');
    }
  }, [isOnboarding, activeTab]);

  const navItems = [
    { id: 'dashboard', label: 'Início', icon: LayoutDashboard },
    { id: 'lessons', label: 'Diário', icon: BookOpen },
    ...(data.settings.isPrivateTeacher ? [{ id: 'private', label: 'Particulares', icon: Users }] : []),
    { id: 'assessments', label: 'Avaliações', icon: FileCheck },
    ...(data.settings.advancedModes?.grades ? [{ id: 'grades', label: 'Notas', icon: GraduationCap }] : []),
    { id: 'agenda', label: 'Agenda', icon: CalendarRange },
    { id: 'reminders', label: 'Lembretes', icon: Lightbulb },
    { id: 'settings', label: 'Ajustes', icon: Settings },
  ];

  return (
    <div className={`flex flex-col lg:flex-row min-h-screen transition-colors duration-300 bg-slate-100 dark:bg-slate-950`}>
      <style>{`
        :root {
          --primary-color: ${data.settings.themeColor};
          --primary-light: ${data.settings.themeColor}15;
          --primary-medium: ${data.settings.themeColor}40;
        }
        .text-primary { color: var(--primary-color); }
        .bg-primary { background-color: var(--primary-color); }
        .border-primary { border-color: var(--primary-color); }
        .bg-primary-light { background-color: var(--primary-light); }
        .ring-primary { --tw-ring-color: var(--primary-color); }
      `}</style>


      {/* Menu Mobile Compacto - Ocultar no Onboarding */}
      {!isOnboarding && (
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t dark:border-slate-800 z-50 flex justify-between px-4 py-2 safe-area-bottom shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] overflow-x-auto">
          {navItems.map(item => (
            <button key={item.id} onClick={() => { setActiveTab(item.id); if (item.id !== 'lessons') setPreSelectedLesson(null); }} className={`flex flex-col items-center justify-center p-1 min-w-[50px] rounded-xl transition-all ${activeTab === item.id ? 'text-primary' : 'text-slate-400 dark:text-slate-500'}`}>
              <item.icon size={20} className={activeTab === item.id ? 'mb-0.5' : 'mb-0'} />
              {activeTab === item.id && <span className="text-[9px] font-black tracking-tight">{item.label}</span>}
            </button>
          ))}
        </nav>
      )}

      {!isOnboarding && (
        <aside className="hidden lg:flex flex-col w-64 bg-white dark:bg-slate-900 border-r dark:border-slate-800 min-h-screen sticky top-0 transition-colors">
          <div className="p-6">
            <h1 className="text-2xl font-black text-primary flex items-center gap-2 tracking-tight">
              <BookOpen className="text-primary" /> Leciona
            </h1>
          </div>
          <nav className="flex-1 px-4 space-y-2 overflow-y-auto">
            {navItems.map(item => (
              <button key={item.id} onClick={() => { setActiveTab(item.id); if (item.id !== 'lessons') setPreSelectedLesson(null); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === item.id ? 'bg-primary-light text-primary font-black' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                <item.icon size={20} />
                <span className="text-[11px] font-bold tracking-tight">{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="p-4 border-t dark:border-slate-800">
            <div className="flex items-center justify-between bg-slate-100 dark:bg-slate-800 p-3 rounded-xl text-xs text-slate-600 dark:text-slate-400 transition-colors">
              <div className="flex items-center gap-2 overflow-hidden">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="User" className="w-6 h-6 rounded-full" />
                ) : (
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${data.settings.googleSyncEnabled && user ? 'bg-green-50 text-white' : 'bg-slate-300 dark:bg-slate-700'}`}>
                    {data.profile.name ? data.profile.name[0] : 'U'}
                  </div>
                )}
                <div className="flex flex-col overflow-hidden">
                  <span className="truncate font-black tracking-tighter">{data.profile.name || 'Docente'}</span>
                  <span className="text-[9px] truncate opacity-70">{user ? 'Conectado' : 'Offline'}</span>
                </div>
              </div>
              {isSyncing || saveStatus === 'saving' ? <Cloud className="animate-bounce text-primary" size={14} /> :
                saveStatus === 'pending' ? <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></div> :
                  saveStatus === 'error' ? <div className="w-2 h-2 bg-red-500 rounded-full"></div> :
                    user ? <div className="w-2 h-2 bg-green-500 rounded-full"></div> : null}
            </div>
          </div>
        </aside>
      )}

      <main className="flex-1 min-w-0 w-full pb-24 lg:pb-0 overflow-x-hidden">
        <header className="bg-white dark:bg-slate-900 border-b dark:border-slate-800 px-4 py-3 lg:px-6 lg:py-4 flex justify-between items-center sticky top-0 z-40 transition-colors shadow-sm lg:shadow-none gap-3">

          {/* Esquerda: Título da Seção */}
          <h2 className="text-lg lg:text-xl font-black text-slate-800 dark:text-white truncate">
            {navItems.find(i => i.id === activeTab)?.label}
          </h2>

          {/* Direita: Status + Branding */}
          <div className="flex items-center gap-3 shrink-0">
            {user && (
              <div className="shrink-0">
                <SyncStatus
                  isSaving={isSyncing || saveStatus === 'saving'}
                  lastSyncedAt={lastSavedTime || data.settings.lastSyncAt || null}
                />
              </div>
            )}

            {/* Branding Mobile (Leciona + Logo) */}
            <div className="lg:hidden flex items-center gap-2 pl-3 border-l border-slate-200 dark:border-slate-700 h-6">
              <span className="text-xs font-black text-slate-800 dark:text-white tracking-tighter">Leciona</span>
              <BookOpen className="text-primary w-5 h-5" />
            </div>
          </div>
        </header>

        <div className="p-3 lg:p-8 max-w-6xl mx-auto">
          {activeTab === 'dashboard' && (
            <>
              {data.settings.showQuickStartGuide && (
                <QuickStartGuide onDismiss={() => updateData({ settings: { ...data.settings, showQuickStartGuide: false } })} onNavigate={setActiveTab} />
              )}
              <Dashboard
                data={data}
                onUpdateData={updateData}
                onNavigateToLesson={(s, d) => { setPreSelectedLesson({ schedule: s, date: d }); setActiveTab('lessons'); }}
                onNavigateToReminders={() => setActiveTab('reminders')}
                onNavigateToPendencies={handleNavigateToPendencies}
                onNavigateToAssessments={() => setActiveTab('assessments')}
                onNavigateToAgenda={() => setActiveTab('agenda')}
              />
            </>
          )}
          {activeTab === 'agenda' && <AgendaManagement data={data} onUpdateData={updateData} />}
          {activeTab === 'reminders' && <ReminderManagement data={data} onUpdateData={updateData} />}
          {activeTab === 'lessons' && (
            <LessonLogger
              data={data}
              onUpdateData={updateData}
              initialLessonData={preSelectedLesson}
              onClearInitialLesson={() => setPreSelectedLesson(null)}
              defaultShowPendencies={autoShowPendencies}
              onClearShowPendencies={() => setAutoShowPendencies(false)}
            />
          )}
          {activeTab === 'assessments' && (
            <AssessmentManagement
              data={data}
              onUpdateData={updateData}
            />
          )}
          {activeTab === 'grades' && <GradesManagement data={data} onUpdateData={updateData} />}
          {activeTab === 'settings' && (
            <SettingsPanel
              data={data}
              onUpdateData={updateData}
              onSyncNow={() => { }}
              user={user}
              onLogin={handleLogin}
              onLogin={handleLogin}
              onLogout={handleLogout}
              isOnboarding={isOnboarding}
              onFinishOnboarding={() => setActiveTab('dashboard')}
            />
          )}
          {activeTab === 'private' && (
            <StudentManagement
              data={data}
              onUpdateData={updateData}
              onNavigateToLesson={(s, d) => { setPreSelectedLesson({ schedule: s, date: d }); setActiveTab('lessons'); }}
            />
          )}
        </div>
      </main>

      {/* GLOBAL NOTIFICATION POPUP */}
      {notificationPopup.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm p-6 rounded-[32px] shadow-2xl scale-100 animate-in zoom-in-95 duration-300 border border-slate-100 dark:border-slate-800">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 text-amber-500 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-xl font-black text-slate-800 dark:text-white mb-2">{notificationPopup.title}</h3>
              <p className="text-sm font-medium text-slate-500 mb-6">{notificationPopup.message}</p>
              <button
                onClick={() => setNotificationPopup(prev => ({ ...prev, isOpen: false }))}
                className="w-full py-3 bg-primary text-white rounded-xl font-black uppercase tracking-wider hover:bg-primary-dark transition-colors"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

const AppWithToast = () => {
  return (
    <ToastProvider>
      <App />
    </ToastProvider>
  );
};

export default AppWithToast;