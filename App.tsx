import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import {
  LayoutDashboard,
  BookOpen,
  FileCheck,
  Settings,
  Users,
  Lightbulb,
  Cloud,
  CalendarRange,
  GraduationCap,
  AlertTriangle,
  MoreHorizontal
} from 'lucide-react';
import { ScheduleEntry, DayOfWeek } from './types';
import { todayLocal } from './utils';
import Dashboard from './components/Dashboard';
import LessonLogger from './components/LessonLogger';
import { QuickStartGuide } from './components/QuickStartGuide';

// Telas carregadas só quando abertas (Início e Diário já vêm no primeiro carregamento).
// Depois que o app abre, elas são baixadas em segundo plano, para o primeiro toque ser imediato.
const loadAssessments = () => import('./components/AssessmentManagement');
const loadAgenda = () => import('./components/AgendaManagement');
const loadSettings = () => import('./components/SettingsPanel');
const loadStudents = () => import('./components/StudentManagement');
const loadReminders = () => import('./components/ReminderManagement');
const loadGrades = () => import('./components/GradesManagement');
const AssessmentManagement = lazy(loadAssessments);
const AgendaManagement = lazy(loadAgenda);
const SettingsPanel = lazy(loadSettings);
const StudentManagement = lazy(loadStudents);
const ReminderManagement = lazy(loadReminders);
const GradesManagement = lazy(loadGrades);
import SyncStatus from './components/SyncStatus'; // Componente de Status de Sync
import { ConnectionBanner, DisconnectedPopup } from './components/ConnectionWarnings';
import { ToastProvider, useToast } from './hooks/useToast';
import AppDialogs from './components/AppDialogs';
import { useSyncedData } from './hooks/useSyncedData';
import { useBackClose } from './hooks/useBackClose';
import { useAsyncLock } from './utils/validation';
import { getSchedulesForDate } from './utils/schedule';
import { calcularAvisos, momentoEmBrasilia } from './utils/avisos';
import { avisosAtivosNesteAparelho, avisosNaoVistos, manterAvisos, marcarAvisosVistos } from './utils/avisosAparelho';

// Firebase Imports
import { auth, googleProvider } from './services/firebaseConnection';
import { signInWithPopup } from 'firebase/auth';

export { INITIAL_DATA } from './initialData';
export { QuickStartGuide };

/** Enquanto uma tela ainda está sendo baixada (só no primeiro toque, e raramente) */
const ScreenLoading: React.FC = () => (
  <div className="flex items-center justify-center py-24 text-slate-400" role="status" aria-label="Carregando">
    <div className="w-6 h-6 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
  </div>
);

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [preSelectedLesson, setPreSelectedLesson] = useState<{ schedule: ScheduleEntry; date: string } | null>(null);
  const [autoShowPendencies, setAutoShowPendencies] = useState(false);
  const [notificationPopup, setNotificationPopup] = useState<{ title: string; message: string; isOpen: boolean; destino?: string }>({ title: '', message: '', isOpen: false });

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

  // --- AVISOS ---
  // As notificações no celular são enviadas pelo servidor (Ajustes → Avisos; connector/avisosPush.ts).
  // Aqui: (1) num aparelho sem notificações ativas, o mesmo aviso aparece na tela enquanto o app
  // está aberto; (2) tocar na notificação abre a tela certa.
  const abrirDestino = useCallback((destino: string | null | undefined) => {
    if (destino === 'pendencias') { setAutoShowPendencies(true); setActiveTab('lessons'); }
    else if (destino === 'lembretes') setActiveTab('reminders');
    else if (destino === 'ajustes') setActiveTab('settings');
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const destino = params.get('abrir');
    if (destino) {
      abrirDestino(destino);
      params.delete('abrir');
      const resto = params.toString();
      window.history.replaceState(window.history.state, '', window.location.pathname + (resto ? `?${resto}` : ''));
    }
    if (!('serviceWorker' in navigator)) return;
    const aoReceber = (e: MessageEvent) => { if (e.data?.tipo === 'leciona-abrir') abrirDestino(e.data.destino); };
    navigator.serviceWorker.addEventListener('message', aoReceber);
    return () => navigator.serviceWorker.removeEventListener('message', aoReceber);
  }, [abrirDestino]);

  // Confirma no servidor o cadastro deste aparelho (uma vez por dia)
  useEffect(() => { if (user) void manterAvisos(); }, [user]);

  useEffect(() => {
    const conferirAvisos = () => {
      const agoraLocal = `${todayLocal()}T${new Date().toTimeString().slice(0, 5)}`;
      // Lembretes cujo alarme já passou ficam marcados como avisados (o sino para de piscar)
      const vencidos = data.reminders.filter(r => r.alarmTime && !r.alarmTriggered && r.alarmTime.slice(0, 16) <= agoraLocal);

      // Com as notificações ativas neste aparelho, o aviso chega pelo servidor: não repete na tela
      if (!avisosAtivosNesteAparelho() && data.profile.setupCompleted) {
        const novos = avisosNaoVistos(calcularAvisos(data, momentoEmBrasilia()).avisos);
        if (novos.length) {
          marcarAvisosVistos(novos.map(a => a.chave));
          setNotificationPopup({
            title: novos.length === 1 ? novos[0].titulo : `${novos.length} avisos`,
            message: novos.length === 1 ? novos[0].texto.replace(' Toque para abrir as pendências.', '') : novos.map(a => `• ${a.titulo}`).join('\n'),
            destino: novos.some(a => a.destino === 'pendencias') ? 'pendencias' : novos[0].destino,
            isOpen: true
          });
        }
      }

      if (vencidos.length) {
        const ids = new Set(vencidos.map(r => r.id));
        updateData({ reminders: data.reminders.map(r => (ids.has(r.id) ? { ...r, alarmTriggered: true } : r)) });
      }
    };

    const interval = setInterval(conferirAvisos, 30000); // Verifica a cada 30s
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

  // Voltar do celular numa aba fora do Início volta para o Início (em vez de sair do app)
  useBackClose(activeTab !== 'dashboard' && !isOnboarding, () => setActiveTab('dashboard'));
  // Voltar do celular com o menu "Mais" aberto: fecha só o menu
  useBackClose(isMoreOpen && !isOnboarding, () => setIsMoreOpen(false));

  // Baixa as outras telas em segundo plano logo depois que o app abre
  useEffect(() => {
    const prefetch = () => {
      [loadAssessments, loadAgenda, loadReminders, loadSettings, loadGrades, loadStudents].forEach(load => {
        load().catch(() => { /* sem internet: a tela é baixada quando for aberta */ });
      });
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(prefetch);
    else setTimeout(prefetch, 1500);
  }, []);

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

  // Celular: abas fixas na barra de baixo; as outras ficam no "Mais"
  const MOBILE_MAIN = ['dashboard', 'lessons', 'assessments', 'agenda'];
  const mobileMainItems = navItems.filter(i => MOBILE_MAIN.includes(i.id));
  const mobileMoreItems = navItems.filter(i => !MOBILE_MAIN.includes(i.id));
  const goToTab = (id: string) => {
    setActiveTab(id);
    if (id !== 'lessons') setPreSelectedLesson(null);
    setIsMoreOpen(false);
  };

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


      {/* Menu do celular: 4 abas fixas com nome + "Mais" (Lembretes, Notas, Particulares, Ajustes) */}
      {!isOnboarding && (
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t dark:border-slate-800 z-50 grid grid-cols-5 px-1 pt-1.5 pb-2 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
          {mobileMainItems.map(item => {
            const active = activeTab === item.id;
            return (
              <button key={item.id} onClick={() => goToTab(item.id)} aria-current={active ? 'page' : undefined} className={`flex flex-col items-center justify-center gap-0.5 min-h-[48px] rounded-xl transition-colors ${active ? 'text-primary' : 'text-slate-500 dark:text-slate-400'}`}>
                <item.icon size={22} strokeWidth={active ? 2.4 : 2} />
                <span className={`text-[11px] leading-tight tracking-tight ${active ? 'font-black' : 'font-semibold'}`}>{item.label}</span>
              </button>
            );
          })}
          {(() => {
            const activeMore = mobileMoreItems.find(i => i.id === activeTab);
            const highlighted = !!activeMore || isMoreOpen;
            const Icon = activeMore ? activeMore.icon : MoreHorizontal;
            return (
              <button onClick={() => setIsMoreOpen(o => !o)} aria-expanded={isMoreOpen} className={`flex flex-col items-center justify-center gap-0.5 min-h-[48px] rounded-xl transition-colors ${highlighted ? 'text-primary' : 'text-slate-500 dark:text-slate-400'}`}>
                <Icon size={22} strokeWidth={highlighted ? 2.4 : 2} />
                <span className={`text-[11px] leading-tight tracking-tight ${highlighted ? 'font-black' : 'font-semibold'}`}>{activeMore ? activeMore.label : 'Mais'}</span>
              </button>
            );
          })()}
        </nav>
      )}

      {/* Folha do "Mais" (celular) */}
      {!isOnboarding && isMoreOpen && (
        <div className="lg:hidden fixed inset-0 z-[45] bg-slate-900/30" onClick={() => setIsMoreOpen(false)}>
          <div className="absolute left-2 right-2 bottom-[76px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 p-2 animate-in slide-in-from-bottom-4" onClick={e => e.stopPropagation()}>
            {mobileMoreItems.map(item => {
              const active = activeTab === item.id;
              return (
                <button key={item.id} onClick={() => goToTab(item.id)} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-colors ${active ? 'bg-primary-light text-primary' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                  <item.icon size={20} />
                  <span className="text-sm font-bold">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
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
          <Suspense fallback={<ScreenLoading />}>
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
          </Suspense>
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
              {notificationPopup.destino === 'pendencias' || notificationPopup.destino === 'lembretes' ? (
                <div className="w-full flex flex-col gap-2">
                  <button
                    onClick={() => { abrirDestino(notificationPopup.destino); setNotificationPopup(prev => ({ ...prev, isOpen: false })); }}
                    className="w-full py-3 bg-primary text-white rounded-xl font-black uppercase tracking-wider transition-colors"
                  >
                    {notificationPopup.destino === 'pendencias' ? 'Abrir pendências' : 'Abrir lembretes'}
                  </button>
                  <button
                    onClick={() => setNotificationPopup(prev => ({ ...prev, isOpen: false }))}
                    className="w-full py-2.5 text-slate-500 dark:text-slate-400 rounded-xl font-black uppercase tracking-wider text-xs"
                  >
                    Agora não
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setNotificationPopup(prev => ({ ...prev, isOpen: false }))}
                  className="w-full py-3 bg-primary text-white rounded-xl font-black uppercase tracking-wider hover:bg-primary-dark transition-colors"
                >
                  Entendido
                </button>
              )}
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
      <AppDialogs />
    </ToastProvider>
  );
};

export default AppWithToast;