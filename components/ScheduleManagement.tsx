import React, { useState, useMemo, useEffect } from 'react';
import { AppData, School, DayOfWeek, Shift, TimeSlot, ScheduleEntry, Student, PrivateSchedule } from '../types';
import { DAYS_OF_WEEK_NAMES } from '../constants';
import { Plus, Trash2, LayoutGrid, Calendar as CalendarIcon, Save, Info, AlertCircle, User, Clock, ShieldAlert } from 'lucide-react';
import { checkTimeOverlap } from '../utils';

interface ScheduleManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
}

const ScheduleManagement: React.FC<ScheduleManagementProps> = ({ data, onUpdateData }) => {
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(1); // Monday por padrão

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
  // This ensures the theme color updates correctly when schools are deleted
  useEffect(() => {
    if (selectedInstitutionId) {
      const schoolExists = safeSchools.find(s => s.id === selectedInstitutionId);
      const studentExists = safeStudents.find(s => s.id === selectedInstitutionId);

      // If the selected institution was deleted, automatically select the first available one
      if (!schoolExists && !studentExists) {
        const newId = safeSchools[0]?.id || safeStudents[0]?.id || '';
        if (newId !== selectedInstitutionId) {
          console.log('🔄 Selected institution was deleted. Auto-selecting first available:', newId);
          setSelectedInstitutionId(newId);
        }
      }
    } else if (safeSchools.length > 0 || safeStudents.length > 0) {
      // If no institution is selected but there are available ones, select the first
      const newId = safeSchools[0]?.id || safeStudents[0]?.id || '';
      setSelectedInstitutionId(newId);
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

  const handleUpdateSchedule = (shiftId: string, slotId: string, classId: string) => {
    if (!activeInstitution || activeInstitution.type === 'student') return;

    if (!classId) {
      const newSchedules = (data.schedules || []).filter(s =>
        !(Number(s.dayOfWeek) === Number(selectedDay) && s.schoolId === selectedInstitutionId && s.shiftId === shiftId && s.slotId === slotId)
      );
      onUpdateData({ schedules: newSchedules });
      return;
    }

    const shift = institutionShifts.find(sh => sh.id === shiftId);
    const slot = shift?.slots?.find(sl => sl.id === slotId);

    if (slot) {
      // Verifica conflito com outras escolas
      const schoolConflict = (data.schedules || []).find(s => {
        if (Number(s.dayOfWeek) === Number(selectedDay) && s.schoolId === selectedInstitutionId && s.shiftId === shiftId && s.slotId === slotId) {
          return false;
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

      // Verifica conflito com alunos particulares
      const privateConflict = privateConflicts.find(pc =>
        checkTimeOverlap(slot.startTime, slot.endTime, pc.startTime, pc.endTime)
      );

      if (schoolConflict || privateConflict) {
        const conflictName = schoolConflict ? schoolConflict.classId : privateConflict?.studentName;
        alert(`CONFLITO DE HORÁRIO!\nVocê já tem uma aula (${conflictName}) agendada neste mesmo horário.`);
        return;
      }
    }

    const newSchedules = [...(data.schedules || [])].filter(s =>
      !(Number(s.dayOfWeek) === Number(selectedDay) && s.schoolId === selectedInstitutionId && s.shiftId === shiftId && s.slotId === slotId)
    );

    newSchedules.push({
      id: crypto.randomUUID(), // ID para mergeArrays
      dayOfWeek: Number(selectedDay) as DayOfWeek,
      schoolId: selectedInstitutionId,
      shiftId,
      slotId,
      classId
    });

    onUpdateData({ schedules: newSchedules });
  };

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div
        className="flex flex-col md:flex-row md:items-center gap-4 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm transition-colors relative overflow-hidden"
        style={{
          backgroundColor: activeColor ? activeColor + '15' : undefined,
          borderColor: activeColor || undefined,
          borderWidth: activeColor ? '2px' : undefined
        }}
      >
        <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: activeColor || 'transparent' }}></div>
        <div className="flex-1">
          <label className="block text-[10px] font-black text-slate-500 uppercase mb-1">Selecione Instituição/Aluno</label>
          <select
            value={selectedInstitutionId}
            onChange={e => setSelectedInstitutionId(e.target.value)}
            className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl font-bold text-slate-700 dark:text-slate-200 py-2 px-3 outline-none"
          >
            <optgroup label="Escolas">
              {(data.schools || []).filter(s => !s.deleted).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
            {data.settings?.isPrivateTeacher && (data.students || []).length > 0 && (
              <optgroup label="Alunos Particulares">
                {(data.students || []).map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <div className="flex w-full md:w-auto overflow-x-auto md:overflow-visible gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl no-scrollbar">
          {([1, 2, 3, 4, 5, 6, 0] as DayOfWeek[]).map(dayNum => {
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
        <div className="bg-white dark:bg-slate-900 p-12 text-center rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
          <CalendarIcon className="mx-auto text-slate-300 mb-4" size={48} />
          <p className="text-slate-500 font-medium">Cadastre escolas ou alunos para gerenciar horários.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {activeInstitution.type === 'student' && institutionShifts[0]?.slots?.length === 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/10 p-10 text-center rounded-3xl border border-amber-100 dark:border-amber-900/30">
              <Clock className="mx-auto text-amber-400 mb-3" size={32} />
              <p className="text-amber-800 dark:text-amber-200 font-black uppercase text-xs">Sem aulas cadastradas para {DAYS_OF_WEEK_NAMES[selectedDay]}</p>
              <p className="text-amber-600 dark:text-amber-400 text-[10px] mt-1">Cadastre horários no menu "Alunos" para visualizá-los aqui.</p>
            </div>
          )}

          {institutionShifts.map(shift => (
            <div key={shift.id} className="bg-white dark:bg-slate-900 p-3 md:p-6 rounded-[24px] md:rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 animate-in fade-in duration-300">
              <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mb-4 md:mb-6 flex items-center gap-2 uppercase tracking-widest text-xs">
                {activeInstitution.type === 'school' ? <LayoutGrid className="text-primary" size={18} /> : <User className="text-primary" size={18} />}
                {activeInstitution.type === 'school' ? `Turno: ${shift.name}` : `Horários de ${activeInstitution.data.name}`}
              </h3>
              <div className="grid gap-1 md:gap-2"> {/* Extrema compactação em mobile: gap-1 */}
                {(shift.slots || []).map(slot => {
                  const currentSchedule = (data.schedules || []).find(s =>
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
                    const conflictingSchedule = (data.schedules || []).find(s => {
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
                    <div key={slot.id} className={`flex items-center gap-2 p-1.5 md:p-2 rounded-xl border transition-all ${ // Compact padding p-1.5 mobile
                      slot.type === 'break'
                        ? 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 opacity-60'
                        : hasConflict
                          ? (studentConflict ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : 'bg-indigo-50 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-800')
                          : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'
                      }`}>
                      <div className="w-16 md:w-20 shrink-0"> {/* Width ainda menor no mobile */}
                        <p className="text-[8px] md:text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-0.5">{slot.label}</p>
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
                              {(activeInstitution.data.classes || []).filter(c => typeof c === 'string' || !c.deleted).map((c, i) => {
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
                        <div className="flex-1 text-center font-black text-slate-500 text-[8px] md:text-[9px] uppercase tracking-[0.2em] py-1">
                          Intervalo
                        </div>
                      )}

                      {activeInstitution.type === 'school' && !hasConflict && (
                        <div className="w-2 h-2 md:w-3 md:h-3 rounded-full shadow-inner shrink-0" style={{ backgroundColor: activeInstitution.data.color }} />
                      )}
                      {studentConflict && (
                        <div className="w-2 h-2 md:w-3 md:h-3 rounded-full shadow-inner shrink-0" style={{ backgroundColor: studentConflict.studentColor }} />
                      )}
                      {otherSchoolConflict && (
                        <div className="w-2 h-2 md:w-3 md:h-3 rounded-full shadow-inner shrink-0" style={{ backgroundColor: otherSchoolConflict.schoolColor }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ScheduleManagement;