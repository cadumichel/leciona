import React, { useState, useMemo, useEffect } from 'react';
import { AppData, School, DayOfWeek, Shift, TimeSlot, ScheduleEntry, Student, PrivateSchedule, ScheduleVersion, LessonLog, SchoolEvent } from '../types';
import { DAYS_OF_WEEK_NAMES } from '../constants';
import { Plus, Trash2, LayoutGrid, Calendar as CalendarIcon, CalendarDays, Save, Info, AlertCircle, User, Clock, ShieldAlert, Layers, ChevronDown, Check, ArrowRight, PackageX } from 'lucide-react';
import { MigrationWizard, MigrationDecision } from './MigrationWizard';
import { checkTimeOverlap, formatDateBR, todayLocal } from '../utils';
import { getClassName } from '../utils/classRefs';
import { ScheduleChangePlan, applyScheduleDecisions, nextVersionStart, planScheduleChange } from '../utils/scheduleChange';

interface ScheduleManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
}

const ScheduleManagement: React.FC<ScheduleManagementProps> = ({ data, onUpdateData }) => {
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(1); // Monday por padrão
  const [showWeekends, setShowWeekends] = useState(false); // Toggle Sábado/Domingo
  // Semana inteira: todos os dias da escola numa tabela (ver e editar)
  const [weekView, setWeekView] = useState(false);

  // VERSIONAMENTO
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [newVersionDate, setNewVersionDate] = useState('');

  // MIGRATION WIZARD
  // Ajuste do planejamento futuro (utils/scheduleChange.ts): o que muda a partir da data da grade
  const [migrationData, setMigrationData] = useState<(ScheduleChangePlan & {
    pendingVersion?: ScheduleVersion;
    /** Excluir esta versão (a grade anterior volta a valer a partir da data dela) */
    deleteVersionId?: string;
    activeFrom: string;
    newSchedules: ScheduleEntry[];
  }) | null>(null);
  const [showMigrationModal, setShowMigrationModal] = useState(false);

  // LOCAL STATE FOR EDITS (Commit Strategy)
  const [editedSchedules, setEditedSchedules] = useState<ScheduleEntry[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  // Inicializar versão selecionada (pegar a mais recente ou a primeira)
  useEffect(() => {
    if (data.scheduleVersions && data.scheduleVersions.length > 0 && !selectedVersionId) {
      // Sort by activeFrom descending
      const sorted = [...data.scheduleVersions].sort((a, b) => b.activeFrom.localeCompare(a.activeFrom));
      setSelectedVersionId(sorted[0].id);
    }
  }, [data.scheduleVersions, selectedVersionId]);

  const currentVersion = useMemo(() => {
    return data.scheduleVersions?.find(v => v.id === selectedVersionId) || null;
  }, [data.scheduleVersions, selectedVersionId]);

  // Sync editedSchedules with currentVersion when version changes
  useEffect(() => {
    console.log("Syncing editedschedules", currentVersion?.schedules);
    if (currentVersion) {
      setEditedSchedules(currentVersion.schedules);
      setHasChanges(false);
    } else {
      setEditedSchedules(data.schedules || []);
      setHasChanges(false);
    }
  }, [currentVersion, data.schedules]); // Depend only on version switch or initial load

  const sortedVersions = useMemo(() => {
    return [...(data.scheduleVersions || [])].sort((a, b) => b.activeFrom.localeCompare(a.activeFrom));
  }, [data.scheduleVersions]);


  // Reset selected day if weekends are hidden while active
  useEffect(() => {
    if (!showWeekends && (selectedDay === 6 || selectedDay === 0)) {
      setSelectedDay(1);
    }
  }, [showWeekends, selectedDay]);

  // Safe initial ID selection
  const safeSchools = (data?.schools || []).filter(s => !s.deleted);
  const safeStudents = data?.students || [];

  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string>(
    safeSchools[0]?.id || safeStudents[0]?.id || ''
  );

  const activeInstitution = useMemo(() => {
    if (!data) return null;
    const school = (data.schools || []).find(s => s.id === selectedInstitutionId);
    if (school) return { type: 'school' as const, data: school };
    const student = (data.students || []).find(s => s.id === selectedInstitutionId);
    if (student) return { type: 'student' as const, data: student };
    return null;
  }, [data?.schools, data?.students, selectedInstitutionId]);

  // FIX: Auto-reset selection when the selected institution is deleted or doesn't exist
  useEffect(() => {
    if (selectedInstitutionId) {
      const schoolExists = safeSchools.find(s => s.id === selectedInstitutionId);
      const studentExists = safeStudents.find(s => s.id === selectedInstitutionId);

      // If the selected institution was deleted, automatically select the first available one
      if (!schoolExists && !studentExists) {
        const newId = safeSchools[0]?.id || safeStudents[0]?.id || '';
        if (newId !== selectedInstitutionId) {
          setSelectedInstitutionId(newId);
        }
      }
    } else if (safeSchools.length > 0 || safeStudents.length > 0) {
      const newId = safeSchools[0]?.id || safeStudents[0]?.id || '';
      if (newId !== selectedInstitutionId) setSelectedInstitutionId(newId);
    }
  }, [data?.schools, data?.students, selectedInstitutionId, safeSchools, safeStudents]);

  // Horários particulares num dia (conflitam com as aulas das escolas)
  const privateConflictsOn = (day: DayOfWeek) => (data?.students || []).flatMap(st =>
    (st.schedules || [])
      .filter(s => Number(s.dayOfWeek) === Number(day))
      .map(s => ({ ...s, studentName: st.name, studentColor: st.color, studentId: st.id }))
  );

  /** Horário já ocupado por aula particular ou por outra escola nesse dia */
  const slotConflicts = (day: DayOfWeek, slot: TimeSlot) => {
    if (activeInstitution?.type !== 'school') return { studentConflict: null, otherSchoolConflict: null };
    const studentConflict = privateConflictsOn(day).find(pc =>
      checkTimeOverlap(slot.startTime, slot.endTime, pc.startTime, pc.endTime)) || null;
    const conflictingSchedule = editedSchedules.find(s => {
      if (Number(s.dayOfWeek) !== Number(day)) return false;
      if (s.schoolId === selectedInstitutionId) return false; // Ignora a mesma escola
      const otherSchool = (data.schools || []).find(sc => sc.id === s.schoolId);
      if (!otherSchool || otherSchool.deleted) return false;
      const otherSlot = otherSchool.shifts?.find(sh => sh.id === s.shiftId)?.slots.find(sl => sl.id === s.slotId);
      if (!otherSlot) return false;
      return checkTimeOverlap(slot.startTime, slot.endTime, otherSlot.startTime, otherSlot.endTime);
    });
    const conflictSchool = conflictingSchedule && (data.schools || []).find(s => s.id === conflictingSchedule.schoolId);
    const otherSchoolConflict = conflictingSchedule ? {
      schoolName: conflictSchool?.name || 'Outra escola',
      schoolColor: conflictSchool?.color || '#6366f1',
      className: conflictingSchedule.activityLabel || getClassName(data, conflictingSchedule.schoolId, conflictingSchedule.classId)
    } : null;
    return { studentConflict, otherSchoolConflict };
  };

  const institutionShifts = useMemo(() => {
    if (!activeInstitution) return [];
    if (activeInstitution.type === 'school') {
      const orderWeights: Record<string, number> = { 'Matutino': 1, 'Vespertino': 2, 'Noturno': 3 };
      // Safe access to shifts
      return [...(activeInstitution.data.shifts || [])].sort((a, b) => (orderWeights[a?.name] || 99) - (orderWeights[b?.name] || 99));
    } else {
      // Exibe apenas os horários reais cadastrados para o aluno
      return [{
        id: 'particular',
        name: 'Aulas Agendadas',
        slots: (activeInstitution.data.schedules || [])
          .filter(s => Number(s.dayOfWeek) === Number(selectedDay))
          .map(s => ({
            id: s.id,
            startTime: s.startTime,
            endTime: s.endTime,
            type: 'class' as const,
            label: 'Aula Particular'
          }))
      }];
    }
  }, [activeInstitution, selectedDay]);

  const activeColor = activeInstitution?.data?.color;
  const showWeek = weekView && activeInstitution?.type === 'school';
  const weekDays = ([1, 2, 3, 4, 5, 6, 0] as DayOfWeek[]).filter(d => showWeekends || (d !== 6 && d !== 0));

  /** Opções de cada horário da escola: livre, janela, atividade fixa e as turmas */
  const schoolClassOptions = (school: School, short = false) => (
    <>
      <option value="">Livre</option>
      <option value="window" className="text-amber-600 font-bold">Janela / Livre</option>
      <option value={ACTIVITY_OPTION} className="text-teal-600 font-bold">{short ? 'Atividade fixa' : 'Atividade fixa (sem turma)'}</option>
      {(school.classes || []).filter(c => typeof c === 'string' || !c.deleted).sort((a, b) => (typeof a === 'string' ? a : a.name).localeCompare(typeof b === 'string' ? b : b.name)).map((c, i) => {
        const name = typeof c === 'string' ? c : c.name;
        const key = typeof c === 'string' ? `${c}-${i}` : c.id;
        return <option key={key} value={name}>{name}</option>;
      })}
    </>
  );

  const handleCreateVersion = () => {
    if (!newVersionDate) {
      alert("Selecione uma data para a nova versão.");
      return;
    }

    if (data.scheduleVersions?.some(v => v.activeFrom === newVersionDate)) {
      alert("Já existe uma versão para esta data.");
      return;
    }

    // Clone current schedule (or empty if none)
    const baseSchedules = currentVersion ? [...currentVersion.schedules] : [...(data.schedules || [])];

    const newVersion: ScheduleVersion = {
      id: crypto.randomUUID(),
      activeFrom: newVersionDate,
      createdAt: new Date().toLocaleDateString('en-CA'),
      name: `Versão ${new Date(newVersionDate + 'T00:00:00').getFullYear()}`,
      schedules: baseSchedules
    };

    // Alterações ainda não salvas vão para a nova versão: valem só a partir da data dela
    if (hasChanges) {
      const pendingVersion = { ...newVersion, schedules: editedSchedules };
      const analysis = planScheduleChange(
        data, baseSchedules, editedSchedules, newVersionDate,
        nextVersionStart(data, newVersionDate, newVersion.id)
      );
      setIsVersionModalOpen(false);
      if (analysis.orphans.length > 0 || analysis.orphanEvents.length > 0) {
        setMigrationData({ ...analysis, pendingVersion, activeFrom: newVersionDate, newSchedules: editedSchedules });
        setShowMigrationModal(true);
        return;
      }
      onUpdateData({ scheduleVersions: [...(data.scheduleVersions || []), pendingVersion] });
      setSelectedVersionId(newVersion.id);
      setNewVersionDate('');
      return;
    }

    // A nova versão começa como cópia da grade atual: nada muda até ela ser editada e salva
    // No migrations needed, save directly
    onUpdateData({
      scheduleVersions: [...(data.scheduleVersions || []), newVersion]
    });

    setSelectedVersionId(newVersion.id);
    setIsVersionModalOpen(false);
    setNewVersionDate('');
  };



  const executeMigration = (migrate: boolean, decisions?: MigrationDecision[]) => {
    if (!migrationData) return;
    // Grava as decisões (utils/scheduleChange.ts)
    const { logs, events, grades } = migrate
      ? applyScheduleDecisions(data, migrationData, decisions || [])
      : { logs: data.logs || [], events: data.events || [], grades: data.grades || [] };

    let updatedVersions = data.scheduleVersions || [];
    if (migrationData.deleteVersionId) {
      updatedVersions = updatedVersions.filter(v => v.id !== migrationData.deleteVersionId);
    } else if (migrationData.pendingVersion) {
      const exists = updatedVersions.some(v => v.id === migrationData.pendingVersion!.id);
      updatedVersions = exists
        ? updatedVersions.map(v => (v.id === migrationData.pendingVersion!.id ? migrationData.pendingVersion! : v))
        : [...updatedVersions, migrationData.pendingVersion];
    }

    onUpdateData({ scheduleVersions: updatedVersions, logs, events, grades });

    if (migrationData.deleteVersionId) {
      const remaining = [...updatedVersions].sort((a, b) => b.activeFrom.localeCompare(a.activeFrom));
      setSelectedVersionId(remaining[0]?.id || '');
    } else if (selectedVersionId === migrationData.pendingVersion?.id) {
      setHasChanges(false);
    } else if (migrationData.pendingVersion) {
      setSelectedVersionId(migrationData.pendingVersion.id);
    }

    setShowMigrationModal(false);
    setMigrationData(null);
    setNewVersionDate('');
  };

  const handleSaveVersion = () => {
    try {
      if (!currentVersion) return;

      // 1. O que muda no planejamento entre a grade salva e a editada, só no período desta versão
      const analysis = planScheduleChange(
        data, currentVersion.schedules, editedSchedules, currentVersion.activeFrom,
        nextVersionStart(data, currentVersion.activeFrom, currentVersion.id)
      );

      // 2. Prepare pending update
      const pendingUpdate = {
        ...currentVersion,
        schedules: editedSchedules
      };

      // 3. If migration needed -> Show Wizard
      if (analysis.orphans.length > 0 || analysis.orphanEvents.length > 0) {
        setMigrationData({ ...analysis, pendingVersion: pendingUpdate, activeFrom: currentVersion.activeFrom, newSchedules: editedSchedules });
        setShowMigrationModal(true);
        return;
      }

      // 4. No migration needed -> Commit immediately
      const updatedVersions = data.scheduleVersions.map(v =>
        v.id === currentVersion.id ? pendingUpdate : v
      );

      onUpdateData({ scheduleVersions: updatedVersions });
      setHasChanges(false);
    } catch (err: any) {
      alert("Erro ao salvar: " + err.message);
      console.error(err);
    }
  };

  const ACTIVITY_OPTION = '__activity';

  /** Renomeia a atividade fixa de um horário (só na grade em edição) */
  const handleRenameActivity = (shiftId: string, slotId: string, label: string, day: DayOfWeek = selectedDay) => {
    setEditedSchedules(editedSchedules.map(s =>
      Number(s.dayOfWeek) === Number(day) && s.schoolId === selectedInstitutionId && s.shiftId === shiftId && s.slotId === slotId
        ? { ...s, activityLabel: label } : s));
    setHasChanges(true);
  };

  const handleUpdateSchedule = (shiftId: string, slotId: string, value: string, day: DayOfWeek = selectedDay) => {
    // Atividade fixa = horário sem turma (como a Janela), com nome próprio
    const isActivity = value === ACTIVITY_OPTION;
    const classId = isActivity ? 'window' : value;
    if (!activeInstitution || activeInstitution.type === 'student') return;
    if (!currentVersion) {
      alert("Nenhuma versão de grade selecionada. Crie uma versão primeiro.");
      return;
    }

    // USE EDITED SCHEDULES
    let newSchedules = [...editedSchedules];

    if (!classId) {
      // Remove
      newSchedules = newSchedules.filter(s =>
        !(Number(s.dayOfWeek) === Number(day) && s.schoolId === selectedInstitutionId && s.shiftId === shiftId && s.slotId === slotId)
      );
    } else {
      // Update/Add
      // Check Conflicts within THIS version (using editedSchedules)
      const shift = institutionShifts.find(sh => sh.id === shiftId);
      const slot = shift?.slots?.find(sl => sl.id === slotId);

      if (slot) {
        // Verifica conflito com outras escolas NA MESMA VERSÃO
        const schoolConflict = newSchedules.find(s => {
          if (Number(s.dayOfWeek) === Number(day) && s.schoolId === selectedInstitutionId && s.shiftId === shiftId && s.slotId === slotId) {
            return false; // Ignore self
          }
          if (Number(s.dayOfWeek) === Number(day)) {
            const otherInst = data.schools?.filter(s => !s.deleted).find(os => os.id === s.schoolId);
            if (!otherInst) return false;
            const otherSlot = otherInst.shifts?.find(osh => osh.id === s.shiftId)?.slots?.find(osl => osl.id === s.slotId);
            if (otherSlot) {
              return checkTimeOverlap(slot.startTime, slot.endTime, otherSlot.startTime, otherSlot.endTime);
            }
          }
          return false;
        });

        const privateConflict = privateConflictsOn(day).find(pc =>
          checkTimeOverlap(slot.startTime, slot.endTime, pc.startTime, pc.endTime)
        );

        if (schoolConflict || privateConflict) {
          const conflictName = schoolConflict ? getClassName(data, schoolConflict.schoolId, schoolConflict.classId) : privateConflict?.studentName;
          alert(`CONFLITO DE HORÁRIO!\nVocê já tem uma aula (${conflictName}) agendada neste mesmo horário.`);
          return;
        }
      }

      // Remove existing for this slot
      newSchedules = newSchedules.filter(s =>
        !(Number(s.dayOfWeek) === Number(day) && s.schoolId === selectedInstitutionId && s.shiftId === shiftId && s.slotId === slotId)
      );

      // Add new
      newSchedules.push({
        id: crypto.randomUUID(),
        dayOfWeek: Number(day) as DayOfWeek,
        schoolId: selectedInstitutionId,
        shiftId,
        slotId,
        classId,
        ...(isActivity ? { activityLabel: 'Aplicação de provas' } : {})
      });
    }

    // UPDATE LOCAL STATE ONLY - DO NOT SAVE YET
    setEditedSchedules(newSchedules);
    setHasChanges(true);
  };

  /** Semana inteira: uma tabela por turno, com os dias nas colunas e os horários nas linhas */
  const renderWeekGrid = (school: School, shifts: Shift[]) => shifts.map(shift => (
    <div key={shift.id} className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 animate-in fade-in duration-300">
      <h3 className="text-[13px] font-black text-slate-800 dark:text-slate-100 mb-3 flex items-center gap-2 uppercase tracking-tight">
        <LayoutGrid className="text-primary" size={18} /> Turno: {shift.name}
      </h3>
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full table-fixed border-separate" style={{ borderSpacing: '4px 3px', minWidth: 96 + weekDays.length * 116 }}>
          <thead>
            <tr>
              <th style={{ width: 92 }} className="sticky left-0 z-10 bg-white dark:bg-slate-900" />
              {weekDays.map(d => (
                <th key={d} className="text-[10px] font-black uppercase tracking-tight text-slate-500 dark:text-slate-400 pb-1">
                  {DAYS_OF_WEEK_NAMES[d]?.slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(shift.slots || []).map(slot => slot.type === 'break' ? (
              <tr key={slot.id}>
                <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 text-[10px] font-bold text-slate-400 whitespace-nowrap">{slot.startTime} - {slot.endTime}</td>
                <td colSpan={weekDays.length} className="text-center font-black text-slate-400 text-[10px] uppercase tracking-tight py-0.5 bg-slate-50 dark:bg-slate-800/50 rounded-md">
                  Intervalo
                </td>
              </tr>
            ) : (
              <tr key={slot.id}>
                <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 align-middle whitespace-nowrap pr-1">
                  <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tight">{slot.label}</p>
                  <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap">{slot.startTime} - {slot.endTime}</p>
                </td>
                {weekDays.map(day => {
                  const entry = editedSchedules.find(s =>
                    Number(s.dayOfWeek) === Number(day) && s.schoolId === school.id && s.shiftId === shift.id && s.slotId === slot.id);
                  const { studentConflict, otherSchoolConflict } = slotConflicts(day, slot);
                  if (studentConflict || otherSchoolConflict) {
                    return (
                      <td key={day} className="align-top">
                        <div
                          className={`px-2 py-1 rounded-lg border text-[10px] font-bold uppercase leading-tight ${studentConflict ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 text-amber-700' : 'bg-indigo-50 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-800'}`}
                          style={otherSchoolConflict && !studentConflict ? { color: otherSchoolConflict.schoolColor } : undefined}
                          title="Horário ocupado"
                        >
                          <span className="flex items-center gap-1 text-slate-500"><ShieldAlert size={10} /> Ocupado</span>
                          {studentConflict
                            ? `Particular: ${studentConflict.studentName}`
                            : `${otherSchoolConflict!.schoolName} • ${otherSchoolConflict!.className !== 'window' ? otherSchoolConflict!.className : 'Janela'}`}
                        </div>
                      </td>
                    );
                  }
                  const isActivity = entry?.activityLabel !== undefined;
                  return (
                    <td key={day} className="align-top">
                      <select
                        value={isActivity ? ACTIVITY_OPTION : (entry?.classId || '')}
                        onChange={e => handleUpdateSchedule(shift.id, slot.id, e.target.value, day)}
                        className={`w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 md:py-1.5 text-xs font-bold outline-none cursor-pointer appearance-none ${isActivity ? 'text-teal-600' :
                          entry?.classId === 'window' ? 'text-amber-600' :
                            entry?.classId ? 'text-primary' : 'text-slate-400'
                          }`}
                        style={entry && !isActivity && entry.classId !== 'window' ? { borderLeft: `3px solid ${school.color}` } : undefined}
                      >
                        {schoolClassOptions(school, true)}
                      </select>
                      {isActivity && (
                        <input
                          value={entry!.activityLabel}
                          onChange={e => handleRenameActivity(shift.id, slot.id, e.target.value, day)}
                          placeholder="Nome da atividade"
                          title="Nome da atividade fixa (ex.: Aplicação de provas)"
                          className="mt-1 w-full bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg px-2 py-1 text-[11px] font-bold text-teal-700 dark:text-teal-300 outline-none"
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ));

  if (!data) return null;

  return (
    <div className="space-y-4">

      {/* --- BOX DE VERSÕES --- */}
      <div className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h3 className="text-[13px] font-black uppercase text-slate-800 dark:text-white tracking-tight mb-2 flex items-center gap-2">
            <Layers className="text-primary" size={18} /> Versão da Grade
          </h3>
          <div className="relative">
            <select
              value={selectedVersionId}
              onChange={(e) => setSelectedVersionId(e.target.value)}
              className="appearance-none bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2.5 pl-3 pr-8 font-bold text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 ring-primary/20 min-w-[200px]"
            >
              {sortedVersions.map(v => (
                <option key={v.id} value={v.id}>
                  Vigente desde {new Date(v.activeFrom + 'T00:00:00').toLocaleDateString('pt-BR')}
                </option>
              ))}
              {sortedVersions.length === 0 && <option value="">Nenhuma versão encontrada</option>}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>

        <div className="flex gap-2">
          {selectedVersionId && sortedVersions.length > 1 && (
            <button
              onClick={() => {
                if (confirm('Tem certeza que deseja excluir esta versão da grade?\n\nA partir da data dela, volta a valer a grade da versão anterior.')) {
                  const versionToDelete = data.scheduleVersions.find(v => v.id === selectedVersionId);
                  if (!versionToDelete) return;
                  const previous = [...data.scheduleVersions]
                    .filter(v => v.id !== versionToDelete.id && v.activeFrom < versionToDelete.activeFrom)
                    .sort((a, b) => b.activeFrom.localeCompare(a.activeFrom))[0]
                    || [...data.scheduleVersions].filter(v => v.id !== versionToDelete.id).sort((a, b) => a.activeFrom.localeCompare(b.activeFrom))[0];
                  // Registros e avaliações a partir dessa data passam a seguir a grade anterior
                  const plan = planScheduleChange(
                    data, versionToDelete.schedules, previous?.schedules || [], versionToDelete.activeFrom,
                    nextVersionStart(data, versionToDelete.activeFrom, versionToDelete.id)
                  );
                  if (plan.orphans.length > 0 || plan.orphanEvents.length > 0) {
                    setMigrationData({ ...plan, deleteVersionId: versionToDelete.id, activeFrom: versionToDelete.activeFrom, newSchedules: previous?.schedules || [] });
                    setShowMigrationModal(true);
                    return;
                  }
                  const updatedVersions = data.scheduleVersions.filter(v => v.id !== selectedVersionId);
                  onUpdateData({ scheduleVersions: updatedVersions });
                  const remaining = updatedVersions.sort((a, b) => b.activeFrom.localeCompare(a.activeFrom));
                  setSelectedVersionId(remaining[0]?.id || '');
                }
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/30 rounded-lg text-red-600 dark:text-red-400 font-black uppercase tracking-tight text-[11px] hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors shadow-sm"
            >
              <Trash2 size={14} /> Excluir
            </button>
          )}

          <button
            onClick={() => setIsVersionModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-primary font-black uppercase tracking-tight text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
          >
            <Plus size={14} /> Nova Versão
          </button>

          {hasChanges && (
            <div className="flex gap-2 animate-in fade-in slide-in-from-right-4 duration-300 ml-2 border-l pl-4 border-slate-200 dark:border-slate-700">
              <button
                onClick={() => {
                  if (currentVersion) setEditedSchedules(currentVersion.schedules);
                  else setEditedSchedules(data.schedules || []);
                  setHasChanges(false);
                }}
                className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-lg font-black uppercase tracking-tight text-[11px] hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Descartar
              </button>
              <button
                onClick={handleSaveVersion}
                className="px-4 py-2.5 bg-primary text-white rounded-lg font-black uppercase tracking-tight text-[11px] hover:brightness-110 shadow-sm transition-all flex items-center gap-2"
              >
                <Save size={14} /> Salvar Alterações
              </button>
            </div>
          )}
        </div>
      </div>

      {hasChanges && currentVersion && currentVersion.activeFrom < todayLocal() && (
        <div className="flex flex-col md:flex-row md:items-center gap-3 p-4 rounded-xl border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 animate-in fade-in duration-300">
          <AlertCircle size={20} className="text-amber-500 shrink-0 hidden md:block" />
          <div className="flex-1 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
            <p className="font-black uppercase tracking-tight text-[11px] mb-0.5">Atenção: a edição vale desde {formatDateBR(currentVersion.activeFrom)}</p>
            <p>
              Ao clicar em <b>Salvar Alterações</b>, toda esta versão da grade muda, inclusive as <b>aulas anteriores</b> (desde {formatDateBR(currentVersion.activeFrom)}).
              Se você quer criar uma nova versão do diário a partir de uma data, clique em <b>Nova Versão</b>: suas alterações vão para ela e as aulas anteriores ficam como estão.
            </p>
          </div>
          <button
            onClick={() => setIsVersionModalOpen(true)}
            className="shrink-0 flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700/50 rounded-lg text-amber-700 dark:text-amber-300 font-black uppercase tracking-tight text-[11px] hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors shadow-sm"
          >
            <Plus size={14} /> Nova Versão
          </button>
        </div>
      )}

      {isVersionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-full max-w-sm animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-black text-slate-800 dark:text-white tracking-tight mb-1">Nova Versão da Grade</h3>
            <p className={`text-xs text-slate-500 ${hasChanges ? 'mb-2' : 'mb-6'}`}>A partir de quando esta nova grade será válida?</p>
            {hasChanges && (
              <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2 mb-6">
                As alterações que você fez na grade (ainda não salvas) vão para a nova versão. Antes dessa data, nada muda.
              </p>
            )}

            <label className="block text-[10px] font-black uppercase text-slate-400 mb-1.5">Data de Início</label>
            <input
              type="date"
              value={newVersionDate}
              onChange={(e) => setNewVersionDate(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-sm font-bold text-slate-700 dark:text-white outline-none focus:ring-2 ring-primary mb-6"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setIsVersionModalOpen(false)}
                className="flex-1 py-2.5 rounded-lg font-black uppercase tracking-tight text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateVersion}
                className="flex-1 py-2.5 rounded-lg font-black uppercase tracking-tight text-[11px] bg-primary text-white shadow-sm hover:brightness-110 transition-all"
              >
                Criar Versão
              </button>
            </div>
          </div>
        </div>
      )}

      <MigrationWizard
        isOpen={showMigrationModal && !!migrationData}
        onClose={() => {
          setShowMigrationModal(false);
          setMigrationData(null);
        }}
        onConfirm={(decisions) => executeMigration(true, decisions)}
        orphans={migrationData?.orphans || []}
        orphanEvents={migrationData?.orphanEvents || []}
        newSchedules={migrationData?.newSchedules || []}
        activeFrom={migrationData?.activeFrom || ''}
        suggestions={migrationData?.suggestions}
        notes={migrationData?.notes}
        schools={data.schools || []}
        appData={data}
      />


      <div
        className="flex flex-col md:flex-row md:items-center gap-4 bg-white dark:bg-slate-900 p-4 md:p-5 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm transition-colors relative overflow-hidden"
        // ... (rest of component, replacing data.schedules with currentVersion.schedules)
        style={{
          backgroundColor: activeColor ? activeColor + '15' : undefined,
          borderColor: activeColor || undefined,
          borderWidth: activeColor ? '2px' : undefined
        }}
      >
        <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: activeColor || 'transparent' }}></div>
        <div className="flex-1">
          <div className="flex justify-between items-center mb-1">
            <label className="block text-[10px] font-black text-slate-500 uppercase">Selecione Instituição/Aluno</label>
            <div className="flex items-center gap-2">
              <label htmlFor="weekendToggle" className="text-[10px] font-bold text-slate-400 cursor-pointer select-none">Mostrar Sábado/Domingo</label>
              <div
                onClick={() => setShowWeekends(!showWeekends)}
                className={`w-8 h-4 rounded-full p-0.5 cursor-pointer transition-colors ${showWeekends ? 'bg-blue-500' : 'bg-slate-200'}`}
              >
                <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${showWeekends ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </div>
          </div>
          <select
            value={selectedInstitutionId}
            onChange={e => setSelectedInstitutionId(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg font-bold text-sm text-slate-700 dark:text-slate-200 py-2.5 px-3 outline-none"
          >
            <optgroup label="Escolas">
              {(data.schools || []).filter(s => !s.deleted).sort((a, b) => a.name.localeCompare(b.name)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
            {data.settings?.isPrivateTeacher && (data.students || []).length > 0 && (
              <optgroup label="Alunos Particulares">
                {(data.students || []).sort((a, b) => a.name.localeCompare(b.name)).map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <div className="flex w-full md:w-auto overflow-x-auto md:overflow-visible gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg no-scrollbar">
          {([1, 2, 3, 4, 5, 6, 0] as DayOfWeek[])
            .filter(d => showWeekends || (d !== 6 && d !== 0))
            .map(dayNum => {
              return (
                <button
                  key={dayNum}
                  onClick={() => { setSelectedDay(dayNum); setWeekView(false); }}
                  className={`flex-1 md:flex-none py-2 px-1 md:px-4 rounded-md text-[10px] md:text-xs font-black uppercase transition-all whitespace-nowrap text-center ${!showWeek && selectedDay === dayNum
                    ? 'bg-white dark:bg-slate-700 text-primary shadow-sm scale-100 md:scale-105'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                    }`}
                >
                  {DAYS_OF_WEEK_NAMES[dayNum]?.slice(0, 3)}
                </button>
              );
            })}
          {activeInstitution?.type === 'school' && (
            <button
              onClick={() => setWeekView(true)}
              title="Ver e editar todos os dias da semana de uma vez"
              className={`flex-1 md:flex-none flex items-center justify-center gap-1 py-2 px-2 md:px-4 rounded-md text-[10px] md:text-xs font-black uppercase transition-all whitespace-nowrap ${showWeek
                ? 'bg-white dark:bg-slate-700 text-primary shadow-sm scale-100 md:scale-105'
                : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                }`}
            >
              <CalendarDays size={13} /> Semana
            </button>
          )}
        </div>
      </div>

      {!activeInstitution ? (
        <div className="bg-white dark:bg-slate-900 p-12 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
          <CalendarIcon className="mx-auto text-slate-300 mb-4" size={48} />
          <p className="text-slate-500 font-medium">Cadastre escolas ou alunos para gerenciar horários.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activeInstitution.type === 'student' && institutionShifts[0]?.slots?.length === 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/10 p-10 text-center rounded-xl border border-amber-100 dark:border-amber-900/30">
              <Clock className="mx-auto text-amber-400 mb-3" size={32} />
              <p className="text-amber-800 dark:text-amber-200 font-black uppercase text-xs">Sem aulas cadastradas para {DAYS_OF_WEEK_NAMES[selectedDay]}</p>
              <p className="text-amber-600 dark:text-amber-400 text-[10px] mt-1">Cadastre horários no menu "Alunos" para visualizá-los aqui.</p>
            </div>
          )}

          {/* Sort shifts chronologically before rendering */}
          {(() => {
            const sortShiftsByTime = (shifts: Shift[]) => {
              return [...shifts].sort((a, b) => {
                // Se não tem slots, coloca no final
                if (!a.slots || a.slots.length === 0) return 1;
                if (!b.slots || b.slots.length === 0) return -1;

                // Compara o horário de início do primeiro slot
                const aStart = a.slots[0].startTime;
                const bStart = b.slots[0].startTime;
                return aStart.localeCompare(bStart);
              });
            };

            const sortedShifts = sortShiftsByTime(institutionShifts);
            if (showWeek && activeInstitution.type === 'school') return renderWeekGrid(activeInstitution.data, sortedShifts);

            return sortedShifts.map(shift => (
              <div key={shift.id} className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 animate-in fade-in duration-300">
                <h3 className="text-[13px] font-black text-slate-800 dark:text-slate-100 mb-3 flex items-center gap-2 uppercase tracking-tight">
                  {activeInstitution.type === 'school' ? <LayoutGrid className="text-primary" size={18} /> : <User className="text-primary" size={18} />}
                  {activeInstitution.type === 'school' ? `Turno: ${shift.name}` : `Horários de ${activeInstitution.data.name}`}
                </h3>
                <div className="grid gap-1.5"> {/* Extrema compactação em mobile: gap-1 */}
                  {(shift.slots || []).map(slot => {
                    const currentSchedule = editedSchedules.find(s =>
                      Number(s.dayOfWeek) === Number(selectedDay) &&
                      s.schoolId === selectedInstitutionId &&
                      s.shiftId === shift.id &&
                      s.slotId === slot.id
                    );

                    const { studentConflict, otherSchoolConflict } = slotConflicts(selectedDay, slot);

                    const hasConflict = studentConflict || otherSchoolConflict;

                    return (
                      <div key={slot.id}
                        className={`relative flex items-center gap-2 p-1.5 md:p-2 lg:py-1 rounded-r-lg border-y border-r transition-all ${ // Compact padding p-1.5 mobile
                          slot.type === 'break'
                            ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 opacity-60 ml-1'
                            : hasConflict
                              ? (studentConflict ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : 'bg-indigo-50 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-800')
                              : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'
                          }`}
                        style={{
                          borderLeft: `4px solid ${studentConflict ? studentConflict.studentColor : otherSchoolConflict ? otherSchoolConflict.schoolColor : (activeInstitution.type === 'school' && !hasConflict) ? activeInstitution.data.color : 'transparent'}`
                        }}
                      >
                        <div className="w-[84px] md:w-24 lg:w-36 shrink-0 lg:flex lg:items-baseline lg:gap-2"> {/* Width ainda menor no mobile; no computador, numa linha só */}
                          <p className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tight mb-0.5 lg:mb-0">{slot.label}</p>
                          <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap">{slot.startTime} - {slot.endTime}</p>
                        </div>

                        {studentConflict ? (
                          <div className="flex-1 flex items-center gap-3 px-3 py-1.5 bg-white dark:bg-slate-900 rounded-lg border border-amber-100">
                            <ShieldAlert className="text-amber-500" size={14} />
                            <div>
                              <p className="text-[10px] font-black text-amber-800 dark:text-amber-200 uppercase">Horário Ocupado</p>
                              <p className="text-[10px] text-amber-600 font-bold uppercase">Aula Particular: {studentConflict.studentName}</p>
                            </div>
                          </div>
                        ) : otherSchoolConflict ? (
                          <div className="flex-1 flex items-center gap-3 px-3 py-1.5 bg-white dark:bg-slate-900 rounded-lg border border-indigo-100">
                            <ShieldAlert className="text-indigo-500" size={14} />
                            <div>
                              <p className="text-[10px] font-black text-indigo-800 dark:text-indigo-200 uppercase">Horário Ocupado</p>
                              <p className="text-[10px] font-bold uppercase" style={{ color: otherSchoolConflict.schoolColor }}>
                                {otherSchoolConflict.schoolName} • {otherSchoolConflict.className !== 'window' ? otherSchoolConflict.className : 'Janela'}
                              </p>
                            </div>
                          </div>
                        ) : slot.type === 'class' ? (
                          <div className="flex-1 flex items-center gap-2 min-w-0">
                          <select
                            value={currentSchedule?.activityLabel !== undefined ? ACTIVITY_OPTION : (currentSchedule?.classId || '')}
                            disabled={activeInstitution.type === 'student'}
                            onChange={e => handleUpdateSchedule(shift.id, slot.id, e.target.value)}
                            className={`flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 md:px-3 py-1 md:py-1.5 text-xs font-bold outline-none cursor-pointer appearance-none ${ // Compactação no input
                              currentSchedule?.activityLabel !== undefined ? 'text-teal-600' :
                              currentSchedule?.classId === 'window' ? 'text-amber-600' :
                                currentSchedule?.classId ? 'text-primary' : 'text-slate-500'
                              } disabled:opacity-100 disabled:bg-white disabled:border-transparent`}
                          >
                            {activeInstitution.type === 'school' ? (
                              schoolClassOptions(activeInstitution.data)
                            ) : (
                              <option value={activeInstitution.data.name}>Atendimento Particular</option>
                            )}
                          </select>
                          {currentSchedule?.activityLabel !== undefined && (
                            <input
                              value={currentSchedule.activityLabel}
                              onChange={e => handleRenameActivity(shift.id, slot.id, e.target.value)}
                              placeholder="Nome da atividade"
                              title="Nome da atividade fixa (ex.: Aplicação de provas)"
                              className="flex-1 min-w-0 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg px-2 py-1 md:py-1.5 text-xs font-bold text-teal-700 dark:text-teal-300 outline-none"
                            />
                          )}
                          </div>
                        ) : (
                          <div className="flex-1 text-center font-black text-slate-500 text-[10px] uppercase tracking-tight py-1">
                            Intervalo
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          })()}
        </div>
      )}
    </div>
  );
};

export default ScheduleManagement;