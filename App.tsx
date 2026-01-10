import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { parseTimeToMinutes, getCurrentTimeInMinutes } from './utils';
import Dashboard from './components/Dashboard';
import LessonLogger from './components/LessonLogger';
import AssessmentManagement from './components/AssessmentManagement';
import AgendaManagement from './components/AgendaManagement';
import SettingsPanel from './components/SettingsPanel';
import StudentManagement from './components/StudentManagement';
import ReminderManagement from './components/ReminderManagement';
import GradesManagement from './components/GradesManagement'; // Novo Componente

// Firebase Imports
import { auth, db, googleProvider } from './services/firebaseConnection';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

const STORAGE_KEY = 'leciona-data-v1';

const INITIAL_DATA: AppData = {
  profile: { name: '', subjects: [] },
  schools: [],
  students: [],
  classRecords: [],
  schedules: [],
  logs: [],
  events: [],
  calendars: [],
  reminders: [],
  grades: [], // Inicializa array de notas
  customAssessments: [], // Inicializa array de avaliações personalizadas
  gradingConfigs: [], // Inicializa configurações de média
  settings: {
    alertBeforeMinutes: 5,
    alertAfterLesson: true,
    alertAfterShift: true,
    isPrivateTeacher: false,
    googleSyncEnabled: false,
    showQuickStartGuide: true,
    themeColor: '#2563eb', 
    darkMode: false,
    showDailyQuote: true,
    advancedModes: { 
      attendance: false,
      individualOccurrence: false,
      grades: false
    }
  }
};

export const QuickStartGuide: React.FC<{ onDismiss: () => void; onNavigate: (tab: string) => void }> = ({ onDismiss, onNavigate }) => (
  <div className="bg-primary text-white p-5 md:p-8 rounded-[32px] md:rounded-[40px] shadow-xl shadow-primary/20 mb-6 md:mb-8 relative overflow-hidden animate-in fade-in zoom-in-95 duration-500">
    <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
      <Lightbulb size={80} className="md:w-[120px] md:h-[120px]" />
    </div>
    <button onClick={onDismiss} className="absolute top-4 right-4 md:top-6 md:right-6 p-2 hover:bg-white/20 rounded-full transition-colors z-20">
      <X size={18} />
    </button>
    <div className="relative z-10">
      <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Bem-Vindo</span>
      <h2 className="text-xl md:text-2xl font-black mt-1 mb-2 tracking-tight">Vamos começar?</h2>
      <p className="text-xs md:text-sm font-medium opacity-90 mb-6 max-w-3xl leading-relaxed">
        Para iniciar, vá ao menu e clique em Ajustes <Settings size={16} className="inline-block mb-1" /> e cadastre seu perfil, insira as informações sobre as instituições em que trabalha, configure as datas de seu ano letivo e os horários de aula de sua grade.
        <br /><br />
        Com estas informações o Leciona está pronto para facilitar sua rotina docente!
      </p>
      
      <div className="bg-black/20 p-4 rounded-2xl border border-white/10 text-center">
        <p className="text-[10px] md:text-xs font-bold leading-relaxed">
          Atenção: Este app é sincronizado com a nuvem a partir da conexão com sua conta Google. Garanta que ela está ativa nos ajustes. Um sinal verde no canto superior direito do app mostra que está tudo salvo!
        </p>
      </div>
    </div>
  </div>
);

// Função Auxiliar para Mesclar Arrays por ID
const mergeArrays = <T extends { id: string }>(cloudArr: T[] = [], localArr: T[] = []): T[] => {
  const map = new Map<string, T>();
  
  // Prioridade: Cloud (para atualizações) -> Local (para novos itens não sincronizados)
  // 1. Adiciona itens da nuvem
  cloudArr.forEach(item => map.set(item.id, item));
  
  // 2. Adiciona itens locais que NÃO estão na nuvem (preserva criações offline/recentes)
  localArr.forEach(item => {
    if (!map.has(item.id)) {
      map.set(item.id, item);
    }
  });
  
  return Array.from(map.values());
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
  
  const lastNotifiedSlot = useRef<string>('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    
    const sanitized = sanitize(cloudData) as AppData;

    // Garantir que campos novos existam para evitar crash em modos avançados
    return {
        ...INITIAL_DATA, // Garante estrutura base
        ...sanitized,
        classRecords: sanitized.classRecords || [],
        grades: sanitized.grades || [],
        customAssessments: sanitized.customAssessments || [],
        gradingConfigs: sanitized.gradingConfigs || [],
        settings: {
            ...INITIAL_DATA.settings,
            ...sanitized.settings,
            advancedModes: {
                ...INITIAL_DATA.settings.advancedModes,
                ...(sanitized.settings?.advancedModes || {})
            }
        }
    };
  };

  // Monitorar Autenticação e Carregar Dados do Firestore
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setIsSyncing(true);
        try {
          const docRef = doc(db, "users", currentUser.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const rawData = docSnap.data();
            const cloudData = sanitizeFirestoreData(rawData);
            
            // Mesclagem Inteligente: Cloud vs Local
            // Evita que dados locais recém-criados (que ainda não subiram) sejam sobrescritos pelo Cloud antigo
            const localData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<AppData>;

            const mergedData: AppData = {
                ...cloudData,
                // Mescla arrays críticos usando IDs
                events: mergeArrays(cloudData.events, localData.events),
                reminders: mergeArrays(cloudData.reminders, localData.reminders),
                logs: mergeArrays(cloudData.logs, localData.logs),
                schools: mergeArrays(cloudData.schools, localData.schools),
                students: mergeArrays(cloudData.students, localData.students),
                // Outros campos assumem preferência da Cloud (configurações, perfil, etc)
                settings: {
                    ...cloudData.settings,
                    googleSyncEnabled: true
                }
            };
            
            setData(mergedData);
          } else {
            // Primeiro login ou sem dados na nuvem: Salva o estado local na nuvem
            await setDoc(docRef, {
                ...data,
                settings: { ...data.settings, googleSyncEnabled: true }
            });
          }
        } catch (error) {
          console.error("Erro ao buscar dados do Firestore:", error);
        } finally {
          setIsSyncing(false);
        }
      } else {
        setData(prev => ({ ...prev, settings: { ...prev.settings, googleSyncEnabled: false }}));
      }
    });
    return () => unsubscribe();
  }, []);

  // Salvar no LocalStorage (Offline) e Sync (Online)
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    
    if (data.settings.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    const root = document.documentElement;
    root.style.setProperty('--primary-color', data.settings.themeColor);
    root.style.setProperty('--primary-light', data.settings.themeColor + '15');
    root.style.setProperty('--primary-medium', data.settings.themeColor + '40');

    if (user) {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        
        // Reduzido para 1.5s para garantir salvamento mais rápido
        timeoutRef.current = setTimeout(async () => {
            setIsSyncing(true);
            try {
                const dataToSave = {
                    ...data,
                    settings: {
                        ...data.settings,
                        lastSyncAt: new Date().toISOString()
                    }
                };
                await setDoc(doc(db, "users", user.uid), dataToSave);
                setData(prev => ({ ...prev, settings: { ...prev.settings, lastSyncAt: new Date().toISOString() }}));
            } catch (error) {
                console.error("Erro ao salvar no Firestore:", error);
            } finally {
                setIsSyncing(false);
            }
        }, 1500); 
    }

  }, [data, user]);

  // Funções de Autenticação - FIX: Mensagens de erro claras
  const handleLogin = async () => {
    try {
        await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
        console.error("Erro no login:", error);
        let msg = "Erro ao conectar conta Google.";
        if (error.code === 'auth/popup-closed-by-user') msg = "Login cancelado pelo usuário.";
        if (error.code === 'auth/unauthorized-domain') msg = "Domínio não autorizado no Firebase.";
        alert(msg);
    }
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
            const triggerMins = endMins - data.settings.alertBeforeMinutes;
            
            // Lógica de Disparo:
            // Se "Alerta por Aula" estiver ativo -> Dispara em todas.
            // Se "Alerta por Aula" estiver OFF, mas "Alerta por Turno" estiver ON -> Dispara APENAS na última.
            const shouldAlert = data.settings.alertAfterLesson || (data.settings.alertAfterShift && isLastLesson);

            if (shouldAlert && nowMins >= triggerMins && nowMins < endMins + 5) {
              const slotKey = `${todayStr}-${s.slotId}`;
              if (lastNotifiedSlot.current !== slotKey) {
                const hasLog = data.logs.some(l => l.date.startsWith(todayStr) && l.slotId === s.slotId);
                if (!hasLog) {
                  lastNotifiedSlot.current = slotKey;
                  if ("Notification" in window && Notification.permission === "granted") {
                    const msg = isLastLesson && data.settings.alertAfterShift 
                        ? `O turno na ${school?.name} está acabando. Verifique seus registros!`
                        : `A aula de ${s.classId} está terminando. Registre o conteúdo!`;
                    new Notification("Leciona: Lembrete de Registro", { body: msg });
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
                  updateData({
                      reminders: data.reminders.map(r => r.id === reminder.id ? { ...r, alarmTriggered: true } : r)
                  });
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

  const navItems = [
    { id: 'dashboard', label: 'Início', icon: LayoutDashboard },
    { id: 'lessons', label: 'Diário', icon: BookOpen },
    { id: 'assessments', label: 'Avaliações', icon: FileCheck },
    ...(data.settings.advancedModes?.grades ? [{ id: 'grades', label: 'Notas', icon: GraduationCap }] : []), // Botão Condicional Seguro
    { id: 'agenda', label: 'Agenda', icon: CalendarDays },
    { id: 'reminders', label: 'Lembretes', icon: Lightbulb },
    ...(data.settings.isPrivateTeacher ? [{ id: 'students', label: 'Alunos', icon: Users }] : []),
    { id: 'settings', label: 'Ajustes', icon: Settings },
  ];

  return (
    <div className={`flex flex-col md:flex-row min-h-screen transition-colors duration-300 bg-slate-50 dark:bg-slate-950`}>
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

      {/* Menu Mobile Compacto */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t dark:border-slate-800 z-50 flex justify-between px-4 py-2 safe-area-bottom shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] overflow-x-auto">
        {navItems.map(item => (
          <button key={item.id} onClick={() => { setActiveTab(item.id); if (item.id !== 'lessons') setPreSelectedLesson(null); }} className={`flex flex-col items-center justify-center p-1 min-w-[50px] rounded-xl transition-all ${activeTab === item.id ? 'text-primary' : 'text-slate-400 dark:text-slate-500'}`}>
            <item.icon size={20} className={activeTab === item.id ? 'mb-0.5' : 'mb-0'} />
            {activeTab === item.id && <span className="text-[9px] font-black tracking-tight">{item.label}</span>}
          </button>
        ))}
      </nav>

      <aside className="hidden md:flex flex-col w-64 bg-white dark:bg-slate-900 border-r dark:border-slate-800 min-h-screen sticky top-0 transition-colors">
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
             {isSyncing ? <Cloud className="animate-bounce text-primary" size={14} /> : user ? <div className="w-2 h-2 bg-green-500 rounded-full"></div> : null}
           </div>
        </div>
      </aside>

      <main className="flex-1 pb-24 md:pb-0 overflow-x-hidden">
        <header className="bg-white dark:bg-slate-900 border-b dark:border-slate-800 px-4 py-3 md:px-6 md:py-4 flex justify-between items-center sticky top-0 z-40 transition-colors shadow-sm md:shadow-none">
          <h2 className="text-lg md:text-xl font-black text-slate-800 dark:text-white truncate max-w-[150px] md:max-w-none">{navItems.find(i => i.id === activeTab)?.label}</h2>
          
          <div className="flex items-center gap-3">
            {/* Branding Mobile - Só aparece em telas pequenas */}
            <div className="md:hidden flex items-center gap-1.5 opacity-100">
               <BookOpen className="text-primary w-4 h-4" />
               <span className="text-xs font-black text-slate-800 dark:text-white tracking-tighter">Leciona</span>
            </div>

            {user && (
              <div className="flex items-center gap-2 text-[9px] md:text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest pl-3 border-l border-slate-200 dark:border-slate-700 md:border-none md:pl-0">
                {isSyncing ? <span className="hidden md:inline">Salvando...</span> : <span className="hidden md:inline">{data.settings.lastSyncAt ? new Date(data.settings.lastSyncAt).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : 'Agora'}</span>}
                <div className={`w-2 h-2 rounded-full ${isSyncing ? 'bg-amber-400 animate-pulse' : 'bg-green-500'}`} />
              </div>
            )}
          </div>
        </header>

        <div className="p-3 md:p-8 max-w-6xl mx-auto">
          {activeTab === 'dashboard' && (
            <>
              {data.settings.showQuickStartGuide && (
                <QuickStartGuide onDismiss={() => updateData({ settings: { ...data.settings, showQuickStartGuide: false }})} onNavigate={setActiveTab} />
              )}
              <Dashboard 
                data={data} 
                onUpdateData={updateData} 
                onNavigateToLesson={(s, d) => { setPreSelectedLesson({ schedule: s, date: d }); setActiveTab('lessons'); }} 
                onNavigateToReminders={() => setActiveTab('reminders')}
                onNavigateToPendencies={handleNavigateToPendencies}
              />
            </>
          )}
          {activeTab === 'students' && <StudentManagement data={data} onUpdateData={updateData} />}
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
          {activeTab === 'assessments' && <AssessmentManagement data={data} onUpdateData={updateData} />}
          {activeTab === 'grades' && <GradesManagement data={data} onUpdateData={updateData} />}
          {activeTab === 'settings' && (
            <SettingsPanel 
                data={data} 
                onUpdateData={updateData} 
                onSyncNow={() => {}} 
                user={user}
                onLogin={handleLogin}
                onLogout={handleLogout}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default App;