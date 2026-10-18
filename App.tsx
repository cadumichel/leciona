import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  BookOpen,
  FileCheck,
  Settings,
  Users,
  Lightbulb,
  Cloud,
  X,
  CalendarRange,
  GraduationCap,
  AlertTriangle
} from 'lucide-react';
import { ScheduleEntry, DayOfWeek } from './types';
import { parseTimeToMinutes, getCurrentTimeInMinutes } from './utils';
import Dashboard from './components/Dashboard';
import LessonLogger from './components/LessonLogger';
import AssessmentManagement from './components/AssessmentManagement';
import AgendaManagement from './components/AgendaManagement';
import SettingsPanel from './components/SettingsPanel';
import StudentManagement from './components/StudentManagement';
import ReminderManagement from './components/ReminderManagement';

import GradesManagement from './components/GradesManagement'; // Novo Componente
import SyncStatus from './components/SyncStatus'; // Componente de Status de Sync
import { ConnectionBanner, DisconnectedPopup } from './components/ConnectionWarnings';
import { ToastProvider, useToast } from './hooks/useToast';
import { useSyncedData } from './hooks/useSyncedData';
import { useAsyncLock } from './utils/validation';
import { getSchedulesForDate } from './utils/schedule';
import { getClassName } from './utils/classRefs';

// Firebase Imports
import { auth, googleProvider } from './services/firebaseConnection';
import { signInWithPopup } from 'firebase/auth';

export { INITIAL_DATA } from './initialData';

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

/** Mostra notificação do sistema. No Android, `new Notification()` não funciona: usa o service worker. */
/** O navegador permite mostrar notificações do sistema? */
const canNotify = () => typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted';

const showSystemNotification = async (title: string, options: NotificationOptions): Promise<boolean> => {
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(title, options);
        return true;
      }
    }
    new Notification(title, options);
    return true;
  } catch (error) {
    console.warn('Não foi possível mostrar a notificação:', error);
    return false;
  }
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [preSelectedLesson, setPreSelectedLesson] = useState<{ schedule: ScheduleEntry; date: string } | null>(null);
  const [autoShowPendencies, setAutoShowPendencies] = useState(false);
  const [notificationPopup, setNotificationPopup] = useState<{ title: string; message: string; isOpen: boolean }>({ title: '', message: '', isOpen: false });
  const lastNotifiedSlot = useRef<string>('');

  const { showError, showSuccess, showWarning } = useToast();
  const { runWithLock } = useAsyncLock();

  // Dados + sincronização (hooks/useSyncedData.ts)
  const { data, user, authReady, errorSince, saveStatus, lastSavedTime, updateData, logout, restoreData, startNewSchoolYear, requestSync } =
    useSyncedData({ showError, showWarning });

  // Tema: aplica na hora (antes só depois do primeiro salvamento, ~2s após abrir)
  useEffect(() => {
    const root = document.documentElement;
    if (data.settings.darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    root.style.setProperty('--primary-color', data.settings.themeColor);
    root.style.setProperty('--primary-light', data.settings.themeColor + '15');
    root.style.setProperty('--primary-medium', data.settings.themeColor + '40');
  }, [data.settings.darkMode, data.settings.themeColor]);

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

  const handleLogout = logout;

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
        // Grade em vigor hoje (versões de horário). Antes usava a grade antiga, que não acompanhava as mudanças.
        const todaySchedules = getSchedulesForDate(data, todayStr).filter(s =>
          Number(s.dayOfWeek) === today && s.classId && s.classId !== 'window'
        );

        const hasLogFor = (schoolId: string, slotId: string) => data.logs.some(l =>
          l.date.startsWith(todayStr) && l.slotId === slotId && l.schoolId === schoolId && l.status !== 'removed'
        );

        todaySchedules.forEach(s => {
          const school = data.schools.find(sc => sc.id === s.schoolId);
          if (!school || school.deleted) return;
          const shift = school.shifts.find(sh => sh.id === s.shiftId);
          const slot = shift?.slots.find(sl => sl.id === s.slotId);
          if (!slot || !shift) return;

          // Só os horários em que o professor tem aula hoje neste turno
          const myShiftSlots = shift.slots.filter(sl =>
            sl.type === 'class' && todaySchedules.some(ts => ts.schoolId === s.schoolId && ts.shiftId === shift.id && ts.slotId === sl.id)
          );
          const lastSlotOfShift = myShiftSlots.length > 0
            ? myShiftSlots.reduce((a, b) => parseTimeToMinutes(a.endTime) >= parseTimeToMinutes(b.endTime) ? a : b)
            : null;
          const isLastLesson = lastSlotOfShift?.id === s.slotId;

          const endMins = parseTimeToMinutes(slot.endTime);

          let triggerMins = endMins - data.settings.alertBeforeMinutes;
          // Se for a última aula E alerta de turno estiver ativo, usa o delay configurado
          if (isLastLesson && data.settings.alertAfterShift) {
            triggerMins = endMins + (data.settings.alertAfterShiftDelay || 0);
          }

          // Se "Alerta por Aula" estiver OFF, mas "Alerta por Turno" estiver ON -> Dispara APENAS na última.
          const shouldAlert = data.settings.alertAfterLesson || (data.settings.alertAfterShift && isLastLesson);

          // Verifica se está no momento do disparo (com janela de 5 min)
          if (shouldAlert && nowMins >= triggerMins && nowMins < triggerMins + 5) {
            const slotKey = `${todayStr}-${s.schoolId}-${s.slotId}`;
            if (lastNotifiedSlot.current === slotKey) return;

            const hasLog = hasLogFor(s.schoolId, s.slotId);
            const className = getClassName(data, s.schoolId, s.classId);

            let pendingCount = 0;
            if (isLastLesson && data.settings.alertAfterShift) {
              // Pendências do turno: só aulas do professor que já terminaram e não têm registro
              pendingCount = myShiftSlots.filter(sl =>
                parseTimeToMinutes(sl.endTime) <= endMins && !hasLogFor(s.schoolId, sl.id)
              ).length;
              if (pendingCount === 0 && hasLog) return;
            } else if (hasLog) {
              return;
            }

            let msg = '';
            if (isLastLesson && data.settings.alertAfterShift && pendingCount > 0) {
              msg = `O turno na ${school.name} acabou. Você tem ${pendingCount} aula(s) sem registro!`;
            } else if (!hasLog) {
              msg = `A aula do ${className} está terminando. Registre o conteúdo!`;
            }
            if (!msg) return;

            lastNotifiedSlot.current = slotKey;
            const title = isLastLesson && data.settings.alertAfterShift ? 'Fim de Turno' : 'Fim de Aula';

            if (data.settings.alertType === 'popup' || !canNotify()) {
              // Sem permissão de notificação, o aviso aparece na tela (antes se perdia)
              setNotificationPopup({ title, message: msg, isOpen: true });
            } else {
              const style = data.settings.alertNotificationStyle || 'sound';
              const options: NotificationOptions = { body: msg, silent: style !== 'sound', tag: slotKey };
              if (style === 'vibration' && navigator.vibrate) navigator.vibrate([200, 100, 200]);
              void showSystemNotification('Leciona: Lembrete de Registro', options).then(ok => {
                if (!ok) setNotificationPopup({ title, message: msg, isOpen: true });
              });
            }
          }
        });
      }

      // 2. Verificação de Alarmes de Lembretes
      const dueReminders = data.reminders.filter(reminder => {
        if (!reminder.alarmTime || reminder.alarmTriggered) return false;
        const diffMs = new Date(reminder.alarmTime).getTime() - Date.now();
        // Dispara se já passou da hora e ainda não disparou (até 24h de atraso)
        return diffMs <= 0 && diffMs > -86400000;
      });
      if (dueReminders.length > 0) {
        // Modo "popup" ou notificações bloqueadas: mostra na tela. Antes o lembrete era marcado
        // como avisado mesmo sem aparecer nada.
        const showOnScreen = (list: typeof dueReminders) => {
          if (!list.length) return;
          setNotificationPopup({
            title: list.length === 1 ? `Lembrete: ${list[0].title}` : `${list.length} lembretes`,
            message: list.map(r => (list.length === 1 ? r.content : `• ${r.title}${r.content ? `: ${r.content}` : ''}`)).join('\n'),
            isOpen: true
          });
        };
        if (data.settings.alertType === 'popup' || !canNotify()) {
          showOnScreen(dueReminders);
        } else {
          void Promise.all(dueReminders.map(reminder =>
            showSystemNotification(`Lembrete: ${reminder.title}`, { body: reminder.content, tag: `reminder-${reminder.id}` })
          )).then(results => showOnScreen(dueReminders.filter((_, i) => !results[i])));
        }
        const dueIds = new Set(dueReminders.map(r => r.id));
        updateData({
          reminders: data.reminders.map(r => dueIds.has(r.id) ? { ...r, alarmTriggered: true } : r)
        });
      }
    };

    // Solicita permissão ao carregar se necessário
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    const interval = setInterval(checkContentAlerts, 30000); // Verifica a cada 30s
    return () => clearInterval(interval);
  }, [data, updateData]);

  const isSyncing = saveStatus === 'saving';
  // Conta Google desconectada: o que se registra fica só neste aparelho (components/ConnectionWarnings.tsx)
  const disconnected = authReady && !user;
  const connectAccount = () => { void handleLogin(); };

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
    <div className={`flex flex-col lg:flex-row min-h-screen transition-colors duration-300 bg-slate-100 dark:bg-slate-950 w-full`}>
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
              {isSyncing ? <Cloud className="animate-bounce text-primary" size={14} /> :
                saveStatus === 'pending' ? <div className="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></div> :
                  saveStatus === 'error' ? <div className="w-2 h-2 bg-red-500 rounded-full"></div> :
                    user ? <div className="w-2 h-2 bg-green-500 rounded-full"></div> : null}
            </div>
          </div>
        </aside>
      )}

      <main className="flex-1 min-w-0 w-full pb-24 lg:pb-0" style={{ overflowX: 'clip' }}>
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
                  isSaving={isSyncing}
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

        {!isOnboarding && (
          <ConnectionBanner disconnected={disconnected} errorSince={errorSince} onConnect={connectAccount} onRetry={requestSync} />
        )}

        {/* No computador, as telas (menos o Início) têm menos margem em cima */}
        <div className={`px-3 py-3 lg:px-8 ${activeTab === 'dashboard' ? 'lg:py-8' : 'lg:py-5'} max-w-6xl mx-auto w-full`}>
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
              disconnected={disconnected}
              onConnect={connectAccount}
            />
          )}
          {activeTab === 'assessments' && (
            <AssessmentManagement
              data={data}
              onUpdateData={updateData}
              disconnected={disconnected}
              onConnect={connectAccount}
            />
          )}
          {activeTab === 'grades' && <GradesManagement data={data} onUpdateData={updateData} />}
          {activeTab === 'settings' && (
            <SettingsPanel
              data={data}
              onUpdateData={updateData}
              onSyncNow={requestSync}
              onRestoreData={restoreData}
              onStartNewYear={startNewSchoolYear}
              user={user}
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

      <DisconnectedPopup show={disconnected && !isOnboarding} onConnect={connectAccount} />

      {/* GLOBAL NOTIFICATION POPUP */}
      {notificationPopup.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm p-6 rounded-[32px] shadow-2xl scale-100 animate-in zoom-in-95 duration-300 border border-slate-100 dark:border-slate-800">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 text-amber-500 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-xl font-black text-slate-800 dark:text-white mb-2">{notificationPopup.title}</h3>
              <p className="text-sm font-medium text-slate-500 mb-6 whitespace-pre-line">{notificationPopup.message}</p>
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