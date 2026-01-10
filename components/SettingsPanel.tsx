import React, { useState, useMemo, useEffect } from 'react';
import { AppData, AcademicCalendar, Term, Recess, ClassRecord, ClassStudent } from '../types';
import { 
  Download, User, Briefcase, Calendar as CalendarIcon, ShieldCheck, 
  RefreshCw, LogOut, BookOpen, FileCheck, Palette, Moon, Sun, 
  ChevronDown, AlertTriangle, Lightbulb, Quote, School as SchoolIcon, 
  CalendarClock, GraduationCap, Wand2, Palmtree, CalendarRange, Trash2,
  CheckCircle2, Edit3, Settings, LogIn, Plus, Users, LayoutList, ClipboardCheck,
  Archive, RotateCcw, Clock, AlertCircle, Check
} from 'lucide-react';
import { downloadCSV, downloadICS } from '../utils';
import { QuickStartGuide } from '../App';
import SchoolManagement from './SchoolManagement';
import ScheduleManagement from './ScheduleManagement';
import { User as FirebaseUser } from 'firebase/auth';

interface SettingsPanelProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
  onSyncNow: () => void; 
  user?: FirebaseUser | null;
  onLogin?: () => void;
  onLogout?: () => void;
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

const SettingsPanel: React.FC<SettingsPanelProps> = ({ data, onUpdateData, onSyncNow, user, onLogin, onLogout }) => {
  const [activeSubTab, setActiveSubTab] = useState<'general' | 'schools' | 'calendar' | 'schedules' | 'classes'>('general');
  
  // Estados para Filtros de Exportação
  const [filterInstId, setFilterInstId] = useState<string>('all');
  const [filterClassId, setFilterClassId] = useState<string>('all');
  const [filterPeriodIdx, setFilterPeriodIdx] = useState<string>('all'); // Novo filtro

  const [saveSuccess, setSaveSuccess] = useState(false);
  const [addStudentSuccess, setAddStudentSuccess] = useState(false); // Novo estado para sucesso de adição de aluno

  // Estados para Gestão de Calendário 
  const [activeSchoolIdForCal, setActiveSchoolIdForCal] = useState<string>(data.schools[0]?.id || '');
  const schoolCalendar = useMemo(() => data.calendars.find(c => c.schoolId === activeSchoolIdForCal), [data.calendars, activeSchoolIdForCal]);
  const activeSchoolColorForCal = useMemo(() => data.schools.find(s => s.id === activeSchoolIdForCal)?.color, [data.schools, activeSchoolIdForCal]);

  const [calForm, setCalForm] = useState<Partial<AcademicCalendar>>({
    division: 'bimestres',
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

  const availableInstitutions = useMemo(() => {
    return [
      ...data.schools.map(s => ({ id: s.id, name: s.name })),
      ...data.students.map(st => ({ id: st.id, name: st.name + " (Particular)" }))
    ];
  }, [data.schools, data.students]);

  const availableClasses = useMemo(() => {
    if (filterInstId === 'all') {
      return Array.from(new Set([
        ...data.schools.flatMap(s => s.classes),
        ...data.students.map(st => st.name)
      ]));
    }
    const school = data.schools.find(s => s.id === filterInstId);
    if (school) return school.classes;
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
    return currentClassRecord?.students.filter(s => s.active !== false).sort((a,b) => a.name.localeCompare(b.name)) || [];
  }, [currentClassRecord]);

  const archivedStudents = useMemo(() => {
    return currentClassRecord?.students.filter(s => s.active === false).sort((a,b) => a.name.localeCompare(b.name)) || [];
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
    const updatedStudents = [...existingStudents, ...studentsToAdd].sort((a,b) => a.name.localeCompare(b.name));

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

  const handleExport = (type: 'logs' | 'calendar' | 'assessments' | 'occurrences' | 'attendance' | 'grades') => {
    const isFilterActive = filterInstId !== 'all' || filterClassId !== 'all' || filterPeriodIdx !== 'all';

    // Helper para filtrar Logs com base nos seletores e período
    const filterLogs = (logs: any[]) => {
      return logs.filter(l => {
        if (l.type === 'substitution') return false; 
        const instId = l.schoolId || l.studentId;
        const instMatch = filterInstId === 'all' || instId === filterInstId;
        const classMatch = filterClassId === 'all' || l.classId === filterClassId;
        const periodMatch = isDateInSelectedPeriod(l.date);
        
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

  // Garante que o formulário seja populado corretamente ao trocar de aba
  useEffect(() => {
    if (activeSubTab === 'calendar') {
      if (!activeSchoolIdForCal && data.schools.length > 0) {
        setActiveSchoolIdForCal(data.schools[0].id);
      }
    }
  }, [activeSubTab, data.schools, activeSchoolIdForCal]);

  // Carregar dados ao selecionar escola na aba calendario
  useEffect(() => {
    if (activeSubTab === 'calendar') {
      const targetSchoolId = activeSchoolIdForCal || (data.schools.length > 0 ? data.schools[0].id : '');
      const existingCalendar = data.calendars.find(c => c.schoolId === targetSchoolId);

      if (existingCalendar) {
        setCalForm(existingCalendar);
      } else {
        const currentYear = new Date().getFullYear();
        setCalForm({
          division: 'bimestres',
          year: currentYear,
          start: `${currentYear}-02-01`,
          end: `${currentYear}-12-01`,
          terms: [],
          midYearBreak: { start: `${currentYear}-07-01`, end: `${currentYear}-07-31` },
          extraRecesses: []
        });
      }
    }
  }, [activeSubTab, activeSchoolIdForCal, data.calendars, data.schools]);

  const hasAdvancedModes = data.settings.advancedModes && Object.values(data.settings.advancedModes).some(v => v);

  const tabs = [
    { id: 'general', label: 'Geral', icon: User },
    { id: 'schools', label: 'Escolas', icon: SchoolIcon },
    { id: 'calendar', label: 'Ano Letivo', icon: GraduationCap },
    { id: 'schedules', label: 'Horários', icon: CalendarClock },
    ...(hasAdvancedModes ? [{ id: 'classes', label: 'Turmas', icon: Users }] : [])
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-20">
      {data.settings.showQuickStartGuide && (
        <QuickStartGuide onDismiss={() => onUpdateData({ settings: { ...data.settings, showQuickStartGuide: false }})} onNavigate={() => {}} />
      )}

      {/* Navegação Interna de Ajustes */}
      <div className="flex flex-wrap md:flex-nowrap md:justify-center p-1 bg-white dark:bg-slate-900 rounded-[24px] border border-slate-100 dark:border-slate-800 shadow-sm gap-1 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
            className={`flex-shrink-0 flex items-center justify-center gap-2 px-4 md:px-6 py-3 rounded-2xl text-[10px] font-black uppercase transition-all whitespace-nowrap ${
              activeSubTab === tab.id ? 'bg-primary text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <tab.icon size={16} /> {tab.label}
          </button>
        ))}
      </div>

      {activeSubTab === 'general' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
          <section className="bg-white dark:bg-slate-900 p-5 md:p-8 rounded-[40px] shadow-sm border border-slate-100 dark:border-slate-800 transition-colors">
              <h3 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-3 mb-8"><User className="text-primary" /> Perfil Docente</h3>
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="w-full sm:w-32 shrink-0">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Tratamento</label>
                    <div className="relative">
                      <select value={data.profile.title || 'Prof.'} onChange={e => onUpdateData({ profile: { ...data.profile, title: e.target.value as any }})} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-4 py-3 font-bold appearance-none cursor-pointer dark:text-white"><option value="Prof.">Prof.</option><option value="Profª.">Profª.</option></select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Seu Nome</label>
                    <input type="text" value={data.profile.name} onChange={e => onUpdateData({ profile: { ...data.profile, name: e.target.value }})} className="w-full px-5 py-3 bg-slate-50 dark:bg-slate-800 border-none rounded-2xl font-bold dark:text-white" placeholder="Nome do docente" />
                  </div>
                </div>
                <label className={`flex items-center justify-between p-5 rounded-3xl border transition-all cursor-pointer ${data.settings.isPrivateTeacher ? 'bg-primary/5 border-primary/20' : 'bg-slate-50 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800'}`}>
                   <div className="flex items-center gap-4"><div className={`w-10 h-10 rounded-xl flex items-center justify-center ${data.settings.isPrivateTeacher ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-400'}`}><Briefcase size={20} /></div><div><span className="text-sm font-black uppercase tracking-tight dark:text-white">Professor Particular</span><p className="text-[10px] text-slate-400 font-bold uppercase">Ativa a gestão de alunos individuais.</p></div></div>
                   <input type="checkbox" checked={data.settings.isPrivateTeacher} onChange={e => onUpdateData({ settings: { ...data.settings, isPrivateTeacher: e.target.checked }})} className="w-6 h-6 rounded-lg text-primary" />
                </label>
              </div>
          </section>

          {/* BOX CONFIGURAÇÕES AVANÇADAS */}
          <section className="bg-gradient-to-br from-slate-50 to-indigo-50/50 dark:from-slate-900 dark:to-indigo-900/20 p-5 md:p-8 rounded-[40px] shadow-sm border border-indigo-100 dark:border-indigo-900/30 transition-colors">
             <h3 className="text-lg font-black text-indigo-900 dark:text-indigo-100 uppercase tracking-tight flex items-center gap-3 mb-4"><LayoutList className="text-indigo-500" /> Modos Avançados</h3>
             <div className="bg-white/60 dark:bg-black/20 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-900/20 mb-6 flex items-start gap-3">
                <AlertTriangle className="text-indigo-500 shrink-0 mt-0.5" size={16} />
                <p className="text-[10px] text-indigo-800 dark:text-indigo-200 font-bold leading-relaxed">
                   A seleção destes modos torna necessário o cadastro dos nomes dos estudantes na nova aba "Turmas".
                </p>
             </div>
             
             <div className="space-y-3">
                <label className={`flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer bg-white dark:bg-slate-800 ${data.settings.advancedModes?.attendance ? 'border-indigo-300 dark:border-indigo-500 shadow-sm' : 'border-transparent'}`}>
                   <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 rounded-lg"><ClipboardCheck size={18}/></div>
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

                <label className={`flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer bg-white dark:bg-slate-800 ${data.settings.advancedModes?.individualOccurrence ? 'border-indigo-300 dark:border-indigo-500 shadow-sm' : 'border-transparent'}`}>
                   <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 rounded-lg"><Users size={18}/></div>
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

                <label className={`flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer bg-white dark:bg-slate-800 ${data.settings.advancedModes?.grades ? 'border-indigo-300 dark:border-indigo-500 shadow-sm' : 'border-transparent'}`}>
                   <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 rounded-lg"><GraduationCap size={18}/></div>
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

          <section className="bg-white dark:bg-slate-900 p-5 md:p-8 rounded-[40px] shadow-sm border border-slate-100 dark:border-slate-800 transition-colors">
            <h3 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-3 mb-8"><AlertTriangle className="text-amber-500" /> Alertas de Registro</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className={`flex flex-col gap-2 p-5 rounded-3xl border transition-all cursor-pointer ${data.settings.alertAfterLesson ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/20' : 'bg-slate-50 dark:bg-slate-800/40 opacity-60'}`}>
                 <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase dark:text-white">Ao final da Aula</span><input type="checkbox" checked={data.settings.alertAfterLesson} onChange={e => onUpdateData({ settings: { ...data.settings, alertAfterLesson: e.target.checked }})} className="w-5 h-5 rounded text-amber-500" /></div>
                 <div className="flex items-center gap-2 mt-2"><span className="text-[9px] font-black text-slate-400">Avisar</span><select value={data.settings.alertBeforeMinutes} onChange={e => onUpdateData({ settings: { ...data.settings, alertBeforeMinutes: parseInt(e.target.value) }})} className="bg-white dark:bg-slate-700 border-none text-[10px] font-black text-amber-600 px-2 py-1 rounded-lg outline-none"><option value="0">Na hora</option><option value="5">5 min antes</option><option value="10">10 min antes</option></select></div>
              </label>
              <label className={`flex flex-col gap-2 p-5 rounded-3xl border transition-all cursor-pointer ${data.settings.alertAfterShift ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/20' : 'bg-slate-50 dark:bg-slate-800/40 opacity-60'}`}>
                 <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase dark:text-white">Resumo do Turno</span><input type="checkbox" checked={data.settings.alertAfterShift} onChange={e => onUpdateData({ settings: { ...data.settings, alertAfterShift: e.target.checked }})} className="w-5 h-5 rounded text-amber-500" /></div>
                 <p className="text-[9px] text-slate-400 font-bold uppercase mt-2">Notificar pendências ao fim do período.</p>
              </label>
            </div>
          </section>

          <section className="bg-white dark:bg-slate-900 p-5 md:p-8 rounded-[40px] shadow-sm border border-slate-100 dark:border-slate-800 transition-colors">
             <div className="flex justify-between items-start mb-8"><h3 className="text-xl font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-3"><ShieldCheck className="text-primary" /> Conta Leciona (Backup)</h3><div className={`px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${user ? 'bg-green-50 text-green-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>{user ? 'Online' : 'Offline'}</div></div>
             {user ? (
               <div className="flex flex-col gap-4">
                 <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                    {user.photoURL && <img src={user.photoURL} alt="Avatar" className="w-12 h-12 rounded-full" />}
                    <div>
                       <p className="text-sm font-black text-slate-800 dark:text-white">{user.displayName}</p>
                       <p className="text-xs text-slate-500">{user.email}</p>
                    </div>
                 </div>
                 <button onClick={onLogout} className="p-5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-3xl font-black uppercase text-[10px] tracking-widest hover:text-red-500 transition-all flex items-center justify-center gap-2"><LogOut size={18} /> Sair da Conta</button>
               </div>
             ) : (
               <button onClick={onLogin} className="w-full flex items-center justify-center gap-4 py-6 bg-white dark:bg-slate-800 border-2 border-slate-100 dark:border-slate-800 rounded-[32px] font-black uppercase text-xs tracking-widest hover:border-primary transition-all dark:text-white">
                 <LogIn size={18} /> Conectar com Google
               </button>
             )}
          </section>

          <section className="bg-white dark:bg-slate-900 p-5 md:p-8 rounded-[40px] shadow-sm border border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-3 mb-6"><Download className="text-primary" /> Exportar Dados</h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                <select value={filterInstId} onChange={e => { setFilterInstId(e.target.value); setFilterClassId('all'); setFilterPeriodIdx('all'); }} className="bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-4 py-3 text-[10px] font-black uppercase outline-none appearance-none cursor-pointer dark:text-white"><option value="all">Todas Instituições</option>{availableInstitutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
                <select value={filterClassId} onChange={e => setFilterClassId(e.target.value)} className="bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-4 py-3 text-[10px] font-black uppercase outline-none appearance-none cursor-pointer dark:text-white"><option value="all">Todas as Turmas</option>{availableClasses.map(c => <option key={c} value={c}>{c}</option>)}</select>
                <select value={filterPeriodIdx} onChange={e => setFilterPeriodIdx(e.target.value)} disabled={filterInstId === 'all'} className="bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-4 py-3 text-[10px] font-black uppercase outline-none appearance-none cursor-pointer dark:text-white disabled:opacity-50">
                   <option value="all">Todo o Período</option>
                   {periodOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <button onClick={() => handleExport('logs')} className="flex flex-col items-center gap-3 p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                   <BookOpen className="text-primary group-hover:scale-110" />
                   <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-400">Diários (CSV)</span>
                </button>
                
                <button onClick={() => handleExport('assessments')} className="flex flex-col items-center gap-3 p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                   <FileCheck className="text-primary group-hover:scale-110" />
                   <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-400">Avaliações (CSV)</span>
                </button>
                
                <button onClick={() => handleExport('occurrences')} className="flex flex-col items-center gap-3 p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                   <AlertCircle className="text-primary group-hover:scale-110" />
                   <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-400">Ocorrências (CSV)</span>
                </button>

                {data.settings.advancedModes?.attendance && (
                   <button onClick={() => handleExport('attendance')} className="flex flex-col items-center gap-3 p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                      <ClipboardCheck className="text-primary group-hover:scale-110" />
                      <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-400">Chamada (CSV)</span>
                   </button>
                )}

                {data.settings.advancedModes?.grades && (
                   <button onClick={() => handleExport('grades')} className="flex flex-col items-center gap-3 p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                      <GraduationCap className="text-primary group-hover:scale-110" />
                      <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-400">Notas (CSV)</span>
                   </button>
                )}

                <button onClick={() => handleExport('calendar')} className="flex flex-col items-center gap-3 p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800 hover:border-primary transition-all group">
                   <CalendarIcon className="text-primary group-hover:scale-110" />
                   <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-400">Agenda (ICS)</span>
                </button>
              </div>
          </section>
        </div>
      )}

      {/* Restante do código mantido (Tabs de Escolas, Horários, Calendário, Turmas) */}
      {/* ... */}
      {activeSubTab === 'schools' && (
        <div className="animate-in fade-in slide-in-from-right-4">
          <SchoolManagement data={data} onUpdateData={onUpdateData} />
        </div>
      )}

      {activeSubTab === 'schedules' && (
        <div className="animate-in fade-in slide-in-from-right-4">
          <ScheduleManagement data={data} onUpdateData={onUpdateData} />
        </div>
      )}

      {activeSubTab === 'calendar' && (
        <div className="animate-in fade-in slide-in-from-right-4">
          {/* Caixa de Seleção Harmonizada */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 md:p-5 rounded-[24px] flex flex-col md:flex-row items-center gap-3 md:gap-6 shadow-sm relative overflow-hidden">
             <div className="absolute left-0 top-0 bottom-0 w-2 bg-indigo-500"></div>
             
             <div className="flex items-center gap-4 flex-1 w-full pl-2">
                <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 rounded-xl">
                   <Settings size={20} />
                </div>
                <div className="flex-1">
                   <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Editando Ano Letivo de:</label>
                   <div className="relative">
                      <select 
                        value={activeSchoolIdForCal} 
                        onChange={e => setActiveSchoolIdForCal(e.target.value)} 
                        className="w-full bg-transparent border-none p-0 font-black text-lg text-slate-800 dark:text-white outline-none cursor-pointer appearance-none truncate pr-6"
                      >
                        {data.schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                   </div>
                </div>
             </div>

             <button 
                onClick={handleSaveCalendar} 
                className={`w-full md:w-auto h-[40px] md:h-[48px] px-6 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg transition-all duration-300 ease-in-out flex items-center justify-center gap-2 shrink-0 ${
                  saveSuccess 
                    ? 'bg-green-600 text-white hover:bg-green-700 scale-105 shadow-green-200' 
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                }`}
             >
                {saveSuccess ? <CheckCircle2 size={16} /> : <FileCheck size={16} />}
                {saveSuccess ? 'Salvo!' : 'Salvar Alterações'}
             </button>
          </div>

          <div 
            className="bg-white dark:bg-slate-900 rounded-[24px] md:rounded-[40px] p-3 md:p-8 shadow-sm border border-slate-100 dark:border-slate-800 space-y-4 md:space-y-8 mt-4 md:mt-6 transition-colors"
            style={{ 
              backgroundColor: activeSchoolColorForCal ? activeSchoolColorForCal + '10' : undefined,
              borderColor: activeSchoolColorForCal ? activeSchoolColorForCal + '30' : undefined
            }}
          >
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-4">
                 <div><label className="block text-[8px] md:text-[10px] font-black text-slate-400 uppercase mb-1 ml-1">Ano</label><input type="number" value={calForm.year} onChange={e => setCalForm({...calForm, year: parseInt(e.target.value)})} className="w-full bg-slate-50 dark:bg-slate-800 rounded-2xl px-3 py-2 md:px-5 md:py-3 font-bold text-sm md:text-base dark:text-white" /></div>
                 <div><label className="block text-[8px] md:text-[10px] font-black text-slate-400 uppercase mb-1 ml-1">Início das Aulas</label><input type="date" value={calForm.start} onChange={e => setCalForm({...calForm, start: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 rounded-2xl px-3 py-2 md:px-5 md:py-3 font-bold text-sm md:text-base dark:text-white" /></div>
                 <div><label className="block text-[8px] md:text-[10px] font-black text-slate-400 uppercase mb-1 ml-1">Término do Ano</label><input type="date" value={calForm.end} onChange={e => setCalForm({...calForm, end: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 rounded-2xl px-3 py-2 md:px-5 md:py-3 font-bold text-sm md:text-base dark:text-white" /></div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 md:p-6 rounded-3xl flex flex-col md:flex-row md:items-end gap-3 md:gap-6">
                 <div className="flex-1">
                    <label className="block text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 md:mb-3 ml-1">Divisão Letiva</label>
                    <div className="grid grid-cols-3 gap-1 md:gap-2 p-1 bg-white dark:bg-slate-700 rounded-2xl">
                       <button onClick={() => setCalForm({...calForm, division: 'bimestres'})} className={`py-2 md:py-3 rounded-xl font-black uppercase text-[9px] md:text-[10px] transition-all ${calForm.division === 'bimestres' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>Bimestres</button>
                       <button onClick={() => setCalForm({...calForm, division: 'trimestres'})} className={`py-2 md:py-3 rounded-xl font-black uppercase text-[9px] md:text-[10px] transition-all ${calForm.division === 'trimestres' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>Trimestres</button>
                       <button onClick={() => setCalForm({...calForm, division: 'personalizado'})} className={`py-2 md:py-3 rounded-xl font-black uppercase text-[9px] md:text-[10px] transition-all ${calForm.division === 'personalizado' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400'}`}>Personalizado</button>
                    </div>
                 </div>
                 <button onClick={handleCreateTermsSuggestion} className="h-[40px] md:h-[52px] px-8 bg-blue-100 text-blue-600 rounded-2xl font-black uppercase text-[10px] flex items-center justify-center gap-2 hover:bg-blue-600 hover:text-white transition-all"><Wand2 size={16} /> Gerar Períodos</button>
              </div>

              <div className="grid gap-2 md:gap-3">
                {calForm.terms?.map((term, idx) => (
                  <div key={idx} className="flex flex-col md:flex-row items-center gap-2 md:gap-3 bg-slate-50 dark:bg-slate-800 p-2 md:p-4 rounded-3xl">
                     <input type="text" value={term.name} onChange={e => { const newTerms = [...calForm.terms!]; newTerms[idx].name = e.target.value; setCalForm({...calForm, terms: newTerms}); }} className="w-full md:w-40 bg-white dark:bg-slate-700 rounded-xl px-4 py-2 font-black text-[10px] uppercase text-blue-600" />
                     <div className="flex gap-2 w-full">
                        <input type="date" value={term.start} onChange={e => { const nt = [...calForm.terms!]; nt[idx].start = e.target.value; setCalForm({...calForm, terms: nt}); }} className="flex-1 bg-white dark:bg-slate-700 rounded-xl px-3 py-1.5 md:px-4 md:py-2 text-xs font-bold" />
                        <input type="date" value={term.end} onChange={e => { const nt = [...calForm.terms!]; nt[idx].end = e.target.value; setCalForm({...calForm, terms: nt}); }} className="flex-1 bg-white dark:bg-slate-700 rounded-xl px-3 py-1.5 md:px-4 md:py-2 text-xs font-bold" />
                     </div>
                     {calForm.division === 'personalizado' && (
                        <button onClick={() => removeTerm(idx)} className="p-2 text-slate-300 hover:text-red-500 transition-colors">
                           <Trash2 size={16} />
                        </button>
                     )}
                  </div>
                ))}
                
                {calForm.division === 'personalizado' && (
                   <button onClick={addTerm} className="flex items-center justify-center gap-2 w-full py-3 md:py-4 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all font-black uppercase text-[10px]">
                      <Plus size={14} /> Adicionar Período
                   </button>
                )}
              </div>

              <div className="bg-pink-50 dark:bg-pink-900/10 p-3 md:p-6 rounded-3xl border border-pink-100">
                 <h4 className="text-[9px] md:text-[10px] font-black text-pink-600 uppercase mb-2 md:mb-4 flex items-center gap-2"><Palmtree size={14}/> Recesso de Julho</h4>
                 <div className="grid grid-cols-2 gap-2 md:gap-4">
                    <div><label className="block text-[8px] font-black uppercase mb-1 ml-1">Início</label><input type="date" value={calForm.midYearBreak?.start} onChange={e => setCalForm({...calForm, midYearBreak: { ...calForm.midYearBreak!, start: e.target.value }})} className="w-full bg-white dark:bg-slate-800 rounded-xl px-3 py-1.5 md:px-4 md:py-2 text-xs font-bold dark:text-white" /></div>
                    <div><label className="block text-[8px] font-black uppercase mb-1 ml-1">Fim</label><input type="date" value={calForm.midYearBreak?.end} onChange={e => setCalForm({...calForm, midYearBreak: { ...calForm.midYearBreak!, end: e.target.value }})} className="w-full bg-white dark:bg-slate-800 rounded-xl px-3 py-1.5 md:px-4 md:py-2 text-xs font-bold dark:text-white" /></div>
                 </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800 p-3 md:p-6 rounded-3xl">
                 <div className="flex justify-between items-center mb-2 md:mb-4">
                    <h4 className="text-[9px] md:text-[10px] font-black text-slate-500 uppercase flex items-center gap-2"><CalendarRange size={14}/> Recessos Eventuais</h4>
                    <button onClick={addExtraRecess} className="text-[9px] md:text-[10px] font-black text-blue-600 uppercase">+ Add Dia</button>
                 </div>
                 <div className="space-y-2 md:space-y-3">
                    {(calForm.extraRecesses || []).map(r => (
                      <div key={r.id} className="flex gap-2 md:gap-3 items-center">
                         <input type="text" placeholder="Nome" value={r.name} onChange={e => { const u = calForm.extraRecesses?.map(x => x.id === r.id ? {...x, name: e.target.value} : x); setCalForm({...calForm, extraRecesses: u}); }} className="flex-1 bg-white dark:bg-slate-700 rounded-xl px-3 py-1.5 md:py-2 text-xs font-bold" />
                         <input type="date" value={r.date} onChange={e => { const u = calForm.extraRecesses?.map(x => x.id === r.id ? {...x, date: e.target.value} : x); setCalForm({...calForm, extraRecesses: u}); }} className="bg-white dark:bg-slate-700 rounded-xl px-3 py-1.5 md:py-2 text-xs font-bold" />
                         <button onClick={() => setCalForm({...calForm, extraRecesses: calForm.extraRecesses?.filter(x => x.id !== r.id)})} className="text-slate-300 hover:text-red-500"><Trash2 size={16}/></button>
                      </div>
                    ))}
                 </div>
              </div>
          </div>
        </div>
      )}

      {/* Nova Aba de Gerenciamento de Turmas */}
      {activeSubTab === 'classes' && hasAdvancedModes && (
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
                        {data.schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                        {data.schools.find(s => s.id === rosterSchoolId)?.classes.map(c => <option key={c} value={c}>{c}</option>)}
                     </select>
                  </div>
               </div>

               {rosterSchoolId && rosterClassId && (
                  <div className="space-y-6 animate-in fade-in zoom-in-95">
                     {currentClassRecord?.createdAt && (
                        <div className="flex gap-4 mb-4 text-[9px] font-bold uppercase text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl">
                           <span className="flex items-center gap-1"><Clock size={10}/> Criada em: {new Date(currentClassRecord.createdAt).toLocaleDateString('pt-BR')}</span>
                           {currentClassRecord.updatedAt && (
                              <span className="flex items-center gap-1 text-primary"><RefreshCw size={10}/> Atualizada em: {new Date(currentClassRecord.updatedAt).toLocaleDateString('pt-BR')}</span>
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
                        <button 
                           onClick={handleAddStudents} 
                           disabled={!newStudentsText.trim()}
                           className={`w-full mt-2 py-3 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg transition-all duration-300 ease-in-out flex items-center justify-center gap-2 ${
                              addStudentSuccess 
                                ? 'bg-green-600 text-white shadow-green-200 hover:bg-green-700 scale-105' 
                                : 'bg-indigo-600 text-white shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:shadow-none'
                           }`}
                        >
                           {addStudentSuccess ? <Check size={14}/> : null}
                           {addStudentSuccess ? 'Adicionado com Sucesso!' : 'Adicionar à Turma'}
                        </button>
                     </div>

                     <div className="space-y-3">
                        <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                           <Users size={14}/> Alunos Ativos ({activeStudents.length})
                        </h4>
                        
                        {activeStudents.length > 0 ? (
                           <div className="bg-slate-50 dark:bg-slate-800 rounded-3xl p-2 border border-slate-100 dark:border-slate-700 max-h-64 overflow-y-auto custom-scrollbar">
                              {activeStudents.map(student => (
                                 <div key={student.id} className="flex items-center justify-between p-3 hover:bg-white dark:hover:bg-slate-700/50 rounded-2xl transition-colors group">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 ml-2">{student.name}</span>
                                    <button 
                                       onClick={() => handleArchiveStudent(student.id)}
                                       className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                                       title="Arquivar (Sair da Turma)"
                                    >
                                       <Archive size={16} />
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
      )}

      {/* RODAPÉ DO MENU AJUSTES */}
      <div className="pt-10 pb-4 text-center">
        <p className="text-[10px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-widest">
          Leciona v1.5.0
        </p>
        <p className="text-[9px] font-bold text-slate-300 dark:text-slate-600 mt-1">
          Criado para professores pelo professor Cadu Michel • caduhist@gmail.com
        </p>
      </div>
    </div>
  );
};

export default SettingsPanel;