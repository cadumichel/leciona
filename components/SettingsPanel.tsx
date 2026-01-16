import React, { useState, useMemo, useEffect } from 'react';
import { AppData, AcademicCalendar, Term, Recess, ClassRecord, ClassStudent } from '../types';
import {
   Download, User, Briefcase, Calendar as CalendarIcon, ShieldCheck,
   RefreshCw, LogOut, BookOpen, FileCheck, Palette, Moon, Sun,
   ChevronDown, AlertTriangle, Lightbulb, Quote, School as SchoolIcon,
   CalendarClock, GraduationCap, Wand2, Palmtree, CalendarRange, Trash2,
   CheckCircle2, Edit3, Settings, LogIn, Plus, Users, LayoutList, ClipboardCheck,
   Archive, RotateCcw, Clock, AlertCircle, Check, Bell, MessageSquare, Volume2, Smartphone, BellOff,
   Sparkles, Scissors, FileText, Copy, UserMinus, LayoutGrid
} from 'lucide-react';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebaseConnection';
import { downloadCSV, downloadICS } from '../utils';
import { QuickStartGuide, INITIAL_DATA } from '../App';
import SchoolManagement from './SchoolManagement';
import ScheduleManagement from './ScheduleManagement';
import StudentManagement from './StudentManagement';
import { processStudentList, ProcessedStudent, FormatMode } from '../utils/studentListProcessor';
import { parseHolidayList, ParsedHoliday } from '../utils/holidayParser';
import { User as FirebaseUser } from 'firebase/auth';

interface SettingsPanelProps {
   data: AppData;
   onUpdateData: (newData: Partial<AppData>) => void;
   onSyncNow: () => void;
   user?: FirebaseUser | null;
   onLogin?: (forceAccountSelection?: boolean) => void;
   onLogout?: () => void;
   isOnboarding?: boolean;
   onFinishOnboarding?: () => void;
}

const THEME_COLORS = [
   { name: 'Azul', value: '#2563eb' },
   { name: 'Verde', value: '#064e3b' },
   { name: 'Verde Claro', value: '#84cc16' },
   { name: 'Vermelho', value: '#dc2626' },
   { name: 'Rosa', value: '#ec4899' },
   { name: 'Vinho', value: '#881337' },
   { name: 'Laranja', value: '#f97316' },
   { name: 'Preto', value: '#0f172a' },
   { name: 'Amarelo', value: '#facc15' },
];

const SettingsPanel: React.FC<SettingsPanelProps> = ({ data, onUpdateData, onSyncNow, user, onLogin, onLogout, isOnboarding = false, onFinishOnboarding }) => {
   const [activeSubTab, setActiveSubTab] = useState<'general' | 'schools' | 'calendar' | 'schedules' | 'classes' | 'students' | 'privatestudents'>('general');

   // Estados para Filtros de Exportação
   const [filterInstId, setFilterInstId] = useState<string>('all');
   const [filterClassId, setFilterClassId] = useState<string>('all');
   const [filterPeriodIdx, setFilterPeriodIdx] = useState<string>('all'); // Novo filtro

   const [saveSuccess, setSaveSuccess] = useState(false);
   const [addStudentSuccess, setAddStudentSuccess] = useState(false); // Novo estado para sucesso de adição de aluno
   const [showAlertInfo, setShowAlertInfo] = useState(false); // Estado para info de alertas
   const [acceptedNoLogin, setAcceptedNoLogin] = useState(false); // Estado para aceite de prosseguir sem Google

   // Estados para Gestão de Calendário 
   const [activeSchoolIdForCal, setActiveSchoolIdForCal] = useState<string>(data.schools[0]?.id || '');
   const schoolCalendar = useMemo(() => data.calendars.find(c => c.schoolId === activeSchoolIdForCal), [data.calendars, activeSchoolIdForCal]);
   const activeSchoolColorForCal = useMemo(() => data.schools.find(s => s.id === activeSchoolIdForCal)?.color, [data.schools, activeSchoolIdForCal]);

   const [calForm, setCalForm] = useState<Partial<AcademicCalendar>>({
      division: 'trimestres',  // Default to trimestres
      year: new Date().getFullYear(),
      start: `${new Date().getFullYear()}-02-01`,
      end: `${new Date().getFullYear()}-12-01`,
      terms: [],
      midYearBreak: { start: `${new Date().getFullYear()}-07-01`, end: `${new Date().getFullYear()}-07-31` },
      extraRecesses: []
   });

   // Estados para Gestão de Alunos por Turma
   const [rosterSchoolId, setRosterSchoolId] = useState<string>('');
   const [rosterClassId, setRosterClassId] = useState<string>('');
   const [newStudentsText, setNewStudentsText] = useState<string>('');
   const [showArchived, setShowArchived] = useState(false);

   // Estados para Processamento de Lista
   const [processedList, setProcessedList] = useState<ProcessedStudent[]>([]);
   const [showPreviewTable, setShowPreviewTable] = useState(false);
   const [formatMode, setFormatMode] = useState<FormatMode>('intelligent');
   const [editedNames, setEditedNames] = useState<string[]>([]);

   // Estados para Importação de Recessos
   const [holidayImportMode, setHolidayImportMode] = useState(false);
   const [holidayImportText, setHolidayImportText] = useState('');
   const [parsedHolidays, setParsedHolidays] = useState<ParsedHoliday[]>([]);

   // Estado para Cópia de Recesso
   const [copyingRecess, setCopyingRecess] = useState<Recess | null>(null);

   const availableInstitutions = useMemo(() => {
      return [
         ...data.schools.filter(s => !s.deleted).map(s => ({ id: s.id, name: s.name })),
         ...data.students.map(st => ({ id: st.id, name: st.name + " (Particular)" }))
      ];
   }, [data.schools, data.students]);

   const availableClasses = useMemo(() => {
      if (filterInstId === 'all') {
         return Array.from(new Set([
            ...data.schools.filter(s => !s.deleted).flatMap(s => s.classes ? s.classes.filter(c => typeof c === 'string' || !c.deleted).map(c => typeof c === 'string' ? c : c.name) : []),
            ...data.students.map(st => st.name)
         ]));
      }
      const school = data.schools.find(s => s.id === filterInstId);
      if (school && !school.deleted) return school.classes ? school.classes.filter(c => typeof c === 'string' || !c.deleted).map(c => typeof c === 'string' ? c : c.name) : [];
      const student = data.students.find(st => st.id === filterInstId);
      if (student) return [student.name];
      return [];
   }, [data.schools, data.students, filterInstId]);

   // Opções de período baseadas na instituição selecionada
   const periodOptions = useMemo(() => {
      if (filterInstId === 'all') return [];
      const calendar = data.calendars.find(c => c.schoolId === filterInstId);
      if (!calendar) return [];
      return calendar.terms.map((t, idx) => ({ label: t.name, value: idx.toString() }));
   }, [data.calendars, filterInstId]);

   // Helper para verificar se uma data está dentro do período selecionado
   const isDateInSelectedPeriod = (dateStr: string) => {
      if (filterInstId === 'all' || filterPeriodIdx === 'all') return true;

      // Pega a parte da data YYYY-MM-DD para garantir
      const cleanDate = dateStr.split('T')[0];

      const calendar = data.calendars.find(c => c.schoolId === filterInstId);
      if (!calendar) return true;

      const term = calendar.terms[Number(filterPeriodIdx)];
      if (!term || !term.start || !term.end) return true;

      return cleanDate >= term.start && cleanDate <= term.end;
   };

   // Derived Active Record for Roster
   const currentClassRecord = useMemo(() => {
      return data.classRecords?.find(r => r.schoolId === rosterSchoolId && r.classId === rosterClassId);
   }, [data.classRecords, rosterSchoolId, rosterClassId]);

   const activeStudents = useMemo(() => {
      return currentClassRecord?.students.filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name)) || [];
   }, [currentClassRecord]);

   const archivedStudents = useMemo(() => {
      return currentClassRecord?.students.filter(s => s.active === false).sort((a, b) => a.name.localeCompare(b.name)) || [];
   }, [currentClassRecord]);

   const handleAddStudents = () => {
      if (!rosterSchoolId || !rosterClassId || !newStudentsText.trim()) return;

      const namesToAdd = newStudentsText.split('\n').map(n => n.trim()).filter(n => n.length > 0);
      if (namesToAdd.length === 0) return;

      const existingStudents = currentClassRecord?.students || [];
      const now = new Date().toISOString();

      const studentsToAdd: ClassStudent[] = namesToAdd.map(name => ({
         id: crypto.randomUUID(),
         name,
         active: true
      }));

      // Mesclar novos com existentes
      const updatedStudents = [...existingStudents, ...studentsToAdd].sort((a, b) => a.name.localeCompare(b.name));

      const newRecord: ClassRecord = {
         id: currentClassRecord?.id || crypto.randomUUID(),
         schoolId: rosterSchoolId,
         classId: rosterClassId,
         students: updatedStudents,
         createdAt: currentClassRecord?.createdAt || now,
         updatedAt: now
      };

      const otherRecords = data.classRecords?.filter(r => r.id !== newRecord.id) || [];
      onUpdateData({ classRecords: [...otherRecords, newRecord] });
      setNewStudentsText('');

      // Feedback Visual
      setAddStudentSuccess(true);
      setTimeout(() => setAddStudentSuccess(false), 2000);
   };

   const handleArchiveStudent = (studentId: string) => {
      if (!currentClassRecord) return;
      const now = new Date().toISOString();

      const updatedStudents = currentClassRecord.students.map(s =>
         s.id === studentId ? { ...s, active: false, disabledAt: now } : s
      );

      const updatedRecord = {
         ...currentClassRecord,
         students: updatedStudents,
         updatedAt: now
      };

      const otherRecords = data.classRecords?.filter(r => r.id !== currentClassRecord.id) || [];
      onUpdateData({ classRecords: [...otherRecords, updatedRecord] });
   };

   const handleRestoreStudent = (studentId: string) => {
      if (!currentClassRecord) return;
      const now = new Date().toISOString();

      const updatedStudents = currentClassRecord.students.map(s =>
         s.id === studentId ? { ...s, active: true, disabledAt: undefined } : s
      );

      // Reordenar após restaurar
      updatedStudents.sort((a, b) => a.name.localeCompare(b.name));

      const updatedRecord = {
         ...currentClassRecord,
         students: updatedStudents,
         updatedAt: now
      };

      const otherRecords = data.classRecords?.filter(r => r.id !== currentClassRecord.id) || [];
      onUpdateData({ classRecords: [...otherRecords, updatedRecord] });
   };

   const handleDeleteAllClassStudents = () => {
      if (!currentClassRecord) return;

      const studentCount = currentClassRecord.students.length;

      if (studentCount === 0) {
         alert('Não há alunos nesta turma para excluir.');
         return;
      }

      const confirmMessage = `ATENÇÃO: Você está prestes a EXCLUIR PERMANENTEMENTE toda a lista de alunos desta turma.\n\n` +
         `Total de alunos: ${studentCount}\n` +
         `- Alunos ativos: ${activeStudents.length}\n` +
         `- Alunos arquivados: ${archivedStudents.length}\n\n` +
         `Esta ação removerá:\n` +
         `• Todos os nomes dos alunos desta turma\n` +
         `• Histórico de presença (se houver)\n` +
         `• Notas lançadas para estes alunos\n\n` +
         `Esta ação NÃO pode ser desfeita!\n\n` +
         `IMPORTANTE: Use esta opção APENAS se importou a lista errada.\n` +
         `Se apenas quer arquivar alunos, use o botão "Arquivar" individual.\n\n` +
         `Digite "EXCLUIR LISTA" para confirmar:`;

      const userInput = prompt(confirmMessage);

      if (userInput === 'EXCLUIR LISTA') {
         // Hard Delete: Remove the entire ClassRecord
         const updatedClassRecords = data.classRecords?.filter(r => r.id !== currentClassRecord.id) || [];
         onUpdateData({ classRecords: updatedClassRecords });

         // Reset seleção
         setRosterClassId('');

         alert(`Lista de ${studentCount} aluno(s) excluída com sucesso.`);
      } else if (userInput !== null) {
         alert('Texto de confirmação incorreto. Exclusão cancelada.');
      }
   };

   // --- IMPORTAÇÃO DE RECESSOS ---
   const handleParseHolidays = () => {
      if (!holidayImportText.trim()) {
         alert('Cole a lista de recessos para processar.');
         return;
      }
      const parsed = parseHolidayList(holidayImportText, calForm.year || new Date().getFullYear());

      if (parsed.length === 0) {
         alert('Nenhum recesso válido encontrado.');
         return;
      }

      setParsedHolidays(parsed);
   };

   const handleConfirmHolidays = () => {
      const newRecesses = parsedHolidays.map(h => ({
         id: crypto.randomUUID(),
         date: h.date,
         name: h.name
      }));

      setCalForm(prev => ({
         ...prev,
         extraRecesses: [...(prev.extraRecesses || []), ...newRecesses]
      }));

      setHolidayImportMode(false);
      setParsedHolidays([]);
      setHolidayImportText('');
   };

   // --- CÓPIA DE RECESSO ---
   const confirmCopyRecess = (targetSchoolId: string) => {
      if (!copyingRecess) return;

      const targetSchool = data.schools.find(s => s.id === targetSchoolId);
      if (!targetSchool) return;

      // BUGFIX: Use local state instead of Firestore data
      // Find the recess in the CURRENT local state (calForm) to get the latest edited values
      const currentRecess = calForm.extraRecesses?.find(r => r.id === copyingRecess.id);
      if (!currentRecess) {
         alert('Recesso não encontrado no formulário atual.');
         setCopyingRecess(null);
         return;
      }

      // Encontrar calendário da escola alvo para o ano atual
      let targetCalendar = data.calendars.find(c => c.schoolId === targetSchoolId && c.year === (calForm.year || new Date().getFullYear()));

      let newCalendars = [...data.calendars];

      const newRecess: Recess = {
         id: crypto.randomUUID(),
         date: currentRecess.date,  // Use current state value, not saved value
         name: currentRecess.name   // Use current state value, not saved value
      };

      if (targetCalendar) {
         // Atualizar calendário existente
         const updatedCalendar = {
            ...targetCalendar,
            extraRecesses: [...(targetCalendar.extraRecesses || []), newRecess]
         };
         newCalendars = newCalendars.map(c => c.id === targetCalendar!.id ? updatedCalendar : c);
      } else {
         // Criar novo calendário se não existir
         const newCal: AcademicCalendar = {
            id: crypto.randomUUID(),
            schoolId: targetSchoolId,
            year: calForm.year || new Date().getFullYear(),
            division: 'bimestres',
            start: `${new Date().getFullYear()}-02-01`,
            end: `${new Date().getFullYear()}-12-01`,
            terms: [],
            midYearBreak: { start: `${new Date().getFullYear()}-07-01`, end: `${new Date().getFullYear()}-07-31` },
            extraRecesses: [newRecess]
         };
         newCalendars.push(newCal);
      }

      onUpdateData({ calendars: newCalendars });
      setCopyingRecess(null);
      alert(`Recesso "${currentRecess.name}" copiado para ${targetSchool.name} com sucesso!`);
   };

   // --- PROCESSAMENTO DE LISTA DE ALUNOS ---
   const handleProcessList = () => {
      if (!newStudentsText.trim()) {
         alert('Cole a lista de alunos para processar.');
         return;
      }

      try {
         const processed = processStudentList(newStudentsText, formatMode);

         if (processed.length === 0) {
            alert('Nenhum nome válido encontrado na lista.');
            return;
         }

         setProcessedList(processed);
         setEditedNames(processed.map(s => s.displayName));
         setShowPreviewTable(true);
      } catch (error) {
         console.error('Erro ao processar lista:', error);
         alert('Erro ao processar lista. Verifique o formato e tente novamente.');
      }
   };

   // Reprocessa quando mudar o modo de formatação
   const handleFormatModeChange = (mode: FormatMode) => {
      setFormatMode(mode);
      if (processedList.length > 0) {
         // Reprocessa com novo modo
         const reprocessed = processStudentList(newStudentsText, mode);
         setProcessedList(reprocessed);
         setEditedNames(reprocessed.map(s => s.displayName));
      }
   };

   const confirmProcessedList = () => {
      // Usa os valores editados pelo usuário (ou os gerados)
      const names = editedNames.filter(n => n.trim().length > 0).join('\n');
      setNewStudentsText(names);
      setShowPreviewTable(false);
      setProcessedList([]);
      setEditedNames([]);
   };

   // --- LÓGICA DE ONBOARDING ---
   const [showSuccessModal, setShowSuccessModal] = useState(false);

   const validateOnboarding = () => {
      // Validação básica: nome do professor
      if (!data.profile.name || data.profile.name.trim() === '') {
         return "Preencha seu nome no perfil.";
      }

      // VALIDAÇÃO DE LOGIN: requer Google login OU aceite explícito
      if (!user && !acceptedNoLogin) {
         return "Conecte-se com sua conta Google ou aceite prosseguir sem backup automático.";
      }

      // MODO PROFESSOR PARTICULAR: requisitos simplificados
      if (data.settings.isPrivateTeacher) {
         if (data.students.length === 0) {
            return "Cadastre pelo menos um aluno particular na aba 'Alunos Particulares'.";
         }
         // Se chegou aqui, está tudo OK para professor particular
         return null;
      }

      // MODO ESCOLA: requisitos completos
      if (data.schools.length === 0) {
         return "Cadastre pelo menos uma escola ou instituição.";
      }

      const hasCalendar = data.calendars.some(c => c.terms.length > 0);
      if (!hasCalendar) {
         return "Configure o ano letivo e os bimestres/trimestres.";
      }

      if (data.schedules.length === 0) {
         return "Monte sua grade de horários.";
      }

      return null;
   };

   const handleFinishOnboarding = () => {
      const error = validateOnboarding();
      if (error) {
         alert("Atenção: " + error);
         return;
      }
      setShowSuccessModal(true);
   };

   const confirmFinish = () => {
      onUpdateData({ profile: { ...data.profile, setupCompleted: true } });
      // Reload removed using explicit callback instead
      if (onFinishOnboarding) onFinishOnboarding();
   };

   const handleHardReset = async () => {
      if (!confirm('TEM CERTEZA? Isso apagará todas as escolas, turmas, alunos e diários permanentemente. Não há como desfazer.')) {
         return;
      }

      if (user) {
         try {
            console.log("🗑️ Iniciando Hard Reset para userId:", user.uid);

            // Em vez de deletar o doc (que causa resync dos outros devices),
            // sobrescrevemos com dados vazios e uma flag de wipe
            const emptyData = {
               ...INITIAL_DATA,
               settings: { ...INITIAL_DATA.settings, googleSyncEnabled: true },
               wiped: true,
               wipedAt: new Date().toISOString()
            };

            // SANITIZAÇÃO CRÍTICA: Remove undefineds que quebram o Firestore setDoc
            const sanitizedEmptyData = JSON.parse(JSON.stringify(emptyData));

            await setDoc(doc(db, "users", user.uid), sanitizedEmptyData);

            console.log("✅ Hard Reset concluído no Firestore");
         } catch (error: any) {
            console.error("❌ Erro ao apagar dados da nuvem:", {
               code: error.code,
               message: error.message,
               userId: user.uid,
               erro: error
            });

            // Mensagem específica baseada no código de erro
            let userMessage = "Erro ao apagar dados da nuvem. Verifique sua conexão.";

            if (error.code === 'permission-denied') {
               userMessage = "❌ Permissão Negada. Verifique as Regras de Segurança do Firestore no Console Firebase.";
               alert(userMessage + "\n\nDetalhes no Console do Navegador (F12).");
            } else if (error.code === 'unavailable') {
               userMessage = "❌ Firestore indisponível. Verifique sua conexão com a internet.";
               alert(userMessage);
            } else {
               alert(userMessage + "\n\nDetalhes no Console do Navegador (F12).");
            }

            return; // Não prossegue com reload se falhar
         }
      }

      // Limpa localStorage e recarrega
      localStorage.clear();
      console.log("🔄 Recarregando página após reset...");
      window.location.reload();
   };


   const handleExport = (type: 'logs' | 'calendar' | 'assessments' | 'occurrences' | 'attendance' | 'grades' | 'privateLessons') => {
      const isFilterActive = filterInstId !== 'all' || filterClassId !== 'all' || filterPeriodIdx !== 'all';

      // Helper para filtrar Logs com base nos seletores e período
      const filterLogs = (logs: any[]) => {
         return logs.filter(l => {
            if (l.type === 'substitution') return false;
            const instId = l.schoolId || l.studentId;
            const instMatch = filterInstId === 'all' || instId === filterInstId;
            const classMatch = filterClassId === 'all' || l.classId === filterClassId;
            const periodMatch = isDateInSelectedPeriod(l.date);

            // Check if institution is deleted
            const isSchool = data.schools.find(s => s.id === instId);
            const isStudent = data.students.find(s => s.id === instId);
            if (isSchool && isSchool.deleted) return false;
            if (isStudent && isStudent.deleted) return false;

            return instMatch && classMatch && periodMatch;
         });
      };

      if (type === 'logs') {
         const logs = filterLogs(data.logs);

         if (logs.length === 0) return alert('Sem registros para exportar com os filtros atuais.');

         downloadCSV(logs.map(l => ({
            Data: new Date(l.date).toLocaleDateString('pt-BR'),
            Tipo: l.type === 'extra' ? 'Aula Extra' : 'Regular',
            Instituicao: availableInstitutions.find(i => i.id === (l.schoolId || l.studentId))?.name || 'N/A',
            Turma: l.classId,
            Horario: l.startTime ? `${l.startTime}-${l.endTime}` : 'Grade Normal',
            Conteudo: l.subject,
            Tarefa: l.homework,
            Notas: l.notes
         })), `diario_aulas_${new Date().toISOString().split('T')[0]}`);

      } else if (type === 'privateLessons') {
         // Filtra apenas os logs de alunos particulares (que têm studentId)
         const privateLogs = data.logs.filter(l => {
            if (!l.studentId) return false; // Só logs com studentId (alunos particulares)
            if (l.type === 'substitution') return false;
            return true;
         });

         if (privateLogs.length === 0) return alert('Sem registros de aulas particulares para exportar.');

         downloadCSV(privateLogs.map(l => {
            const student = data.students.find(s => s.id === l.studentId);
            return {
               Data: new Date(l.date).toLocaleDateString('pt-BR'),
               Aluno: student?.name || 'N/A',
               Materia: student?.subject || 'N/A',
               Horario: l.startTime ? `${l.startTime}-${l.endTime}` : 'Horário do aluno',
               Conteudo: l.subject,
               Tarefa: l.homework,
               Notas: l.notes
            };
         }), `aulas_particulares_${new Date().toISOString().split('T')[0]}`);

      } else if (type === 'assessments') {
         const assessments = data.events.filter(e => {
            const isAssessment = ['test', 'work'].includes(e.type);
            const instMatch = filterInstId === 'all' || e.schoolId === filterInstId;
            const classMatch = filterClassId === 'all' || e.classId === filterClassId;
            const periodMatch = isDateInSelectedPeriod(e.date);
            return isAssessment && instMatch && classMatch && periodMatch;
         });

         if (assessments.length === 0) return alert('Sem avaliações para exportar com os filtros atuais.');

         downloadCSV(assessments.map(e => ({
            Data: new Date(e.date).toLocaleDateString('pt-BR'),
            Escola: data.schools.find(s => s.id === e.schoolId)?.name || 'N/A',
            Turma: e.classId || 'Geral',
            Tipo: e.type === 'test' ? 'Prova' : 'Trabalho',
            Titulo: e.title,
            Descricao: e.description
         })), `avaliacoes_${new Date().toISOString().split('T')[0]}`);

      } else if (type === 'occurrences') {
         const logs = filterLogs(data.logs);
         // Flatten occurrences
         const allOccurrences = logs.flatMap(l => {
            if (!l.occurrences || l.occurrences.length === 0) return [];
            return l.occurrences.map(occ => {
               // Busca nomes dos alunos envolvidos se houver
               let studentNames = '';
               if (occ.studentIds && occ.studentIds.length > 0) {
                  const record = data.classRecords.find(r => r.schoolId === l.schoolId && r.classId === l.classId);
                  if (record) {
                     studentNames = occ.studentIds.map(sid => record.students.find(s => s.id === sid)?.name || 'Desconhecido').join(', ');
                  }
               }

               return {
                  Data: new Date(l.date).toLocaleDateString('pt-BR'),
                  Escola: availableInstitutions.find(i => i.id === (l.schoolId || l.studentId))?.name || 'N/A',
                  Turma: l.classId,
                  Tipo: occ.type,
                  Descricao: occ.description,
                  Alunos_Envolvidos: studentNames || 'Geral'
               };
            });
         });

         if (allOccurrences.length === 0) return alert('Sem ocorrências para exportar com os filtros atuais.');
         downloadCSV(allOccurrences, `ocorrencias_${new Date().toISOString().split('T')[0]}`);

      } else if (type === 'attendance') {
         const logs = filterLogs(data.logs).filter(l => l.attendance && l.attendance.length > 0);

         const attendanceRecords = logs.flatMap(l => {
            const record = data.classRecords.find(r => r.schoolId === l.schoolId && r.classId === l.classId);
            if (!record) return [];

            return l.attendance!.map(att => {
               const student = record.students.find(s => s.id === att.studentId);
               const statusMap: Record<string, string> = { 'present': 'Presente', 'absent': 'Falta', 'justified': 'Justificada' };

               return {
                  Data: new Date(l.date).toLocaleDateString('pt-BR'),
                  Escola: availableInstitutions.find(i => i.id === l.schoolId)?.name || 'N/A',
                  Turma: l.classId,
                  Aluno: student ? student.name : 'Desconhecido',
                  Status: statusMap[att.status] || att.status
               };
            });
         });

         if (attendanceRecords.length === 0) return alert('Sem registros de chamada para exportar.');
         downloadCSV(attendanceRecords, `chamada_${new Date().toISOString().split('T')[0]}`);

      } else if (type === 'grades') {
         // Filtra Configurações de Notas/Colunas
         const assessments = [...data.events.filter(e => ['test', 'work'].includes(e.type)), ...data.customAssessments].filter(a => {
            const instMatch = filterInstId === 'all' || a.schoolId === filterInstId;
            const classMatch = filterClassId === 'all' || a.classId === filterClassId;
            const periodMatch = isDateInSelectedPeriod(a.date);
            return instMatch && classMatch && periodMatch;
         });

         if (assessments.length === 0) return alert('Sem avaliações/notas configuradas para exportar.');

         const gradeRows: any[] = [];

         assessments.forEach(assessment => {
            const schoolName = data.schools.find(s => s.id === assessment.schoolId)?.name || 'N/A';
            // Find records for this class
            const record = data.classRecords.find(r => r.schoolId === assessment.schoolId && r.classId === assessment.classId);

            if (record) {
               record.students.forEach(student => {
                  // Find grade
                  const gradeEntry = data.grades.find(g => g.studentId === student.id && g.assessmentId === assessment.id);
                  if (gradeEntry || student.active) { // Exporta se tiver nota OU se aluno estiver ativo (mesmo sem nota = vazio)
                     gradeRows.push({
                        Escola: schoolName,
                        Turma: assessment.classId,
                        Avaliacao: assessment.title,
                        Data: new Date(assessment.date).toLocaleDateString('pt-BR'),
                        Tipo: 'type' in assessment ? (assessment.type === 'test' ? 'Prova' : 'Trabalho') : 'Personalizada',
                        Aluno: student.name,
                        Nota: gradeEntry ? String(gradeEntry.value).replace('.', ',') : '-'
                     });
                  }
               });
            }
         });

         if (gradeRows.length === 0) return alert('Sem notas lançadas para exportar.');
         downloadCSV(gradeRows, `notas_${new Date().toISOString().split('T')[0]}`);

      } else {
         // Calendar ICS
         const evs = data.events.filter(e => {
            const instMatch = filterInstId === 'all' || e.schoolId === filterInstId;
            const periodMatch = isDateInSelectedPeriod(e.date);
            return instMatch && periodMatch;
         });
         if (evs.length === 0) return alert('Sem eventos na agenda para exportar.');
         downloadICS(evs.map(e => ({ title: e.title, start: e.date, end: e.date, description: e.description })), 'agenda_leciona');
      }
   };

   const handleCreateTermsSuggestion = () => {
      if (!calForm.start || !calForm.end) return;
      const division = calForm.division || 'bimestres';
      const s = new Date(calForm.start + 'T00:00:00');
      const e = new Date(calForm.end + 'T00:00:00');
      const totalDays = (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24);
      const count = division === 'bimestres' ? 4 : 3;
      const daysPerTerm = totalDays / count;
      const terms: Term[] = [];
      for (let i = 0; i < count; i++) {
         const termStart = new Date(s.getTime() + (i * daysPerTerm * 24 * 60 * 60 * 1000));
         const termEnd = new Date(termStart.getTime() + ((daysPerTerm - 1) * 24 * 60 * 60 * 1000));
         terms.push({
            name: `${i + 1}º ${division === 'bimestres' ? 'Bimestre' : 'Trimestre'}`,
            start: termStart.toISOString().split('T')[0],
            end: termEnd.toISOString().split('T')[0]
         });
      }
      setCalForm({ ...calForm, terms });
   };

   const addTerm = () => {
      const newTerm: Term = {
         name: 'Novo Período',
         start: calForm.start || new Date().toISOString().split('T')[0],
         end: calForm.end || new Date().toISOString().split('T')[0]
      };
      setCalForm({ ...calForm, terms: [...(calForm.terms || []), newTerm] });
   };

   const removeTerm = (index: number) => {
      setCalForm({ ...calForm, terms: calForm.terms?.filter((_, i) => i !== index) });
   };

   const addExtraRecess = () => {
      const newRecess: Recess = {
         id: crypto.randomUUID(),
         name: '',
         date: new Date().toISOString().split('T')[0]
      };
      setCalForm({ ...calForm, extraRecesses: [...(calForm.extraRecesses || []), newRecess] });
   };

   const handleSaveCalendar = () => {
      if (!calForm.start || !calForm.end || !activeSchoolIdForCal) return;

      const newCal: AcademicCalendar = {
         id: schoolCalendar?.id || crypto.randomUUID(),
         schoolId: activeSchoolIdForCal,
         year: calForm.year || new Date().getFullYear(),
         division: calForm.division as any,
         start: calForm.start,
         end: calForm.end,
         terms: calForm.terms || [],
         midYearBreak: calForm.midYearBreak || { start: '', end: '' },
         extraRecesses: calForm.extraRecesses || []
      };

      const otherCals = data.calendars.filter(c => c.schoolId !== activeSchoolIdForCal);
      onUpdateData({ calendars: [...otherCals, newCal] });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500); // Tempo ligeiramente menor para feedback mais ágil
   };

   // FIX: Auto-reset calendar school selection when the selected school is deleted
   // This ensures the theme color updates correctly in the calendar tab
   useEffect(() => {
      const safeSchools = data.schools.filter(s => !s.deleted);

      if (activeSchoolIdForCal) {
         const schoolStillExists = safeSchools.find(s => s.id === activeSchoolIdForCal);

         // If the selected school was deleted, automatically select the first available one
         if (!schoolStillExists && safeSchools.length > 0) {
            const newId = safeSchools[0].id;
            console.log('🔄 Selected school for calendar was deleted. Auto-selecting first available:', newId);
            setActiveSchoolIdForCal(newId);
         }
      } else if (safeSchools.length > 0) {
         // If no school is selected but there are available ones, select the first
         setActiveSchoolIdForCal(safeSchools[0].id);
      }
   }, [data.schools, activeSchoolIdForCal]);

   // Garante que o formulário seja populado corretamente ao trocar de aba
   useEffect(() => {
      if (activeSubTab === 'calendar') {
         if (!activeSchoolIdForCal && data.schools.length > 0) {
            setActiveSchoolIdForCal(data.schools[0].id);
         }
      }
   }, [activeSubTab, data.schools, activeSchoolIdForCal]);

   // AUTO-GENERATE periods when division changes (UX improvement)
   useEffect(() => {
      // Only trigger if we have start/end dates
      if (!calForm.start || !calForm.end) return;

      console.log('🔄 Division changed to:', calForm.division);

      if (calForm.division === 'bimestres' || calForm.division === 'trimestres') {
         // For bimestres/trimestres, always regenerate to match the selected division
         // This ensures switching from Bimestres to Trimestres updates the fields
         const s = new Date(calForm.start + 'T00:00:00');
         const e = new Date(calForm.end + 'T00:00:00');
         const totalDays = (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24);
         const count = calForm.division === 'bimestres' ? 4 : 3;
         const daysPerTerm = totalDays / count;
         const terms: Term[] = [];

         for (let i = 0; i < count; i++) {
            const termStart = new Date(s.getTime() + (i * daysPerTerm * 24 * 60 * 60 * 1000));
            const termEnd = new Date(termStart.getTime() + ((daysPerTerm - 1) * 24 * 60 * 60 * 1000));
            terms.push({
               name: `${i + 1}º ${calForm.division === 'bimestres' ? 'Bimestre' : 'Trimestre'}`,
               start: termStart.toISOString().split('T')[0],
               end: termEnd.toISOString().split('T')[0]
            });
         }

         setCalForm(prev => ({ ...prev, terms }));
      } else if (calForm.division === 'personalizado') {
         // Personalizado: ALWAYS reset to just 1 period when switching to personalizado
         const initialTerm: Term = {
            name: '1º Período',
            start: calForm.start,
            end: calForm.end
         };

         setCalForm(prev => ({ ...prev, terms: [initialTerm] }));
      }
   }, [calForm.division]); // Only trigger when division changes

   // Carregar dados ao selecionar escola na aba calendario
   useEffect(() => {
      if (activeSubTab === 'calendar') {
         const targetSchoolId = activeSchoolIdForCal || (data.schools.length > 0 ? data.schools[0].id : '');
         const existingCalendar = data.calendars.find(c => c.schoolId === targetSchoolId);

         if (existingCalendar) {
            setCalForm(existingCalendar);
         } else {
            // No existing calendar - create new one with trimestres as default
            const currentYear = new Date().getFullYear();
            const newCalForm = {
               division: 'trimestres' as const,  // Default to trimestres for new calendars
               year: currentYear,
               start: `${currentYear}-02-01`,
               end: `${currentYear}-12-01`,
               terms: [] as Term[],
               midYearBreak: { start: `${currentYear}-07-01`, end: `${currentYear}-07-31` },
               extraRecesses: []
            };

            // Generate initial trimestres automatically
            const s = new Date(newCalForm.start + 'T00:00:00');
            const e = new Date(newCalForm.end + 'T00:00:00');
            const totalDays = (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24);
            const count = 3; // Trimestres
            const daysPerTerm = totalDays / count;
            const terms: Term[] = [];

            for (let i = 0; i < count; i++) {
               const termStart = new Date(s.getTime() + (i * daysPerTerm * 24 * 60 * 60 * 1000));
               const termEnd = new Date(termStart.getTime() + ((daysPerTerm - 1) * 24 * 60 * 60 * 1000));
               terms.push({
                  name: `${i + 1}º Trimestre`,
                  start: termStart.toISOString().split('T')[0],
                  end: termEnd.toISOString().split('T')[0]
               });
            }

            newCalForm.terms = terms;
            console.log('🎯 Generated initial trimestres:', terms.length);
            setCalForm(newCalForm);
         }
      }
   }, [activeSubTab, activeSchoolIdForCal, data.schools]); // Removed data.calendars to prevent reload on copy

   const hasAdvancedModes = data.settings.advancedModes && Object.values(data.settings.advancedModes).some(v => v);

   const tabs = [
      { id: 'general', label: 'Geral', icon: User },
      { id: 'schools', label: 'Escolas', icon: SchoolIcon },
      { id: 'calendar', label: 'Ano Letivo', icon: GraduationCap },
      { id: 'schedules', label: 'Horários', icon: CalendarClock },
      ...(hasAdvancedModes ? [{ id: 'classes', label: 'Turmas', icon: Users }] : []),
      ...(data.settings.isPrivateTeacher ? [{ id: 'privatestudents', label: 'Alunos Particulares', icon: Users }] : [])
   ];

   return (
      <div className="space-y-3 max-w-4xl mx-auto pb-10">
         {data.settings.showQuickStartGuide && (
            <QuickStartGuide onDismiss={() => onUpdateData({ settings: { ...data.settings, showQuickStartGuide: false } })} onNavigate={() => { }} />
         )}

         {/* Navegação Interna de Ajustes */}
         <div className="flex flex-wrap justify-between md:justify-center md:flex-nowrap p-1 bg-white dark:bg-slate-900 rounded-[24px] border border-slate-100 dark:border-slate-800 shadow-sm gap-1 overflow-x-auto">
            {tabs.map((tab, index) => (
               <React.Fragment key={tab.id}>
                  <button
                     onClick={() => setActiveSubTab(tab.id as any)}
                     className={`flex-1 md:flex-none flex items-center justify-center gap-1.5 md:gap-2 px-1.5 md:px-5 py-2 rounded-2xl text-[9px] md:text-[10px] font-black uppercase transition-all whitespace-nowrap ${activeSubTab === tab.id ? 'bg-primary text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                  >
                     <tab.icon size={14} className="md:w-4 md:h-4" /> <span className="truncate">{tab.label}</span>
                  </button>
                  {index === 3 && tabs.length > 4 && (
                     <div className="basis-full h-0 md:hidden" />
                  )}
               </React.Fragment>
            ))}
         </div>

         {activeSubTab === 'general' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
               {/* PERFIL */}
               <section className="bg-white dark:bg-slate-900 p-4 rounded-[32px] shadow-sm border border-slate-100 dark:border-slate-800 transition-colors">
                  <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2 mb-4"><User className="text-primary" size={18} /> Perfil Docente</h3>
                  <div className="space-y-4">
                     <div className="grid md:grid-cols-3 gap-4">
                        <label className="block">
                           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Tratamento:</span>
                           <select
                              value={data.profile.title || 'Prof.'}
                              onChange={e => onUpdateData({ profile: { ...data.profile, title: e.target.value } })}
                              className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 text-xs font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer"
                           >
                              <option value="Prof.">Prof.</option>
                              <option value="Profª.">Profª.</option>
                           </select>
                        </label>
                        <label className="block md:col-span-2">
                           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2 block">Nome</span>
                           <input
                              type="text"
                              value={data.profile.name}
                              onChange={e => onUpdateData({ profile: { ...data.profile, name: e.target.value } })}
                              className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 text-xs font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-primary/20"
                              placeholder="Seu nome"
                           />
                        </label>
                     </div>                     <label className={`flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${data.settings.isPrivateTeacher ? 'bg-primary/5 border-primary/20' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800'}`}>
                        <div className="flex items-center gap-3"><div className={`w-8 h-8 rounded-lg flex items-center justify-center ${data.settings.isPrivateTeacher ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-400'}`}><Briefcase size={16} /></div><div><span className="text-xs font-black uppercase tracking-tight dark:text-white">Professor Particular</span><p className="text-[9px] text-slate-400 font-bold uppercase">Ativa a gestão de alunos individuais.</p></div></div>
                        <input type="checkbox" checked={data.settings.isPrivateTeacher} onChange={e => onUpdateData({ settings: { ...data.settings, isPrivateTeacher: e.target.checked } })} className="w-6 h-6 rounded-lg text-primary" />
                     </label>
                  </div>
               </section>

               {/* MODOS AVANÇADOS - Oculto no Onboarding */}
               {!isOnboarding && (
                  <section className="bg-gradient-to-br from-slate-50 to-indigo-50/50 dark:from-slate-900 dark:to-indigo-900/20 p-4 rounded-[32px] shadow-sm border border-indigo-100 dark:border-indigo-900/30 transition-colors">
                     <h3 className="text-sm font-black text-indigo-900 dark:text-indigo-100 uppercase tracking-tight flex items-center gap-2 mb-3"><LayoutList className="text-indigo-500" size={18} /> Modos Avançados</h3>
                     <div className="bg-white/60 dark:bg-black/20 p-3 rounded-xl border border-indigo-100 dark:border-indigo-900/20 mb-4 flex items-start gap-2">
                        <AlertTriangle className="text-indigo-500 shrink-0 mt-0.5" size={14} />
                        <p className="text-[9px] text-indigo-800 dark:text-indigo-200 leading-relaxed">
                           A seleção destes modos torna necessário o cadastro dos nomes dos estudantes na nova aba "Turmas". <br /> Você poderá importar sua lista de chamadas para o Leciona com um simples copia e cola.
                        </p>
                     </div>

                     <div className="space-y-2">
                        <label className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer bg-white dark:bg-slate-800 ${data.settings.advancedModes?.attendance ? 'border-indigo-300 dark:border-indigo-500 shadow-sm' : 'border-transparent'}`}>
                           <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 rounded-lg"><ClipboardCheck size={16} /></div>
                              <div>
                                 <span className="text-xs font-black uppercase dark:text-white block mb-0.5">Modo Chamada</span>
                                 <p className="text-[9px] text-slate-400 font-medium normal-case dark:text-slate-500">Permite o registro de chamadas diárias.</p>
                              </div>
                           </div>
                           <input
                              type="checkbox"
                              checked={data.settings.advancedModes?.attendance || false}
                              onChange={e => onUpdateData({ settings: { ...data.settings, advancedModes: { ...data.settings.advancedModes!, attendance: e.target.checked } } })}
                              className="w-5 h-5 rounded text-indigo-600"
                           />
                        </label>

                        <label className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer bg-white dark:bg-slate-800 ${data.settings.advancedModes?.individualOccurrence ? 'border-indigo-300 dark:border-indigo-500 shadow-sm' : 'border-transparent'}`}>
                           <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 rounded-lg"><Users size={16} /></div>
                              <div>
                                 <span className="text-xs font-black uppercase dark:text-white block mb-0.5">Modo Seletor de Ocorrência</span>
                                 <p className="text-[9px] text-slate-400 font-medium normal-case dark:text-slate-500">Exibe o nome dos estudantes da turma para seleção ao adicionar ocorrência.</p>
                              </div>
                           </div>
                           <input
                              type="checkbox"
                              checked={data.settings.advancedModes?.individualOccurrence || false}
                              onChange={e => onUpdateData({ settings: { ...data.settings, advancedModes: { ...data.settings.advancedModes!, individualOccurrence: e.target.checked } } })}
                              className="w-5 h-5 rounded text-indigo-600"
                           />
                        </label>

                        <label className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer bg-white dark:bg-slate-800 ${data.settings.advancedModes?.grades ? 'border-indigo-300 dark:border-indigo-500 shadow-sm' : 'border-transparent'}`}>
                           <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 rounded-lg"><GraduationCap size={16} /></div>
                              <div>
                                 <span className="text-xs font-black uppercase dark:text-white block mb-0.5">Modo Notas</span>
                                 <p className="text-[9px] text-slate-400 font-medium normal-case dark:text-slate-500">Cria registro de notas e cálculo de médias.</p>
                              </div>
                           </div>
                           <input
                              type="checkbox"
                              checked={data.settings.advancedModes?.grades || false}
                              onChange={e => onUpdateData({ settings: { ...data.settings, advancedModes: { ...data.settings.advancedModes!, grades: e.target.checked } } })}
                              className="w-5 h-5 rounded text-indigo-600"
                           />
                        </label>
                     </div>
                  </section>
               )}

               {/* ALERTAS - Oculto no Onboarding */}
               {!isOnboarding && (
                  <section className="bg-white dark:bg-slate-900 p-4 rounded-[32px] shadow-sm border border-slate-100 dark:border-slate-800 transition-colors">
                     <div className="mb-4">
                        <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2 mb-1"><AlertTriangle className="text-amber-500" size={18} /> Alertas de Registro</h3>
                        <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 leading-relaxed max-w-lg">Crie alertas para aulas sem conteúdo registrado.</p>
                     </div>

                     <div className="mb-6 bg-slate-50 dark:bg-slate-800/40 rounded-3xl border border-slate-100 dark:border-slate-800 overflow-hidden">
                        <div className="p-4">
                           <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Estilo de Notificação</label>
                           <div className="flex gap-2 mb-4">
                              <button
                                 onClick={() => onUpdateData({ settings: { ...data.settings, alertType: 'notification' } })}
                                 className={`flex-1 py-2 px-3 rounded-xl text-[9px] font-black uppercase transition-all flex items-center justify-center gap-1.5 ${data.settings.alertType !== 'popup' ? 'bg-amber-500 text-white shadow-lg shadow-amber-200' : 'bg-white dark:bg-slate-700 text-slate-400 hover:bg-slate-50'}`}
                              >
                                 <Bell size={12} /> Sistema / Push
                              </button>
                              <button
                                 onClick={() => onUpdateData({ settings: { ...data.settings, alertType: 'popup' } })}
                                 className={`flex-1 py-2 px-3 rounded-xl text-[9px] font-black uppercase transition-all flex items-center justify-center gap-1.5 ${data.settings.alertType === 'popup' ? 'bg-amber-500 text-white shadow-lg shadow-amber-200' : 'bg-white dark:bg-slate-700 text-slate-400 hover:bg-slate-50'}`}
                              >
                                 <MessageSquare size={12} /> Popup no App
                              </button>
                           </div>

                           {data.settings.alertType !== 'popup' && (
                              <div className="flex gap-2 mb-4 animate-in fade-in slide-in-from-top-1">
                                 {[
                                    { id: 'sound', label: 'Sonoro', icon: Volume2 },
                                    { id: 'vibration', label: 'Vibração', icon: Smartphone },
                                    { id: 'silent', label: 'Silencioso', icon: BellOff }
                                 ].map(opt => (
                                    <button
                                       key={opt.id}
                                       onClick={() => onUpdateData({ settings: { ...data.settings, alertNotificationStyle: opt.id as any } })}
                                       className={`flex-1 py-2 px-3 rounded-xl text-[9px] font-bold uppercase transition-all flex items-center justify-center gap-1.5 ${(data.settings.alertNotificationStyle || 'sound') === opt.id ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-slate-800 text-slate-400 border border-transparent'}`}
                                    >
                                       <opt.icon size={12} /> {opt.label}
                                    </button>
                                 ))}
                              </div>
                           )}

                           <button onClick={() => setShowAlertInfo(!showAlertInfo)} className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-400 hover:text-primary transition-colors mx-auto p-2">
                              <Lightbulb size={14} className={showAlertInfo ? 'text-primary' : ''} />
                              Entenda como funciona
                              <ChevronDown size={14} className={`transition-transformDuration-300 ${showAlertInfo ? 'rotate-180' : ''}`} />
                           </button>
                        </div>

                        {showAlertInfo && (
                           <div className="bg-amber-50 dark:bg-amber-900/10 p-4 border-t border-amber-100 dark:border-amber-900/20 text-[10px] md:text-xs text-slate-600 dark:text-slate-300 leading-relaxed space-y-2 animate-in slide-in-from-top-2">
                              <p><strong className="text-amber-600 dark:text-amber-400 uppercase">Sistema / Push:</strong> Envia uma notificação padrão do seu dispositivo. Útil para ver alertas mesmo com o app fechado ou em segundo plano. Requer permissão do navegador.</p>
                              <p><strong className="text-amber-600 dark:text-amber-400 uppercase">Popup no App:</strong> Exibe uma janela (caixa de diálogo) dentro do próprio Leciona quando você está com ele aberto. Garante que você veja a mensagem antes de continuar usando o app. Se o app estiver fechado, você não verá ao ocorrer.</p>
                           </div>
                        )}
                     </div>

                     <div className="grid sm:grid-cols-2 gap-4">
                        <label className={`flex flex-col gap-2 p-5 rounded-3xl border transition-all cursor-pointer ${data.settings.alertAfterLesson ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/20' : 'bg-slate-50 dark:bg-slate-800/40 opacity-60'}`}>
                           <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase dark:text-white">Ao final da aula vigente</span><input type="checkbox" checked={data.settings.alertAfterLesson} onChange={e => onUpdateData({ settings: { ...data.settings, alertAfterLesson: e.target.checked } })} className="w-5 h-5 rounded text-amber-500" /></div>
                           <div className="flex items-center gap-2 mt-2"><span className="text-[9px] font-black text-slate-400">Avisar</span><select value={data.settings.alertBeforeMinutes} onChange={e => onUpdateData({ settings: { ...data.settings, alertBeforeMinutes: parseInt(e.target.value) } })} className="bg-white dark:bg-slate-700 border-none text-[10px] font-black text-amber-600 px-2 py-1 rounded-lg outline-none"><option value="0">Na hora</option><option value="5">5 min antes</option><option value="10">10 min antes</option></select></div>
                        </label>
                        <label className={`flex flex-col gap-2 p-5 rounded-3xl border transition-all cursor-pointer ${data.settings.alertAfterShift ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/20' : 'bg-slate-50 dark:bg-slate-800/40 opacity-60'}`}>
                           <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase dark:text-white">Resumo do Turno</span><input type="checkbox" checked={data.settings.alertAfterShift} onChange={e => onUpdateData({ settings: { ...data.settings, alertAfterShift: e.target.checked } })} className="w-5 h-5 rounded text-amber-500" /></div>
                           <div className="flex items-center gap-2 mt-2"><span className="text-[9px] font-black text-slate-400">Avisar</span><select value={data.settings.alertAfterShiftDelay || 0} onChange={e => onUpdateData({ settings: { ...data.settings, alertAfterShiftDelay: parseInt(e.target.value) } })} className="bg-white dark:bg-slate-700 border-none text-[10px] font-black text-amber-600 px-2 py-1 rounded-lg outline-none"><option value="0">Ao terminar</option><option value="1">1 min depois</option><option value="5">5 min depois</option><option value="10">10 min depois</option></select></div>
                        </label>
                     </div>

                     <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 grid sm:grid-cols-2 gap-4">
                        <label className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer bg-white dark:bg-slate-800 ${data.settings.hideUnregisteredClassesOnDashboard ? 'border-indigo-300 dark:border-indigo-500 shadow-sm' : 'border-transparent'}`}>
                           <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 rounded-lg"><LayoutGrid size={14} /></div>
                              <div className="flex-1">
                                 <span className="text-[10px] font-black uppercase dark:text-white block mb-0.5">Ocultar no Início</span>
                                 <p className="text-[8px] text-slate-400 font-medium normal-case">Esconde aviso de pendência no Dashboard.</p>
                              </div>
                           </div>
                           <input
                              type="checkbox"
                              checked={data.settings.hideUnregisteredClassesOnDashboard || false}
                              onChange={e => onUpdateData({ settings: { ...data.settings, hideUnregisteredClassesOnDashboard: e.target.checked } })}
                              className="w-4 h-4 rounded text-indigo-600"
                           />
                        </label>
                        <label className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer bg-white dark:bg-slate-800 ${data.settings.hideUnregisteredClassesOnDiary ? 'border-indigo-300 dark:border-indigo-500 shadow-sm' : 'border-transparent'}`}>
                           <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 rounded-lg"><BookOpen size={14} /></div>
                              <div className="flex-1">
                                 <span className="text-[10px] font-black uppercase dark:text-white block mb-0.5">Ocultar no Diário</span>
                                 <p className="text-[8px] text-slate-400 font-medium normal-case">Esconde aviso de pendência na lista do Diário.</p>
                              </div>
                           </div>
                           <input
                              type="checkbox"
                              checked={data.settings.hideUnregisteredClassesOnDiary || false}
                              onChange={e => onUpdateData({ settings: { ...data.settings, hideUnregisteredClassesOnDiary: e.target.checked } })}
                              className="w-4 h-4 rounded text-indigo-600"
                           />
                        </label>
                     </div>
                  </section>
               )}

               {/* APARÊNCIA (AGORA AQUI EMBAIXO) - Oculto no Onboarding */}
               {
                  !isOnboarding && (
                     <section className="bg-white dark:bg-slate-900 p-4 rounded-[32px] shadow-sm border border-slate-100 dark:border-slate-800 transition-colors">
                        <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2 mb-4"><Palette className="text-primary" size={18} /> Aparência</h3>

                        <div className="space-y-6">
                           <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800">
                              <div className="flex items-center gap-3">
                                 <div className="p-2 bg-slate-200 dark:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-200">
                                    {data.settings.darkMode ? <Moon size={18} /> : <Sun size={18} />}
                                 </div>
                                 <div>
                                    <span className="text-xs font-black uppercase dark:text-white block mb-0.5">Modo Escuro</span>
                                    <p className="text-[9px] text-slate-400 font-medium normal-case dark:text-slate-500">Altera o visual para ambientes com pouca luz.</p>
                                 </div>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                 <input type="checkbox" checked={data.settings.darkMode} onChange={e => onUpdateData({ settings: { ...data.settings, darkMode: e.target.checked } })} className="sr-only peer" />
                                 <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                              </label>
                           </div>

                           <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800">
                              <div className="flex items-center gap-3">
                                 <div className="p-2 bg-slate-200 dark:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-200">
                                    <Quote size={18} />
                                 </div>
                                 <div>
                                    <span className="text-xs font-black uppercase dark:text-white block mb-0.5">Pensamento do Dia</span>
                                    <p className="text-[9px] text-slate-400 font-medium normal-case dark:text-slate-500">Exibe uma frase inspiradora no topo do Dashboard.</p>
                                 </div>
                              </div>
                              <label className="relative inline-flex items-center cursor-pointer">
                                 <input type="checkbox" checked={data.settings.showDailyQuote} onChange={e => onUpdateData({ settings: { ...data.settings, showDailyQuote: e.target.checked } })} className="sr-only peer" />
                                 <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                              </label>
                           </div>


                           <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Cor do Tema</label>
                              <div className="flex flex-wrap gap-2">
                                 {THEME_COLORS.map(c => (
                                    <button
                                       key={c.value}
                                       onClick={() => onUpdateData({ settings: { ...data.settings, themeColor: c.value } })}
                                       className={`w-8 h-8 rounded-full transition-all ${data.settings.themeColor === c.value ? 'ring-2 ring-primary ring-offset-2 dark:ring-offset-slate-900 scale-110' : 'hover:scale-110'}`}
                                       style={{ backgroundColor: c.value }}
                                       title={c.name}
                                    />
                                 ))}
                              </div>
                           </div>
                        </div>
                     </section>
                  )
               }

               <section className="bg-white dark:bg-slate-900 p-4 rounded-[32px] shadow-sm border border-slate-100 dark:border-slate-800">
                  <div className="flex justify-between items-start mb-4"><h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2"><ShieldCheck className="text-primary" size={18} /> Conta Leciona (Backup)</h3><div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${user ? 'bg-green-50 text-green-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>{user ? 'Online' : 'Offline'}</div></div>

                  {isOnboarding && (
                     <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-2xl border border-amber-100 dark:border-amber-900/30 mb-6 flex items-start gap-3">
                        <AlertTriangle className="text-amber-500 shrink-0 mt-0.5" size={16} />
                        <p className="text-[10px] text-amber-800 dark:text-amber-200 font-bold leading-relaxed">
                           Se não for feito o login na conta Google os dados não ficarão salvos.
                        </p>
                     </div>
                  )}

                  {user ? (
                     <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                           {user.photoURL && <img src={user.photoURL} alt="Avatar" className="w-12 h-12 rounded-full" />}
                           <div>
                              <p className="text-sm font-black text-slate-800 dark:text-white">{user.displayName}</p>
                              <p className="text-xs text-slate-500">{user.email}</p>
                           </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                           <button onClick={async () => {
                              if (onLogout) await onLogout();
                              setTimeout(() => {
                                 if (onLogin) onLogin(true);
                              }, 500);
                           }} className="p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-all flex items-center justify-center gap-2">
                              <RefreshCw size={16} /> Trocar Conta
                           </button>
                           <button onClick={onLogout} className="p-4 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:text-red-500 transition-all flex items-center justify-center gap-2">
                              <LogOut size={16} /> Sair
                           </button>
                        </div>
                     </div>
                  ) : (
                     <>
                        <button onClick={onLogin} className="w-full flex items-center justify-center gap-4 py-6 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-800 rounded-[32px] font-black uppercase text-xs tracking-widest hover:border-primary transition-all dark:text-white">
                           <LogIn size={18} /> Conectar com Google
                        </button>

                        {isOnboarding && (
                           <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/10 border-2 border-red-200 dark:border-red-900/30 rounded-2xl">
                              <label className="flex items-start gap-3 cursor-pointer">
                                 <input
                                    type="checkbox"
                                    checked={acceptedNoLogin}
                                    onChange={(e) => setAcceptedNoLogin(e.target.checked)}
                                    className="mt-1 w-5 h-5 rounded text-red-600 focus:ring-red-500"
                                 />
                                 <div className="flex-1">
                                    <p className="text-[10px] font-bold text-red-800 dark:text-red-200 leading-relaxed">
                                       ⚠️ <strong className="uppercase">Atenção:</strong> Sem a conexão com Google, seus dados ficam salvos apenas neste navegador e <strong>podem ser perdidos a qualquer momento</strong> (limpeza de cache, formatação, troca de dispositivo, etc.).
                                    </p>
                                    <p className="text-[9px] font-bold text-red-700 dark:text-red-300 mt-2">
                                       ✓ Confirmo que estou ciente do risco e aceito prosseguir sem backup automático na nuvem.
                                    </p>
                                 </div>
                              </label>
                           </div>
                        )}
                     </>
                  )}
               </section>

               {
                  !isOnboarding && (
                     <section className="bg-white dark:bg-slate-900 p-4 rounded-[32px] shadow-sm border border-slate-100 dark:border-slate-800">
                        <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2 mb-4"><Download className="text-primary" size={18} /> Exportar Dados</h3>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                           <select value={filterInstId} onChange={e => { setFilterInstId(e.target.value); setFilterClassId('all'); setFilterPeriodIdx('all'); }} className="bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-3 py-2 text-[9px] font-black uppercase outline-none appearance-none cursor-pointer dark:text-white"><option value="all">Todas Instituições</option>{availableInstitutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
                           <select value={filterClassId} onChange={e => setFilterClassId(e.target.value)} className="bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-3 py-2 text-[9px] font-black uppercase outline-none appearance-none cursor-pointer dark:text-white"><option value="all">Todas as Turmas</option>{availableClasses.map(c => <option key={c} value={c}>{c}</option>)}</select>
                           <select value={filterPeriodIdx} onChange={e => setFilterPeriodIdx(e.target.value)} disabled={filterInstId === 'all'} className="bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-3 py-2 text-[9px] font-black uppercase outline-none appearance-none cursor-pointer dark:text-white disabled:opacity-50">
                              <option value="all">Todo o Período</option>
                              {periodOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                           </select>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                           <button onClick={() => handleExport('logs')} className="flex flex-col items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                              <BookOpen className="text-primary group-hover:scale-110" size={20} />
                              <span className="text-[9px] font-black uppercase text-slate-600 dark:text-slate-400">Diários (CSV)</span>
                           </button>

                           <button onClick={() => handleExport('assessments')} className="flex flex-col items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                              <FileCheck className="text-primary group-hover:scale-110" size={20} />
                              <span className="text-[9px] font-black uppercase text-slate-600 dark:text-slate-400">Avaliações (CSV)</span>
                           </button>

                           <button onClick={() => handleExport('occurrences')} className="flex flex-col items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                              <AlertCircle className="text-primary group-hover:scale-110" size={20} />
                              <span className="text-[9px] font-black uppercase text-slate-600 dark:text-slate-400">Ocorrências (CSV)</span>
                           </button>

                           {data.settings.advancedModes?.attendance && (
                              <button onClick={() => handleExport('attendance')} className="flex flex-col items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                                 <ClipboardCheck className="text-primary group-hover:scale-110" size={20} />
                                 <span className="text-[9px] font-black uppercase text-slate-600 dark:text-slate-400">Chamada (CSV)</span>
                              </button>
                           )}

                           {data.settings.advancedModes?.grades && (
                              <button onClick={() => handleExport('grades')} className="flex flex-col items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                                 <GraduationCap className="text-primary group-hover:scale-110" size={20} />
                                 <span className="text-[9px] font-black uppercase text-slate-600 dark:text-slate-400">Notas (CSV)</span>
                              </button>
                           )}

                           <button onClick={() => handleExport('calendar')} className="flex flex-col items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                              <CalendarIcon className="text-primary group-hover:scale-110" size={20} />
                              <span className="text-[9px] font-black uppercase text-slate-600 dark:text-slate-400">Agenda (ICS)</span>
                           </button>

                           {data.settings.isPrivateTeacher && (
                              <button onClick={() => handleExport('privateLessons')} className="flex flex-col items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                                 <Users className="text-primary group-hover:scale-110" size={20} />
                                 <span className="text-[9px] font-black uppercase text-slate-600 dark:text-slate-400">Aulas Particulares (CSV)</span>
                              </button>
                           )}
                        </div>
                     </section>
                  )
               }
               {/* HARD RESET - APENAS DEV/TESTES */}
               <section className="bg-red-50 dark:bg-red-900/10 p-4 rounded-[32px] shadow-sm border border-red-100 dark:border-red-900/30">
                  <h3 className="text-sm font-black text-red-700 dark:text-red-400 uppercase tracking-tight flex items-center gap-2 mb-4">
                     <AlertTriangle className="text-red-500" size={18} /> Reinício do app - Apagar dados
                  </h3>
                  <p className="text-[10px] font-bold text-red-600 dark:text-red-300 leading-relaxed mb-4">
                     Cuidado: Esta ação é irreversível. Ela apagará todos os seus dados (Escolas, Turmas, Alunos, Diários) tanto do seu dispositivo quanto da nuvem. O app voltará ao estado original de fábrica.
                  </p>
                  <button
                     onClick={handleHardReset}
                     className="w-full py-4 bg-white dark:bg-red-900/20 border-2 border-red-500 text-red-600 dark:text-red-400 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-red-500 hover:text-white transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-100 dark:shadow-none"
                  >
                     <Trash2 size={18} /> Excluir Todos os Meus Dados (Reset)
                  </button>
               </section>
            </div >
         )
         }

         {/* Restante do código mantido (Tabs de Escolas, Horários, Calendário, Turmas) */}
         {/* ... */}
         {
            activeSubTab === 'schools' && (
               <div className="animate-in fade-in slide-in-from-right-4 relative z-40">
                  <SchoolManagement data={data} onUpdateData={onUpdateData} />
               </div>
            )
         }

         {
            activeSubTab === 'schedules' && (
               <div className="animate-in fade-in slide-in-from-right-4 relative z-40">
                  <ScheduleManagement data={data} onUpdateData={onUpdateData} />
               </div>
            )
         }

         {
            activeSubTab === 'calendar' && (
               <div className="animate-in fade-in slide-in-from-right-4 relative z-[60]">
                  {/* Caixa de Seleção Harmonizada */}
                  <div
                     className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 md:p-3.5 rounded-[20px] flex flex-col md:flex-row items-center gap-3 md:gap-4 shadow-sm relative overflow-hidden transition-all"
                     style={{
                        backgroundColor: activeSchoolColorForCal ? activeSchoolColorForCal + '15' : undefined,
                        borderColor: activeSchoolColorForCal ? activeSchoolColorForCal : undefined,
                        borderWidth: activeSchoolColorForCal ? '2px' : undefined
                     }}
                  >
                     <div
                        className="absolute left-0 top-0 bottom-0 w-1.5 bg-indigo-500"
                        style={{ backgroundColor: activeSchoolColorForCal || undefined }}
                     ></div>

                     <div className="flex items-center gap-3 flex-1 w-full pl-2">
                        <div
                           className="p-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 rounded-lg"
                           style={{
                              backgroundColor: activeSchoolColorForCal ? activeSchoolColorForCal + '20' : undefined,
                              color: activeSchoolColorForCal || undefined
                           }}
                        >
                           <Settings size={18} />
                        </div>
                        <div className="flex-1">
                           <label className="block text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Editando Ano Letivo de:</label>
                           <div className="relative">
                              <select
                                 value={activeSchoolIdForCal}
                                 onChange={e => setActiveSchoolIdForCal(e.target.value)}
                                 className="w-full bg-transparent border-none p-0 font-black text-base text-slate-800 dark:text-white outline-none cursor-pointer appearance-none truncate pr-6"
                              >
                                 {data.schools.filter(s => !s.deleted).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </select>
                              <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
                           </div>
                        </div>
                     </div>
                  </div>

                  <div
                     className="bg-white dark:bg-slate-900 rounded-[20px] p-3 md:p-5 shadow-sm border border-slate-100 dark:border-slate-800 space-y-3 md:space-y-4 mt-3 md:mt-4 transition-colors"
                  >
                     <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
                        <div><label className="block text-[8px] md:text-[9px] font-black text-slate-400 uppercase mb-0.5 ml-1">Ano</label><input type="number" value={calForm.year} onChange={e => setCalForm({ ...calForm, year: parseInt(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-800 rounded-xl px-2 py-1.5 md:px-3 md:py-2 font-bold text-xs md:text-sm dark:text-white" /></div>
                        <div><label className="block text-[8px] md:text-[9px] font-black text-slate-400 uppercase mb-0.5 ml-1">Início das Aulas</label><input type="date" value={calForm.start} onChange={e => setCalForm({ ...calForm, start: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 rounded-xl px-2 py-1.5 md:px-3 md:py-2 font-bold text-xs md:text-sm dark:text-white" /></div>
                        <div><label className="block text-[8px] md:text-[9px] font-black text-slate-400 uppercase mb-0.5 ml-1">Término do Ano</label><input type="date" value={calForm.end} onChange={e => setCalForm({ ...calForm, end: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 rounded-xl px-2 py-1.5 md:px-3 md:py-2 font-bold text-xs md:text-sm dark:text-white" /></div>
                     </div>

                     <div className="bg-slate-50 dark:bg-slate-800/50 p-2 md:p-4 rounded-2xl">
                        <label className="block text-[8px] md:text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 md:mb-2 ml-1">Divisão Letiva</label>
                        <div className="grid grid-cols-3 gap-1 md:gap-1.5 p-1 bg-white dark:bg-slate-700 rounded-xl">
                           <button
                              onClick={() => setCalForm({ ...calForm, division: 'trimestres' })}
                              className={`py-1.5 md:py-2 rounded-lg font-black uppercase text-[8px] md:text-[9px] transition-all ${calForm.division === 'trimestres' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-blue-500'}`}
                           >
                              Trimestres
                           </button>
                           <button
                              onClick={() => setCalForm({ ...calForm, division: 'bimestres' })}
                              className={`py-1.5 md:py-2 rounded-lg font-black uppercase text-[8px] md:text-[9px] transition-all ${calForm.division === 'bimestres' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-blue-500'}`}
                           >
                              Bimestres
                           </button>
                           <button
                              onClick={() => setCalForm({ ...calForm, division: 'personalizado' })}
                              className={`py-1.5 md:py-2 rounded-lg font-black uppercase text-[8px] md:text-[9px] transition-all ${calForm.division === 'personalizado' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-blue-500'}`}
                           >
                              Personalizado
                           </button>
                        </div>
                     </div>

                     <div className="grid gap-1.5 md:gap-2">
                        {calForm.terms?.map((term, idx) => (
                           <div key={idx} className="flex flex-col md:flex-row items-center gap-1.5 md:gap-2 bg-slate-50 dark:bg-slate-800 p-1.5 md:p-3 rounded-2xl">
                              <input type="text" value={term.name} onChange={e => { const newTerms = [...calForm.terms!]; newTerms[idx].name = e.target.value; setCalForm({ ...calForm, terms: newTerms }); }} className="w-full md:w-32 bg-white dark:bg-slate-700 rounded-lg px-3 py-1.5 font-black text-[9px] uppercase text-blue-600" />
                              <div className="flex gap-1.5 w-full">
                                 <input type="date" value={term.start} onChange={e => { const nt = [...calForm.terms!]; nt[idx].start = e.target.value; setCalForm({ ...calForm, terms: nt }); }} className="flex-1 bg-white dark:bg-slate-700 rounded-lg px-2 py-1 md:py-1.5 text-[10px] font-bold" />
                                 <input type="date" value={term.end} onChange={e => { const nt = [...calForm.terms!]; nt[idx].end = e.target.value; setCalForm({ ...calForm, terms: nt }); }} className="flex-1 bg-white dark:bg-slate-700 rounded-lg px-2 py-1 md:py-1.5 text-[10px] font-bold" />
                              </div>
                              {calForm.division === 'personalizado' && (
                                 <button onClick={() => removeTerm(idx)} className="p-1.5 text-slate-300 hover:text-red-500 transition-colors">
                                    <Trash2 size={14} />
                                 </button>
                              )}
                           </div>
                        ))}

                        {calForm.division === 'personalizado' && (
                           <button onClick={addTerm} className="flex items-center justify-center gap-2 w-full py-2.5 md:py-3 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all font-black uppercase text-[9px]">
                              <Plus size={12} /> Adicionar Período
                           </button>
                        )}
                     </div>

                     <div className="bg-pink-50 dark:bg-pink-900/10 p-2 md:p-4 rounded-2xl border border-pink-100">
                        <h4 className="text-[9px] md:text-[10px] font-black text-pink-600 uppercase mb-1.5 md:mb-3 flex items-center gap-2"><Palmtree size={14} /> Recesso de Julho</h4>
                        <div className="grid grid-cols-2 gap-2 md:gap-4">
                           <div><label className="block text-[8px] font-black uppercase mb-0.5 ml-1">Início</label><input type="date" value={calForm.midYearBreak?.start} onChange={e => setCalForm({ ...calForm, midYearBreak: { ...calForm.midYearBreak!, start: e.target.value } })} className="w-full bg-white dark:bg-slate-800 rounded-lg px-2 py-1.5 text-[10px] font-bold dark:text-white" /></div>
                           <div><label className="block text-[8px] font-black uppercase mb-0.5 ml-1">Fim</label><input type="date" value={calForm.midYearBreak?.end} onChange={e => setCalForm({ ...calForm, midYearBreak: { ...calForm.midYearBreak!, end: e.target.value } })} className="w-full bg-white dark:bg-slate-800 rounded-lg px-2 py-1.5 text-[10px] font-bold dark:text-white" /></div>
                        </div>
                     </div>

                     <div className="bg-slate-50 dark:bg-slate-800 p-2 md:p-4 rounded-2xl">
                        <div className="flex justify-between items-center mb-1.5 md:mb-3">
                           <h4 className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase flex items-center gap-2">
                              <CalendarRange size={14} /> Recessos
                           </h4>

                           <div className="flex bg-slate-200 dark:bg-slate-700 rounded-lg p-0.5">
                              <button
                                 onClick={() => setHolidayImportMode(false)}
                                 className={`px-3 py-1 rounded-md text-[9px] font-black uppercase transition-all ${!holidayImportMode ? 'bg-white dark:bg-slate-600 text-blue-600 shadow-sm' : 'text-slate-400'}`}
                              >
                                 Manual
                              </button>
                              <button
                                 onClick={() => setHolidayImportMode(true)}
                                 className={`px-3 py-1 rounded-md text-[9px] font-black uppercase transition-all ${holidayImportMode ? 'bg-white dark:bg-slate-600 text-blue-600 shadow-sm' : 'text-slate-400'}`}
                              >
                                 Importar Lista
                              </button>
                           </div>
                        </div>

                        {!holidayImportMode ? (
                           // MODO MANUAL (PRESERVADO)
                           <>
                              <div className="flex justify-end mb-2">
                                 <button onClick={addExtraRecess} className="text-[9px] md:text-[9px] font-black text-blue-600 uppercase transition-colors hover:text-blue-700 flex items-center gap-1">
                                    <Plus size={10} /> Add Dia
                                 </button>
                              </div>
                              <div className="space-y-1.5 md:space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                                 {(calForm.extraRecesses || []).map(r => (
                                    <div key={r.id} className="flex gap-1.5 md:gap-2 items-center animate-in fade-in slide-in-from-left-2">
                                       <input type="text" placeholder="Nome" value={r.name} onChange={e => { const u = calForm.extraRecesses?.map(x => x.id === r.id ? { ...x, name: e.target.value } : x); setCalForm({ ...calForm, extraRecesses: u }); }} className="flex-1 bg-white dark:bg-slate-700 rounded-lg px-2 py-1 md:py-1.5 text-[10px] font-bold dark:text-white" />
                                       <input type="date" value={r.date} onChange={e => { const u = calForm.extraRecesses?.map(x => x.id === r.id ? { ...x, date: e.target.value } : x); setCalForm({ ...calForm, extraRecesses: u }); }} className="bg-white dark:bg-slate-700 rounded-lg px-2 py-1 md:py-1.5 text-[10px] font-bold dark:text-white" />
                                       <button onClick={() => setCopyingRecess(r)} className="text-slate-300 hover:text-blue-500" title="Copiar para outra escola"><Copy size={14} /></button>
                                       <button onClick={() => setCalForm({ ...calForm, extraRecesses: calForm.extraRecesses?.filter(x => x.id !== r.id) })} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button>
                                    </div>
                                 ))}
                                 {(!calForm.extraRecesses || calForm.extraRecesses.length === 0) && (
                                    <div className="text-center py-4 text-[10px] text-slate-400 italic">
                                       Nenhum recesso cadastrado.
                                    </div>
                                 )}
                              </div>
                           </>
                        ) : (
                           // MODO IMPORTAÇÃO EM LOTE (NOVO)
                           <div className="animate-in fade-in zoom-in-95 space-y-3">
                              {!parsedHolidays.length ? (
                                 <>
                                    <textarea
                                       value={holidayImportText}
                                       onChange={e => setHolidayImportText(e.target.value)}
                                       className="w-full h-32 bg-white dark:bg-slate-700 rounded-xl p-3 text-[10px] font-medium border border-slate-200 dark:border-slate-600 focus:ring-2 focus:ring-blue-500 outline-none resize-none dark:text-white"
                                       placeholder={`Cole aqui a lista de recessos de sua escola.\nÉ necessário que a lista seja composta pela DATA do recesso acompanhada do NOME DO RECESSO.\nA lista deve apresentar um recesso por linha.`}
                                    />
                                    <button
                                       onClick={handleParseHolidays}
                                       disabled={!holidayImportText.trim()}
                                       className="w-full py-2 bg-blue-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-blue-700 disabled:opacity-50 transition-all shadow-lg shadow-blue-200 dark:shadow-blue-900/20"
                                    >
                                       Processar Lista
                                    </button>
                                 </>
                              ) : (
                                 <div className="space-y-3">
                                    <div className="bg-amber-50 dark:bg-amber-900/20 p-2 rounded-lg border border-amber-100 dark:border-amber-800">
                                       <p className="text-[9px] text-amber-800 dark:text-amber-200 font-bold text-center">
                                          Encontramos {parsedHolidays.length} datas. Confira abaixo:
                                       </p>
                                    </div>
                                    <div className="max-h-48 overflow-y-auto pr-1 custom-scrollbar space-y-2">
                                       {parsedHolidays.map((h, i) => (
                                          <div key={i} className="flex gap-2 items-center">
                                             <input
                                                type="date"
                                                value={h.date}
                                                onChange={e => {
                                                   const up = [...parsedHolidays];
                                                   up[i].date = e.target.value;
                                                   setParsedHolidays(up);
                                                }}
                                                className="bg-white dark:bg-slate-700 rounded-lg px-2 py-1 text-[10px] font-bold dark:text-white w-24"
                                             />
                                             <input
                                                type="text"
                                                value={h.name}
                                                onChange={e => {
                                                   const up = [...parsedHolidays];
                                                   up[i].name = e.target.value;
                                                   setParsedHolidays(up);
                                                }}
                                                className="flex-1 bg-white dark:bg-slate-700 rounded-lg px-2 py-1 text-[10px] font-bold dark:text-white"
                                             />
                                             <button
                                                onClick={() => setParsedHolidays(parsedHolidays.filter((_, idx) => idx !== i))}
                                                className="text-slate-300 hover:text-red-500"
                                             >
                                                <Trash2 size={14} />
                                             </button>
                                          </div>
                                       ))}
                                    </div>
                                    <div className="flex gap-2">
                                       <button
                                          onClick={() => { setParsedHolidays([]); }}
                                          className="flex-1 py-2 bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300 rounded-xl font-black uppercase text-[10px] hover:bg-slate-300 dark:hover:bg-slate-600 transition-all"
                                       >
                                          Voltar
                                       </button>
                                       <button
                                          onClick={handleConfirmHolidays}
                                          className="flex-[2] py-2 bg-green-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-green-700 transition-all shadow-lg shadow-green-200 dark:shadow-green-900/20"
                                       >
                                          Confirmar Importação
                                       </button>
                                    </div>
                                 </div>
                              )}
                           </div>
                        )}
                     </div>

                     <button
                        onClick={handleSaveCalendar}
                        className={`w-full h-12 rounded-xl font-black uppercase text-xs tracking-widest shadow-lg transition-all duration-300 ease-in-out flex items-center justify-center gap-2 mt-4 ${saveSuccess
                           ? 'bg-green-600 text-white hover:bg-green-700 scale-105 shadow-green-200'
                           : 'bg-indigo-600 text-white hover:bg-indigo-700'
                           }`}
                     >
                        {saveSuccess ? <CheckCircle2 size={18} /> : <FileCheck size={18} />}
                        {saveSuccess ? 'Salvo!' : 'Salvar Alterações'}
                     </button>
                  </div>
               </div>
            )
         }

         {/* Nova Aba de Gerenciamento de Turmas */}
         {
            activeSubTab === 'classes' && hasAdvancedModes && (
               <div className="animate-in fade-in slide-in-from-right-4 space-y-6">
                  <div className="bg-white dark:bg-slate-900 rounded-[40px] p-5 md:p-8 shadow-sm border border-slate-100 dark:border-slate-800">
                     <h3 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-3 mb-6">
                        <Users className="text-primary" /> Gerenciar Alunos por Turma
                     </h3>

                     <div className="grid md:grid-cols-2 gap-4 mb-6">
                        <div>
                           <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Selecione a Escola</label>
                           <select
                              value={rosterSchoolId}
                              onChange={e => { setRosterSchoolId(e.target.value); setRosterClassId(''); }}
                              className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm"
                           >
                              <option value="">Selecione...</option>
                              {data.schools.filter(s => !s.deleted).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                           </select>
                        </div>
                        <div>
                           <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Selecione a Turma</label>
                           <select
                              value={rosterClassId}
                              onChange={e => setRosterClassId(e.target.value)}
                              className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm"
                              disabled={!rosterSchoolId}
                           >
                              <option value="">Selecione...</option>
                              {data.schools.find(s => s.id === rosterSchoolId)?.classes.filter(c => typeof c === 'string' || !c.deleted).map(c => {
                                 const cId = typeof c === 'string' ? c : c.id;
                                 const cName = typeof c === 'string' ? c : c.name;
                                 // Use ID as value, Name as label
                                 return <option key={cId} value={cId}>{cName}</option>;
                              })}
                           </select>
                        </div>
                     </div>

                     {rosterSchoolId && rosterClassId && (
                        <div className="space-y-6 animate-in fade-in zoom-in-95">
                           {currentClassRecord?.createdAt && (
                              <div className="flex gap-4 mb-4 text-[9px] font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl">
                                 <span className="flex items-center gap-1"><Clock size={10} /> Criada em: {new Date(currentClassRecord.createdAt).toLocaleDateString('pt-BR')}</span>
                                 {currentClassRecord.updatedAt && (
                                    <span className="flex items-center gap-1 text-primary"><RefreshCw size={10} /> Atualizada em: {new Date(currentClassRecord.updatedAt).toLocaleDateString('pt-BR')}</span>
                                 )}
                              </div>
                           )}

                           <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">
                                 Adicionar Novos Alunos (Um nome por linha)
                              </label>
                              <textarea
                                 value={newStudentsText}
                                 onChange={e => setNewStudentsText(e.target.value)}
                                 className="w-full h-24 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl p-4 font-medium dark:text-white text-sm focus:ring-2 focus:ring-primary outline-none resize-none"
                                 placeholder={`Ex: João da Silva\nMaria Souza`}
                              />

                              <div className="grid grid-cols-2 gap-2 mt-2">
                                 <button
                                    onClick={handleProcessList}
                                    disabled={!newStudentsText.trim()}
                                    className="py-3 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                 >
                                    <Wand2 size={14} />
                                    Processar Lista
                                 </button>

                                 <button
                                    onClick={handleAddStudents}
                                    disabled={!newStudentsText.trim()}
                                    className={`py-3 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg transition-all duration-300 ease-in-out flex items-center justify-center gap-2 ${addStudentSuccess
                                       ? 'bg-green-600 text-white shadow-green-200 hover:bg-green-700 scale-105'
                                       : 'bg-indigo-600 text-white shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:shadow-none'
                                       }`}
                                 >
                                    {addStudentSuccess ? <Check size={14} /> : null}
                                    {addStudentSuccess ? 'Adicionado!' : 'Adicionar'}
                                 </button>
                              </div>
                              <div className="grid grid-cols-2 gap-2 px-1 mt-2 text-[9px] text-slate-400 font-medium leading-tight text-center">
                                 <p>✨ Limpa, formata e padroniza os nomes automaticamente.</p>
                                 <p>📋 Adiciona os nomes exatamente como digitados acima.</p>
                              </div>
                           </div>

                           <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                 <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                    <Users size={14} /> Alunos Ativos ({activeStudents.length})
                                 </h4>
                                 {currentClassRecord && currentClassRecord.students.length > 0 && (
                                    <button
                                       onClick={handleDeleteAllClassStudents}
                                       className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-black uppercase text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 hover:border-red-300 transition-all"
                                       title="Excluir toda a lista de alunos (Hard Delete)"
                                    >
                                       <Trash2 size={12} />
                                       Excluir Lista Inteira
                                    </button>
                                 )}
                              </div>

                              {activeStudents.length > 0 ? (
                                 <div className="bg-slate-50 dark:bg-slate-800 rounded-3xl p-2 border border-slate-100 dark:border-slate-700 max-h-64 overflow-y-auto custom-scrollbar">
                                    {activeStudents.map(student => (
                                       <div key={student.id} className="flex items-center justify-between p-3 hover:bg-white dark:hover:bg-slate-700/50 rounded-2xl transition-colors group">
                                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 ml-2">{student.name}</span>
                                          <button
                                             onClick={() => handleArchiveStudent(student.id)}
                                             className="flex items-center gap-1.5 px-3 py-1.5 text-[9px] font-black uppercase text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-red-50 hover:text-red-500 hover:border-red-200 dark:hover:bg-red-900/20 dark:hover:border-red-900/50 transition-all group/btn"
                                             title="Arquivar (Sair da Turma)"
                                          >
                                             <UserMinus size={12} className="group-hover/btn:scale-110 transition-transform" />
                                             Arquivar
                                          </button>
                                       </div>
                                    ))}
                                 </div>
                              ) : (
                                 <div className="text-center py-8 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 text-slate-400 text-xs font-bold">
                                    Nenhum aluno ativo nesta turma.
                                 </div>
                              )}
                           </div>

                           {archivedStudents.length > 0 && (
                              <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                                 <button
                                    onClick={() => setShowArchived(!showArchived)}
                                    className={`flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase hover:text-slate-600 transition-colors ${showArchived ? 'mb-3' : ''}`}
                                 >
                                    <Archive size={12} /> {showArchived ? 'Ocultar' : 'Mostrar'} Arquivados ({archivedStudents.length})
                                    <ChevronDown size={12} className={`transition-transform ${showArchived ? 'rotate-180' : ''}`} />
                                 </button>

                                 {showArchived && (
                                    <div className="mt-3 space-y-2 bg-slate-50 dark:bg-slate-800/50 p-2 rounded-2xl">
                                       {archivedStudents.map(student => (
                                          <div key={student.id} className="flex items-center justify-between p-2 rounded-xl opacity-70 hover:opacity-100 transition-opacity">
                                             <div>
                                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 line-through decoration-slate-300 ml-2">{student.name}</span>
                                                {student.disabledAt && <span className="block text-[8px] text-slate-400 ml-2">Saiu em: {new Date(student.disabledAt).toLocaleDateString('pt-BR')}</span>}
                                             </div>
                                             <button
                                                onClick={() => handleRestoreStudent(student.id)}
                                                className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                                                title="Restaurar para a Turma"
                                             >
                                                <RotateCcw size={14} />
                                             </button>
                                          </div>
                                       ))}
                                    </div>
                                 )}
                              </div>
                           )}
                        </div>
                     )}
                  </div>
               </div>
            )
         }

         {/* Aba de Alunos Particulares */}
         {
            activeSubTab === 'privatestudents' && data.settings.isPrivateTeacher && (
               <div className="animate-in fade-in slide-in-from-right-4">
                  <StudentManagement data={data} onUpdateData={onUpdateData} />
               </div>
            )
         }

         {/* Modal de Prévia de Nomes Processados */}
         {
            showPreviewTable && (
               <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in">
                  <div className="bg-white dark:bg-slate-900 rounded-[32px] p-6 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800">
                     <div className="flex-shrink-0 mb-4">
                        <h3 className="text-xl font-black text-slate-800 dark:text-white mb-2 flex items-center gap-2">
                           <Wand2 className="text-blue-600" size={24} />
                           Revisar Nomes Processados
                        </h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                           <strong>{processedList.length} alunos</strong> encontrados. Escolha a formatação e revise antes de adicionar.
                        </p>

                        {/* Seletor de Modo de Formatação */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                           {[
                              {
                                 id: 'intelligent',
                                 label: 'Inteligente',
                                 desc: 'Sobrenome apenas se necessário',
                                 icon: Sparkles
                              },
                              {
                                 id: 'formal',
                                 label: 'Formal',
                                 desc: 'Sempre Nome + Sobrenome',
                                 icon: FileText
                              },
                              {
                                 id: 'abbreviated',
                                 label: 'Abreviado',
                                 desc: 'Nome + Inicial do Sobrenome',
                                 icon: Scissors
                              }
                           ].map((mode) => (
                              <button
                                 key={mode.id}
                                 onClick={() => handleFormatModeChange(mode.id as FormatMode)}
                                 className={`flex flex-col items-start p-3 rounded-xl transition-all text-left ${formatMode === mode.id
                                    ? 'bg-white dark:bg-slate-700 shadow-sm ring-1 ring-slate-200 dark:ring-slate-600'
                                    : 'hover:bg-slate-200/50 dark:hover:bg-slate-700/50'
                                    }`}
                              >
                                 <div className="flex items-center gap-2 mb-1">
                                    <mode.icon size={14} className={formatMode === mode.id ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'} />
                                    <span className={`text-xs font-black uppercase tracking-wide ${formatMode === mode.id ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
                                       }`}>
                                       {mode.label}
                                    </span>
                                 </div>
                                 <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium leading-tight">
                                    {mode.desc}
                                 </span>
                              </button>
                           ))}
                        </div>
                     </div>

                     <div className="flex-1 overflow-y-auto min-h-0 mb-6 border border-slate-200 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
                        <table className="w-full">
                           <thead className="bg-slate-100 dark:bg-slate-800 sticky top-0 z-10 shadow-sm">
                              <tr>
                                 <th className="px-5 py-3 text-left text-[10px] font-black uppercase text-slate-500 dark:text-slate-400 w-1/2">
                                    Nome Original
                                 </th>
                                 <th className="px-5 py-3 text-left text-[10px] font-black uppercase text-blue-600 dark:text-blue-400 w-1/2">
                                    Como será salvo (Editável)
                                 </th>
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                              {processedList.map((student, idx) => {
                                 const isHomonym = student.displayName.includes(' ') && formatMode === 'intelligent';
                                 return (
                                    <tr key={idx} className="group hover:bg-white dark:hover:bg-slate-800 transition-colors">
                                       <td className="px-5 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                                          {student.originalName}
                                       </td>
                                       <td className="px-4 py-2">
                                          <div className="relative">
                                             <input
                                                type="text"
                                                value={editedNames[idx] || ''}
                                                onChange={(e) => {
                                                   const newNames = [...editedNames];
                                                   newNames[idx] = e.target.value;
                                                   setEditedNames(newNames);
                                                }}
                                                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all placeholder-slate-300"
                                             />
                                             {isHomonym && (
                                                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                                                   <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded border border-amber-100 dark:border-amber-900/30">
                                                      homônimo
                                                   </span>
                                                </div>
                                             )}
                                          </div>
                                       </td>
                                    </tr>
                                 );
                              })}
                           </tbody>
                        </table>
                     </div>

                     <div className="flex gap-3 flex-shrink-0">
                        <button
                           onClick={() => {
                              setShowPreviewTable(false);
                              setProcessedList([]);
                              setEditedNames([]);
                           }}
                           className="flex-1 py-4 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                        >
                           Cancelar
                        </button>
                        <button
                           onClick={confirmProcessedList}
                           className="flex-[2] py-4 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 dark:shadow-blue-900/20 flex items-center justify-center gap-2 group"
                        >
                           <Check size={18} className="group-hover:scale-110 transition-transform" />
                           Confirmar e Importar {editedNames.filter(n => n.trim()).length} Alunos
                        </button>
                     </div>
                  </div>
               </div>
            )
         }

         {/* Modal de Cópia de Recesso */}
         {
            copyingRecess && (
               <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in">
                  <div className="bg-white dark:bg-slate-900 rounded-[32px] p-6 max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                     <h3 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2 justify-center mb-4">
                        <Copy size={16} className="text-blue-600" />
                        Copiar Recesso
                     </h3>

                     <p className="text-[10px] text-center text-slate-500 font-medium mb-4 bg-slate-50 dark:bg-slate-800 p-2 rounded-xl">
                        Selecionar escola de destino para: <br />
                        <strong className="text-slate-800 dark:text-white text-xs">
                           {calForm.extraRecesses?.find(r => r.id === copyingRecess.id)?.name || copyingRecess.name}
                        </strong>
                     </p>

                     <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                        {data.schools
                           .filter(s => s.id !== activeSchoolIdForCal)
                           .map(s => (
                              <button
                                 key={s.id}
                                 onClick={() => confirmCopyRecess(s.id)}
                                 className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-blue-600 dark:hover:bg-blue-600 text-left transition-all flex items-center justify-between group border border-transparent hover:shadow-lg hover:shadow-blue-200 dark:hover:shadow-blue-900/20"
                              >
                                 <span className="text-xs font-bold text-slate-600 dark:text-slate-300 group-hover:text-white">
                                    {s.name}
                                 </span>
                                 <Copy size={14} className="text-slate-300 group-hover:text-white/80" />
                              </button>
                           ))}
                        {data.schools.filter(s => s.id !== activeSchoolIdForCal).length === 0 && (
                           <div className="text-center py-4 text-[10px] text-slate-400 italic">
                              Nenhuma outra escola cadastrada.
                           </div>
                        )}
                     </div>
                     <button
                        onClick={() => setCopyingRecess(null)}
                        className="w-full mt-4 py-3 rounded-xl text-[10px] font-black uppercase text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 hover:dark:text-slate-200 transition-colors"
                     >
                        Cancelar
                     </button>
                  </div>
               </div>
            )
         }

         {/* Seção de Finalização Inline (Onboarding) */}
         {
            isOnboarding && (
               <div className="mt-12 mb-8 bg-slate-50 dark:bg-slate-800/50 rounded-3xl p-6 md:p-8 text-center border border-slate-100 dark:border-slate-800 animate-in slide-in-from-bottom-4">
                  <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                     <Sparkles size={32} />
                  </div>
                  <h3 className="text-xl font-black text-slate-800 dark:text-white mb-2">Tudo Pronto?</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-6 leading-relaxed">
                     Se você já cadastrou suas escolas, turmas e calendário, clique abaixo para liberar seu diário de classe.
                  </p>
                  <button
                     onClick={handleFinishOnboarding}
                     className="bg-green-600 text-white px-10 py-4 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-green-200 animate-pulse hover:animate-none hover:scale-105 hover:bg-green-700 transition-all flex items-center gap-2 mx-auto"
                  >
                     <CheckCircle2 size={24} /> Finalizar e Começar
                  </button>
               </div>
            )
         }

         {/* RODAPÉ DO MENU AJUSTES */}
         <div className="pt-10 pb-8 text-center opacity-60">
            <p className="text-[10px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-widest">
               Leciona v1.5.0
            </p>
            <p className="text-[9px] font-bold text-slate-300 dark:text-slate-600 mt-1">
               Criado para professores pelo professor Cadu Michel • caduhist@gmail.com
            </p>
         </div>

         {/* Modal de Sucesso */}
         {
            showSuccessModal && (
               <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
                  <div className="bg-white dark:bg-slate-900 p-8 rounded-[40px] shadow-2xl max-w-md w-full text-center border-4 border-slate-100 dark:border-slate-800 relative overflow-hidden">
                     <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-green-400 to-emerald-500"></div>
                     <div className="mx-auto w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center text-green-600 dark:text-green-400 mb-6 shadow-sm">
                        <CheckCircle2 size={40} />
                     </div>
                     <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-3 tracking-tight">Tudo Pronto! 🚀</h2>
                     <p className="text-sm font-medium text-slate-500 dark:text-slate-400 leading-relaxed mb-8">
                        Sua configuração básica foi salva com sucesso.
                        <br /><br />
                        <span className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-3 py-1 rounded-lg text-xs font-bold inline-block border border-indigo-100 dark:border-indigo-800">
                           Dica Pro
                        </span>
                        <br />
                        O Leciona também pode gerenciar <strong className="text-slate-700 dark:text-slate-300">Chamada Nominal</strong>, <strong className="text-slate-700 dark:text-slate-300">Notas</strong>, <strong className="text-slate-700 dark:text-slate-300">Ocorrências</strong> e <strong className="text-slate-700 dark:text-slate-300">Alertas</strong> personalizados.
                        <br />
                        Quando tiver um tempo, vá em 'Ajustes' para ativar esses recursos.
                     </p>
                     <button
                        onClick={confirmFinish}
                        className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-4 rounded-2xl font-black uppercase tracking-widest hover:scale-[1.02] transition-transform shadow-lg"
                     >
                        Ir para o Início
                     </button>
                  </div>
               </div>
            )
         }
      </div >

   );
};

export default SettingsPanel;