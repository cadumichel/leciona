import React, { useState, useMemo, useEffect } from 'react';
import { AppData, School, DayOfWeek, Shift, TimeSlot, ScheduleEntry, Student, PrivateSchedule, ScheduleVersion } from '../types';
import { DAYS_OF_WEEK_NAMES } from '../constants';
import { Plus, Trash2, LayoutGrid, Calendar as CalendarIcon, Save, Info, AlertCircle, User, Clock, ShieldAlert, Layers, ChevronDown, Check, ArrowRight, PackageX } from 'lucide-react';
import { MigrationWizard, MigrationDecision } from './MigrationWizard';
import { checkTimeOverlap } from '../utils';
import { analyzeMigration, ScheduleChange, AffectedLog, AffectedEvent } from '../utils/scheduleMigration';

interface ScheduleManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
}

const ScheduleManagement: React.FC<ScheduleManagementProps> = ({ data, onUpdateData }) => {
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(1); // Monday por padrão
  const [showWeekends, setShowWeekends] = useState(false); // Toggle Sábado/Domingo

  // VERSIONAMENTO
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);
  const [newVersionDate, setNewVersionDate] = useState('');

  // MIGRATION WIZARD
  const [migrationData, setMigrationData] = useState<{
    changes: ScheduleChange[];
    affectedLogs: AffectedLog[];
    affectedEvents: AffectedEvent[];
    orphans: LessonLog[];
    orphanEvents: SchoolEvent[];
    pendingVersion?: ScheduleVersion;
  } | null>(null);
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

  // Horários particulares que conflitam com o dia selecionado
  const privateConflicts = useMemo(() => {
    return (data?.students || []).flatMap(st =>
      (st.schedules || [])
        .filter(s => Number(s.dayOfWeek) === Number(selectedDay))
        .map(s => ({ ...s, studentName: st.name, studentColor: st.color, studentId: st.id }))
    );
  }, [data?.students, selectedDay]);

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
      createdAt: new Date().toISOString(),
      name: `Versão ${new Date(newVersionDate + 'T00:00:00').getFullYear()}`,
      schedules: baseSchedules
    };

    // Check for migrations before saving
    const analysis = analyzeMigration(
      baseSchedules,
      baseSchedules, // Same for now, changes happen during editing
      data.logs || [],
      data.events || [],
      newVersionDate,
      data.schools || []
    );

    // Store pending version for later
    if (analysis.affectedLogs.length > 0 || analysis.affectedEvents.length > 0) {
      setMigrationData({ ...analysis, pendingVersion: newVersion });
      setShowMigrationModal(true);
      setIsVersionModalOpen(false);
      return;
    }

    // No migrations needed, save directly
    onUpdateData({
      scheduleVersions: [...(data.scheduleVersions || []), newVersion]
    });

    setSelectedVersionId(newVersion.id);
    setIsVersionModalOpen(false);
    setNewVersionDate('');
  };



  const executeMigration = (migrate: boolean, decisions?: MigrationDecision[]) => {
    if (!migrationData?.pendingVersion) return;

    let updatedLogs = data.logs || [];

    // If migrate is true and we have decisions from Wizard
    if (migrate && decisions && decisions.length > 0) {
      updatedLogs = updatedLogs.map(log => {
        const decision = decisions.find(d => d.logId === log.id);

        if (!decision) return log;

        if (decision.type === 'DELETE') {
          // Remove log (or mark as deleted?) -> Let's filter it out or mark status 'removed'
          return { ...log, status: 'removed' };
        }

        if (decision.type === 'EXTRA') {
          // Keep date, remove slotId (becomes extra class)
          // We might want to ensure it has a time if it didn't before, or keep original time
          const { slotId, ...rest } = log; // Remove slotId
          return {
            ...rest,
            // Use targetDate if provided (e.g. custom date selection or calculated new date)
            date: decision.targetDate || log.date,
            // Ensure it's treated as extra, maybe add flag or just lack of slotId is enough?
            // data.logs typings might require slotId to be optional? 
            // Currently Log has slotId string. let's set it to empty string or special value
            slotId: 'extra',
          };
        }

        if (decision.type === 'MOVE' && decision.targetDate && decision.targetSlotId) {
          return {
            ...log,
            date: decision.targetDate,
            slotId: decision.targetSlotId,
            startTime: decision.targetTime?.startTime || log.startTime,
            endTime: decision.targetTime?.endTime || log.endTime
          };
        }

        return log;
      }).filter(l => l.status !== 'removed');
    } else if (!migrate) {
      // User chose NOT to migrate -> Logs remain orphans (old date, old slotId)
      // They will show in History but not in Schedule.
      // No changes needed to logs array.
    }

    let updatedEvents = data.events || [];
    // If migrate is true and we have EVENT decisions from Wizard (TBD)
    // For now, if events are affected, we might just leave them as orphans or auto-migrate
    // The MigrationWizard doesn't yet support events, but we'll apply them if they exist in decisions
    if (migrate && decisions && decisions.length > 0) {
      updatedEvents = updatedEvents.map(event => {
        const decision = decisions.find(d => d.logId === event.id); // Reusing logId for event.id
        if (!decision) return event;

        if (decision.type === 'DELETE') {
          return { ...event, title: event.title + ' (Cancelado)', status: 'removed' } as any; // hacky way, maybe add status to SchoolEvent
        }
        if (decision.type === 'MOVE' && decision.targetDate && decision.targetSlotId) {
          return {
            ...event,
            date: decision.targetDate,
            slotId: decision.targetSlotId,
          };
        }
        if (decision.type === 'EXTRA') {
          const { slotId, ...rest } = event;
          return {
            ...rest,
            date: decision.targetDate || event.date,
            slotId: undefined
          };
        }
        return event;
      });
    }

    // ... save version logic
    const existingVersionIndex = data.scheduleVersions?.findIndex(v => v.id === migrationData.pendingVersion.id);
    let updatedVersions;

    if (existingVersionIndex !== undefined && existingVersionIndex >= 0) {
      updatedVersions = data.scheduleVersions.map(v =>
        v.id === migrationData.pendingVersion.id ? migrationData.pendingVersion : v
      );
    } else {
      updatedVersions = [...(data.scheduleVersions || []), migrationData.pendingVersion];
    }

    onUpdateData({
      scheduleVersions: updatedVersions,
      logs: updatedLogs,
      events: updatedEvents
    });

    // If we just saved the current version edits, we need to reset changes flag
    if (selectedVersionId === migrationData.pendingVersion.id) {
      setHasChanges(false);
      // editedSchedules will sync via useEffect, or we can force it here?
      // useEffect handles it because currentVersion changes reference
    } else {
      setSelectedVersionId(migrationData.pendingVersion.id);
    }

    setShowMigrationModal(false);
    setMigrationData(null);
    setNewVersionDate('');
  };

  const handleSaveVersion = () => {
    if (!currentVersion) return;

    // 1. Analyze for migrations between ORIGINAL and EDITED
    const analysis = analyzeMigration(
      currentVersion.schedules, // Original state (old)
      editedSchedules,          // New state (new)
      data.logs || [],
      data.events || [],
      currentVersion.activeFrom,
      data.schools || []
    );

    // 2. Prepare pending update
    const pendingUpdate = {
      ...currentVersion,
      schedules: editedSchedules
    };

    // 3. If migration needed -> Show Wizard
    if (analysis.affectedLogs.length > 0 || analysis.affectedEvents.length > 0) {
      setMigrationData({ ...analysis, pendingVersion: pendingUpdate });
      setShowMigrationModal(true);
      return;
    }

    // 4. No migration needed -> Commit immediately
    const updatedVersions = data.scheduleVersions.map(v =>
      v.id === currentVersion.id ? pendingUpdate : v
    );

    onUpdateData({ scheduleVersions: updatedVersions });
    setHasChanges(false);
  };

  const handleUpdateSchedule = (shiftId: string, slotId: string, classId: string) => {
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
        !(Number(s.dayOfWeek) === Number(selectedDay) && s.schoolId === selectedInstitutionId && s.shiftId === shiftId && s.slotId === slotId)
      );
    } else {
      // Update/Add
      // Check Conflicts within THIS version (using editedSchedules)
      const shift = institutionShifts.find(sh => sh.id === shiftId);
      const slot = shift?.slots?.find(sl => sl.id === slotId);

      if (slot) {
        // Verifica conflito com outras escolas NA MESMA VERSÃO
        const schoolConflict = newSchedules.find(s => {
          if (Number(s.dayOfWeek) === Number(selectedDay) && s.schoolId === selectedInstitutionId && s.shiftId === shiftId && s.slotId === slotId) {
            return false; // Ignore self
          }
          if (Number(s.dayOfWeek) === Number(selectedDay)) {
            const otherInst = data.schools?.filter(s => !s.deleted).find(os => os.id === s.schoolId);
            if (!otherInst) return false;
            const otherSlot = otherInst.shifts?.find(osh => osh.id === s.shiftId)?.slots?.find(osl => osl.id === s.slotId);
            if (otherSlot) {
              return checkTimeOverlap(slot.startTime, slot.endTime, otherSlot.startTime, otherSlot.endTime);
            }
          }
          return false;
        });

        const privateConflict = privateConflicts.find(pc =>
          checkTimeOverlap(slot.startTime, slot.endTime, pc.startTime, pc.endTime)
        );

        if (schoolConflict || privateConflict) {
          const conflictName = schoolConflict ? schoolConflict.classId : privateConflict?.studentName;
          alert(`CONFLITO DE HORÁRIO!\nVocê já tem uma aula (${conflictName}) agendada neste mesmo horário.`);
          return;
        }
      }

      // Remove existing for this slot
      newSchedules = newSchedules.filter(s =>
        !(Number(s.dayOfWeek) === Number(selectedDay) && s.schoolId === selectedInstitutionId && s.shiftId === shiftId && s.slotId === slotId)
      );

      // Add new
      newSchedules.push({
        id: crypto.randomUUID(),
        dayOfWeek: Number(selectedDay) as DayOfWeek,
        schoolId: selectedInstitutionId,
        shiftId,
        slotId,
        classId
      });
    }

    // UPDATE LOCAL STATE ONLY - DO NOT SAVE YET
    setEditedSchedules(newSchedules);
    setHasChanges(true);
  };

  if (!data) return null;

  return (
    <div className="space-y-6">

      {/* --- BOX DE VERSÕES --- */}
      <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xs font-black uppercase text-slate-500 tracking-tight mb-1 flex items-center gap-2">
            <Layers size={14} /> Versão da Grade
          </h3>
          <div className="relative">
            <select
              value={selectedVersionId}
              onChange={(e) => setSelectedVersionId(e.target.value)}
              className="appearance-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pl-3 pr-8 font-bold text-sm text-slate-700 dark:text-slate-200 outline-none focus:ring-2 ring-primary/20 min-w-[200px]"
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
                if (confirm('Tem certeza que deseja excluir esta versão da grade?\n\nEsta ação não pode ser desfeita.')) {
                  const versionToDelete = data.scheduleVersions.find(v => v.id === selectedVersionId);

                  // Check if there are logs using this version
                  const logsUsingVersion = data.logs?.filter(log =>
                    log.date >= versionToDelete?.activeFrom
                  );

                  if (logsUsingVersion && logsUsingVersion.length > 0) {
                    if (!confirm(`ATENÇÃO: Existem ${logsUsingVersion.length} aulas registradas usando esta versão da grade.\n\nAo excluir, essas aulas continuarão existindo mas podem não aparecer corretamente no histórico.\n\nDeseja continuar mesmo assim?`)) {
                      return;
                    }
                  }

                  // Delete version
                  const updatedVersions = data.scheduleVersions.filter(v => v.id !== selectedVersionId);
                  onUpdateData({ scheduleVersions: updatedVersions });

                  // Select the most recent remaining version
                  const remaining = updatedVersions.sort((a, b) => b.activeFrom.localeCompare(a.activeFrom));
                  setSelectedVersionId(remaining[0]?.id || '');
                }
              }}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/30 rounded-xl text-red-600 dark:text-red-400 font-black uppercase text-[10px] hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors shadow-sm"
            >
              <Trash2 size={14} /> Excluir
            </button>
          )}

          <button
            onClick={() => setIsVersionModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-primary font-black uppercase text-[10px] hover:bg-primary/5 transition-colors shadow-sm"
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
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-xl font-bold text-xs hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Descartar
              </button>
              <button
                onClick={handleSaveVersion}
                className="px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold text-xs hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2"
              >
                <Save size={14} /> Salvar Alterações
              </button>
            </div>
          )}
        </div>
      </div>

      {isVersionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-2xl w-full max-w-sm animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-black text-slate-800 dark:text-white mb-1">Nova Versão da Grade</h3>
            <p className="text-xs text-slate-500 mb-6">A partir de quando esta nova grade será válida?</p>

            <label className="block text-[10px] font-black uppercase text-slate-400 mb-1.5">Data de Início</label>
            <input
              type="date"
              value={newVersionDate}
              onChange={(e) => setNewVersionDate(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 font-bold text-slate-700 dark:text-white outline-none focus:ring-2 ring-primary mb-6"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setIsVersionModalOpen(false)}
                className="flex-1 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateVersion}
                className="flex-1 py-3 rounded-xl font-bold bg-primary text-white shadow-lg shadow-primary/30 hover:brightness-110 transition-all"
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
        orphans={migrationData?.orphans || []} // We will need to merge orphan logs and orphan events in Wizard
        orphanEvents={migrationData?.orphanEvents || []}
        newSchedules={migrationData?.pendingVersion?.schedules || []}
        activeFrom={migrationData?.pendingVersion?.activeFrom || ''}
        schools={data.schools || []}
      />


      <div
        className="flex flex-col md:flex-row md:items-center gap-4 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm transition-colors relative overflow-hidden"
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
              <label htmlFor="weekendToggle" className="text-[9px] font-bold text-slate-400 cursor-pointer select-none">Mostrar Sábado/Domingo</label>
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
            className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl font-bold text-slate-700 dark:text-slate-200 py-2 px-3 outline-none"
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
        <div className="flex w-full md:w-auto overflow-x-auto md:overflow-visible gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl no-scrollbar">
          {([1, 2, 3, 4, 5, 6, 0] as DayOfWeek[])
            .filter(d => showWeekends || (d !== 6 && d !== 0))
            .map(dayNum => {
              return (
                <button
                  key={dayNum}
                  onClick={() => setSelectedDay(dayNum)}
                  className={`flex-1 md:flex-none py-2 px-1 md:px-4 rounded-lg text-[10px] md:text-xs font-black uppercase transition-all whitespace-nowrap text-center ${selectedDay === dayNum
                    ? 'bg-white dark:bg-slate-700 text-primary shadow-sm scale-100 md:scale-105'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                    }`}
                >
                  {DAYS_OF_WEEK_NAMES[dayNum]?.slice(0, 3)}
                </button>
              );
            })}
        </div>
      </div>

      {!activeInstitution ? (
        <div className="bg-white dark:bg-slate-900 p-12 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
          <CalendarIcon className="mx-auto text-slate-300 mb-4" size={48} />
          <p className="text-slate-500 font-medium">Cadastre escolas ou alunos para gerenciar horários.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {activeInstitution.type === 'student' && institutionShifts[0]?.slots?.length === 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/10 p-10 text-center rounded-2xl border border-amber-100 dark:border-amber-900/30">
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

            return sortedShifts.map(shift => (
              <div key={shift.id} className="bg-white dark:bg-slate-900 p-3 md:p-5 rounded-xl md:rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 animate-in fade-in duration-300">
                <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-4 md:mb-5 flex items-center gap-2 uppercase tracking-tight text-xs">
                  {activeInstitution.type === 'school' ? <LayoutGrid className="text-primary" size={18} /> : <User className="text-primary" size={18} />}
                  {activeInstitution.type === 'school' ? `Turno: ${shift.name}` : `Horários de ${activeInstitution.data.name}`}
                </h3>
                <div className="grid gap-1 md:gap-2"> {/* Extrema compactação em mobile: gap-1 */}
                  {(shift.slots || []).map(slot => {
                    const currentSchedule = editedSchedules.find(s =>
                      Number(s.dayOfWeek) === Number(selectedDay) &&
                      s.schoolId === selectedInstitutionId &&
                      s.shiftId === shift.id &&
                      s.slotId === slot.id
                    );

                    // Verifica se este slot da escola conflita com QUALQUER aluno particular
                    const studentConflict = activeInstitution.type === 'school' ? privateConflicts.find(pc =>
                      checkTimeOverlap(slot.startTime, slot.endTime, pc.startTime, pc.endTime)
                    ) : null;

                    // Verifica se este horário conflita com OUTRAS ESCOLAS
                    const otherSchoolConflict = activeInstitution.type === 'school' ? (() => {
                      // Busca horários de outras escolas no mesmo dia
                      const conflictingSchedule = editedSchedules.find(s => {
                        if (Number(s.dayOfWeek) !== Number(selectedDay)) return false;
                        if (s.schoolId === selectedInstitutionId) return false; // Ignora a mesma escola

                        const otherSchool = (data.schools || []).find(sc => sc.id === s.schoolId);
                        if (!otherSchool || otherSchool.deleted) return false;

                        const otherShift = otherSchool.shifts?.find(sh => sh.id === s.shiftId);
                        const otherSlot = otherShift?.slots.find(sl => sl.id === s.slotId);

                        if (!otherSlot) return false;

                        return checkTimeOverlap(slot.startTime, slot.endTime, otherSlot.startTime, otherSlot.endTime);
                      });

                      if (conflictingSchedule) {
                        const conflictSchool = (data.schools || []).find(s => s.id === conflictingSchedule.schoolId);
                        return {
                          schoolName: conflictSchool?.name || 'Outra escola',
                          schoolColor: conflictSchool?.color || '#6366f1',
                          className: conflictingSchedule.classId
                        };
                      }
                      return null;
                    })() : null;

                    const hasConflict = studentConflict || otherSchoolConflict;

                    return (
                      <div key={slot.id}
                        className={`relative flex items-center gap-2 p-1.5 md:p-2 rounded-r-xl border-y border-r transition-all ${ // Compact padding p-1.5 mobile
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
                        <div className="w-16 md:w-20 shrink-0"> {/* Width ainda menor no mobile */}
                          <p className="text-[8px] md:text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tight mb-0.5">{slot.label}</p>
                          <p className="text-[9px] md:text-[10px] font-bold text-slate-600 dark:text-slate-400">{slot.startTime} - {slot.endTime}</p>
                        </div>

                        {studentConflict ? (
                          <div className="flex-1 flex items-center gap-3 px-3 py-1.5 bg-white dark:bg-slate-900 rounded-lg border border-amber-100">
                            <ShieldAlert className="text-amber-500" size={14} />
                            <div>
                              <p className="text-[9px] font-black text-amber-800 dark:text-amber-200 uppercase">Horário Ocupado</p>
                              <p className="text-[8px] text-amber-600 font-bold uppercase">Aula Particular: {studentConflict.studentName}</p>
                            </div>
                          </div>
                        ) : otherSchoolConflict ? (
                          <div className="flex-1 flex items-center gap-3 px-3 py-1.5 bg-white dark:bg-slate-900 rounded-lg border border-indigo-100">
                            <ShieldAlert className="text-indigo-500" size={14} />
                            <div>
                              <p className="text-[9px] font-black text-indigo-800 dark:text-indigo-200 uppercase">Horário Ocupado</p>
                              <p className="text-[8px] font-bold uppercase" style={{ color: otherSchoolConflict.schoolColor }}>
                                {otherSchoolConflict.schoolName} • {otherSchoolConflict.className !== 'window' ? otherSchoolConflict.className : 'Janela'}
                              </p>
                            </div>
                          </div>
                        ) : slot.type === 'class' ? (
                          <select
                            value={currentSchedule?.classId || ''}
                            disabled={activeInstitution.type === 'student'}
                            onChange={e => handleUpdateSchedule(shift.id, slot.id, e.target.value)}
                            className={`flex-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 md:px-3 py-1 md:py-1.5 text-xs font-bold outline-none cursor-pointer appearance-none ${ // Compactação no input
                              currentSchedule?.classId === 'window' ? 'text-amber-600' :
                                currentSchedule?.classId ? 'text-primary' : 'text-slate-500'
                              } disabled:opacity-100 disabled:bg-white disabled:border-transparent`}
                          >
                            {activeInstitution.type === 'school' ? (
                              <>
                                <option value="">Livre</option>
                                <option value="window" className="text-amber-600 font-bold">Janela / Livre</option>
                                {(activeInstitution.data.classes || []).filter(c => typeof c === 'string' || !c.deleted).sort((a, b) => (typeof a === 'string' ? a : a.name).localeCompare(typeof b === 'string' ? b : b.name)).map((c, i) => {
                                  const name = typeof c === 'string' ? c : c.name;
                                  const key = typeof c === 'string' ? `${c}-${i}` : c.id;
                                  return <option key={key} value={name}>{name}</option>;
                                })}
                              </>
                            ) : (
                              <option value={activeInstitution.data.name}>Atendimento Particular</option>
                            )}
                          </select>
                        ) : (
                          <div className="flex-1 text-center font-black text-slate-500 text-[8px] md:text-[9px] uppercase tracking-tight py-1">
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