import React, { useState, useMemo, useEffect } from 'react';
import { AppData, LessonLog, ScheduleEntry, TimeSlot, School, DayOfWeek, Student, Term, Occurrence, StudentAttendance } from '../types';
import { 
  History, 
  ArrowLeft, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  ChevronRight, 
  CalendarDays, 
  Search, 
  Filter, 
  AlertTriangle, 
  Palmtree, 
  ArrowRight, 
  Coffee, 
  PlayCircle, 
  CalendarRange, 
  Copy, 
  Layers, 
  Plus, 
  Trash2, 
  Users, 
  Repeat, 
  Replace, 
  BookPlus, 
  ClipboardCheck, 
  X,
  RotateCcw
} from 'lucide-react';
import { DAYS_OF_WEEK_NAMES } from '../constants';
import { parseTimeToMinutes, getCurrentTimeInMinutes, getHolidayName, isHoliday, getDayOfWeekFromDate } from '../utils';

interface LessonLoggerProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
  initialLessonData?: { schedule: ScheduleEntry; date: string } | null;
  onClearInitialLesson: () => void;
  defaultShowPendencies?: boolean;
  onClearShowPendencies?: () => void;
}

type ViewMode = 'day' | 'registered' | 'future';

const OCCURRENCE_TYPES = [
  "Sem Tarefa", 
  "Sem trabalho", 
  "Participação", 
  "Brincadeira em sala", 
  "Desrespeito", 
  "Outros"
];

const LessonLogger: React.FC<LessonLoggerProps> = ({ 
  data, 
  onUpdateData, 
  initialLessonData, 
  onClearInitialLesson,
  defaultShowPendencies,
  onClearShowPendencies
}) => {
  // ... (Estados iniciais mantidos) ...
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [currentTime, setCurrentTime] = useState(getCurrentTimeInMinutes());
  
  const getYYYYMMDD = (date: Date) => {
    return date.toLocaleDateString('en-CA');
  };

  const [selectedDate, setSelectedDate] = useState(getYYYYMMDD(new Date()));
  const [activeLesson, setActiveLesson] = useState<{ schedule: ScheduleEntry, institution: School | Student, slot: TimeSlot, date: string, type: 'school' | 'private' } | null>(null);
  
  const [isExtraLessonModalOpen, setIsExtraLessonModalOpen] = useState(false);
  const [extraLessonForm, setExtraLessonForm] = useState<{
    type: 'extra' | 'substitution';
    date: string;
    schoolId: string;
    classId: string;
    substitutionSubject: string;
    selectedSlotId: string;
    startTime: string;
    endTime: string;
    subject: string;
    homework: string;
    notes: string;
    occurrences: Occurrence[];
  }>({
    type: 'extra',
    date: '',
    schoolId: '',
    classId: '',
    substitutionSubject: '',
    selectedSlotId: 'custom',
    startTime: '',
    endTime: '',
    subject: '',
    homework: '',
    notes: '',
    occurrences: []
  });

  const [logForm, setLogForm] = useState<{
    subject: string;
    homework: string;
    notes: string;
    occurrences: Occurrence[];
    attendance: StudentAttendance[];
  }>({ subject: '', homework: '', notes: '', occurrences: [], attendance: [] });

  const [isAddingOccurrence, setIsAddingOccurrence] = useState(false);
  const [tempOccurrence, setTempOccurrence] = useState<{ type: string; description: string; studentIds: string[] }>({ type: OCCURRENCE_TYPES[0], description: '', studentIds: [] });

  const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false);
  const [showPendencies, setShowPendencies] = useState(false);
  const [replicateLog, setReplicateLog] = useState(true);
  const [consecutiveSlots, setConsecutiveSlots] = useState<{slotId: string, startTime: number}[]>([]);
  const [filterInstId, setFilterInstId] = useState<string>('all');
  const [filterClassId, setFilterClassId] = useState<string>('all');
  const [filterPeriodIdx, setFilterPeriodIdx] = useState<string>('all');

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(getCurrentTimeInMinutes()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (initialLessonData) {
      handleOpenLog(initialLessonData.schedule, initialLessonData.date);
      onClearInitialLesson();
    }
  }, [initialLessonData]);

  useEffect(() => {
    if (defaultShowPendencies) {
      setShowPendencies(true);
      if (onClearShowPendencies) onClearShowPendencies();
    }
  }, [defaultShowPendencies]);

  // Lista de Alunos da Turma Atual - FILTRADO POR ATIVOS E SEGURO
  const classRoster = useMemo(() => {
    if (!activeLesson || activeLesson.type !== 'school') return [];
    
    // Verificação segura de classRecords
    const record = data.classRecords?.find(r => 
        r.schoolId === activeLesson.institution.id && 
        r.classId === activeLesson.schedule.classId
    );
    
    return record ? record.students.filter(s => s.active !== false) : [];
  }, [activeLesson, data.classRecords]);

  // ... (Restante da lógica mantida igual) ...
  useEffect(() => {
    if (!activeLesson || activeLesson.type === 'private') {
      setConsecutiveSlots([]);
      return;
    }

    const dayOfWeek = getDayOfWeekFromDate(activeLesson.date);
    const schoolId = activeLesson.institution.id;
    const classId = activeLesson.schedule.classId;
    const currentSlotId = activeLesson.slot.id;

    const school = data.schools.find(s => s.id === schoolId);
    if (!school) return;

    let allClassLessons: { slotId: string, startTime: number }[] = [];

    school.shifts.forEach(shift => {
      shift.slots.forEach(slot => {
         const hasSchedule = data.schedules.some(s => 
           Number(s.dayOfWeek) === dayOfWeek && 
           s.schoolId === schoolId && 
           s.shiftId === shift.id && 
           s.slotId === slot.id && 
           s.classId === classId
         );

         if (hasSchedule) {
           allClassLessons.push({ 
             slotId: slot.id, 
             startTime: parseTimeToMinutes(slot.startTime) 
           });
         }
      });
    });

    allClassLessons.sort((a, b) => a.startTime - b.startTime);
    const currentIndex = allClassLessons.findIndex(x => x.slotId === currentSlotId);

    const nextLessons = [];
    if (currentIndex !== -1) {
      for (let i = currentIndex + 1; i < allClassLessons.length; i++) {
         nextLessons.push(allClassLessons[i]);
      }
    }

    setConsecutiveSlots(nextLessons);
    setReplicateLog(true);

  }, [activeLesson, data.schedules, data.schools]);

  const availableInstitutions = useMemo(() => {
    return [
      ...data.schools.map(s => ({ id: s.id, name: s.name, color: s.color, type: 'school' as const })),
      ...(data.settings.isPrivateTeacher ? data.students.map(st => ({ id: st.id, name: st.name, color: st.color, type: 'private' as const })) : [])
    ];
  }, [data.schools, data.students, data.settings.isPrivateTeacher]);

  const availableClasses = useMemo(() => {
    if (filterInstId === 'all') {
      return Array.from(new Set([...data.schools.flatMap(s => s.classes), ...data.students.map(st => st.name)]));
    }
    const school = data.schools.find(s => s.id === filterInstId);
    if (school) return school.classes;
    const student = data.students.find(st => st.id === filterInstId);
    if (student) return [student.name];
    return [];
  }, [data.schools, data.students, filterInstId]);

  const periodOptions = useMemo(() => {
    if (filterInstId === 'all') return [];
    const calendar = data.calendars.find(c => c.schoolId === filterInstId);
    if (!calendar) return [];
    return calendar.terms.map((t, idx) => ({ label: t.name, value: idx.toString() }));
  }, [data.calendars, filterInstId]);

  const isLessonBlocked = (dateStr: string, schoolId: string, shiftId?: string, classId?: string) => {
    const calendar = data.calendars.find(c => c.schoolId === schoolId);
    if (calendar) {
      if (calendar.midYearBreak.start && dateStr >= calendar.midYearBreak.start && dateStr <= calendar.midYearBreak.end) return true;
      if (calendar.extraRecesses?.some(r => r.date === dateStr)) return true;
    }

    const events = data.events.filter(e => e.schoolId === schoolId && e.date.startsWith(dateStr) && e.blocksClasses);
    for (const event of events) {
      if (!event.slotId && !event.classId) return true;
      if (event.slotId && event.slotId === shiftId) return true;
      if (event.classId && event.classId === classId) return true;
    }
    return false;
  };

  const pendingLessons = useMemo(() => {
    const pendencies: any[] = [];
    const now = new Date();
    const todayStr = new Date().toLocaleDateString('en-CA');
    
    for (let i = 0; i < 300; i++) {
      const checkDate = new Date();
      checkDate.setDate(now.getDate() - i);
      const dateStr = checkDate.toLocaleDateString('en-CA');
      const dayOfWeek = checkDate.getDay() as DayOfWeek;

      if (dateStr > todayStr) continue;
      if (isHoliday(checkDate)) continue;

      data.schedules.filter(s => Number(s.dayOfWeek) === dayOfWeek && s.classId !== 'window').forEach(s => {
        if (isLessonBlocked(dateStr, s.schoolId, s.shiftId, s.classId)) return;
        
        const calendar = data.calendars.find(c => c.schoolId === s.schoolId);
        if (calendar) {
          if (calendar.start && dateStr < calendar.start) return;
          if (calendar.end && dateStr > calendar.end) return;
        }

        const school = data.schools.find(sc => sc.id === s.schoolId);
        if (!school) return;
        const slot = school.shifts.find(sh => sh.id === s.shiftId)?.slots.find(sl => sl.id === s.slotId);
        if (!slot || slot.type === 'break') return;

        let isPast = false;
        if (dateStr < todayStr) {
          isPast = true;
        } else if (dateStr === todayStr) {
          isPast = currentTime >= parseTimeToMinutes(slot.endTime);
        }
        
        if (isPast && !data.logs.some(l => l.date.startsWith(dateStr) && l.slotId === s.slotId && l.schoolId === s.schoolId)) {
          pendencies.push({ schedule: s, date: dateStr, institution: school, slot, type: 'school' });
        }
      });

      if (data.settings.isPrivateTeacher) {
        data.students.forEach(st => {
          if (dateStr < st.startDate) return;
          if (isLessonBlocked(dateStr, st.id)) return;

          st.schedules.filter(ps => Number(ps.dayOfWeek) === dayOfWeek).forEach(ps => {
            let isPast = false;
            if (dateStr < todayStr) {
              isPast = true;
            } else if (dateStr === todayStr) {
              isPast = currentTime >= parseTimeToMinutes(ps.endTime);
            }

            if (isPast && !data.logs.some(l => l.date.startsWith(dateStr) && l.slotId === ps.id && l.studentId === st.id)) {
              pendencies.push({ 
                schedule: { dayOfWeek, schoolId: st.id, shiftId: 'private', slotId: ps.id, classId: st.name }, 
                date: dateStr, institution: st, slot: { id: ps.id, label: 'Aula Particular', startTime: ps.startTime, endTime: ps.endTime }, type: 'private' 
              });
            }
          });
        });
      }
    }
    return pendencies.sort((a, b) => b.date.localeCompare(a.date));
  }, [data.schedules, data.logs, data.schools, data.students, data.events, data.calendars, currentTime]);

  const stats = useMemo(() => {
    let totalPastPlanned = 0, loggedPast = 0, totalGeneralPlanned = 0, loggedFuture = 0;
    const now = new Date();
    const todayStr = getYYYYMMDD(now);

    const activeTerm = filterInstId !== 'all' && filterPeriodIdx !== 'all' 
      ? data.calendars.find(c => c.schoolId === filterInstId)?.terms[Number(filterPeriodIdx)] 
      : null;

    for (let i = -180; i < 180; i++) {
      const checkDate = new Date();
      checkDate.setDate(now.getDate() + i);
      const dateStr = getYYYYMMDD(checkDate);
      const dayOfWeek = checkDate.getDay() as DayOfWeek;

      if (isHoliday(checkDate)) continue;
      if (activeTerm && (dateStr < activeTerm.start || dateStr > activeTerm.end)) continue;

      data.schedules.filter(s => Number(s.dayOfWeek) === dayOfWeek && s.classId !== 'window').forEach(s => {
        if (filterInstId !== 'all' && s.schoolId !== filterInstId) return;
        if (filterClassId !== 'all' && s.classId !== filterClassId) return;
        if (isLessonBlocked(dateStr, s.schoolId, s.shiftId, s.classId)) return;
        
        const school = data.schools.find(sc => sc.id === s.schoolId);
        const slot = school?.shifts.find(sh => sh.id === s.shiftId)?.slots.find(sl => sl.id === s.slotId);
        if (!slot) return;

        const calendar = data.calendars.find(c => c.schoolId === s.schoolId);
        if (calendar) {
          if (calendar.start && dateStr < calendar.start) return;
          if (calendar.end && dateStr > calendar.end) return;
        }

        totalGeneralPlanned++;
        const hasLog = data.logs.some(l => l.date.startsWith(dateStr) && l.slotId === s.slotId && l.schoolId === s.schoolId);
        const isPast = (dateStr < todayStr) || (dateStr === todayStr && currentTime >= parseTimeToMinutes(slot.endTime));

        if (isPast) { totalPastPlanned++; if (hasLog) loggedPast++; } else if (hasLog) loggedFuture++;
      });

      if (data.settings.isPrivateTeacher) {
        data.students.forEach(st => {
          if (filterInstId !== 'all' && st.id !== filterInstId) return;
          if (filterClassId !== 'all' && st.name !== filterClassId) return;
          if (dateStr < st.startDate) return;
          if (isLessonBlocked(dateStr, st.id)) return;

          st.schedules.filter(ps => Number(ps.dayOfWeek) === dayOfWeek).forEach(ps => {
            totalGeneralPlanned++;
            const hasLog = data.logs.some(l => l.date.startsWith(dateStr) && l.slotId === ps.id && l.studentId === st.id);
            const isPast = (dateStr < todayStr) || (dateStr === todayStr && currentTime >= parseTimeToMinutes(ps.endTime));

            if (isPast) { totalPastPlanned++; if (hasLog) loggedPast++; } else if (hasLog) loggedFuture++;
          });
        });
      }
    }
    return { totalPastPlanned, loggedPast, totalGeneralPlanned, loggedFuture };
  }, [data.schedules, data.logs, filterInstId, filterClassId, filterPeriodIdx, data.calendars, data.students, data.events, currentTime]);

  const lastLessonInfo = useMemo(() => {
    if (!activeLesson) return null;
    const classId = activeLesson.type === 'school' ? activeLesson.schedule.classId : activeLesson.institution.name;
    const instId = activeLesson.institution.id;
    const currentFullTime = `${activeLesson.date}T${activeLesson.slot.startTime}:00`;

    return data.logs
      .filter(l => 
        l.classId === classId && 
        (l.schoolId === instId || l.studentId === instId) &&
        new Date(l.date).getTime() < new Date(currentFullTime).getTime()
      )
      .sort((a, b) => b.date.localeCompare(a.date))[0];
  }, [activeLesson, data.logs]);

  const extraLogsForDay = useMemo(() => {
    return data.logs.filter(l => 
      l.date.startsWith(selectedDate) && 
      (l.type === 'extra' || l.type === 'substitution')
    );
  }, [data.logs, selectedDate]);

  const renderMiniCalendar = (baseDate: Date) => {
    // ... (Mantido igual)
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const days = [];
    
    const activeTerm = filterInstId !== 'all' && filterPeriodIdx !== 'all' 
      ? data.calendars.find(c => c.schoolId === filterInstId)?.terms[Number(filterPeriodIdx)] 
      : null;

    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= lastDay; i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const dObj = new Date(dateStr + 'T00:00:00');
      const dayOfWeek = dObj.getDay() as DayOfWeek;
      const holidayName = getHolidayName(dObj);
      
      const isBlocked = filterInstId !== 'all' ? isLessonBlocked(dateStr, filterInstId) : false;
      const isWithinFilteredTerm = !activeTerm || (dateStr >= activeTerm.start && dateStr <= activeTerm.end);

      const hasFilteredSchedule = isWithinFilteredTerm && (
        data.schedules.some(s => Number(s.dayOfWeek) === dayOfWeek && s.classId !== 'window' && (filterInstId === 'all' || s.schoolId === filterInstId) && (filterClassId === 'all' || s.classId === filterClassId) && !isLessonBlocked(dateStr, s.schoolId, s.shiftId, s.classId)) || 
        (data.settings.isPrivateTeacher && data.students.some(st => (filterInstId === 'all' || st.id === filterInstId) && (filterClassId === 'all' || st.name === filterClassId) && dateStr >= st.startDate && st.schedules.some(ps => Number(ps.dayOfWeek) === dayOfWeek) && !isLessonBlocked(dateStr, st.id)))
      ) && !isBlocked && !holidayName;

      days.push({ day: i, dateStr, isBlocked, holidayName, hasFilteredSchedule });
    }

    return (
      <div className="bg-white dark:bg-slate-900 p-4 rounded-[28px] border border-slate-100 dark:border-slate-800 animate-in fade-in zoom-in-95">
        <h4 className="font-black uppercase text-[9px] mb-4 text-center">{baseDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}</h4>
        <div className="grid grid-cols-7 gap-1">
          {['D','S','T','Q','Q','S','S'].map(d => <div key={d} className="text-center text-[7px] font-black text-slate-400">{d}</div>)}
          {days.map((d, i) => {
            if (!d) return <div key={i} />;
            let bg = 'bg-slate-50 dark:bg-slate-800/50';
            if (d.holidayName || d.isBlocked) bg = 'bg-pink-100 dark:bg-pink-900/30';
            else if (d.hasFilteredSchedule) bg = 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-100';
            if (selectedDate === d.dateStr) bg = 'bg-primary scale-110 z-10';

            return (
              <button key={i} onClick={() => { setSelectedDate(d.dateStr); setViewMode('day'); }} className={`aspect-square rounded-lg flex items-center justify-center relative transition-all ${bg}`}>
                <span className={`text-[9px] font-black ${selectedDate === d.dateStr ? 'text-white' : d.holidayName ? 'text-pink-600' : 'text-slate-500'}`}>{d.day}</span>
                {d.hasFilteredSchedule && selectedDate !== d.dateStr && <div className="absolute top-1 right-1 w-1 h-1 bg-blue-500 rounded-full" />}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const handleOpenLog = (schedule: ScheduleEntry, date: string) => {
    const dObj = new Date(date + 'T00:00:00');
    if (isHoliday(dObj) || isLessonBlocked(date, schedule.schoolId, schedule.shiftId, schedule.classId)) return;
    const inst = data.schools.find(s => s.id === schedule.schoolId) || data.students.find(st => st.id === schedule.schoolId);
    if (!inst) return;
    let slot: TimeSlot | undefined;
    if ('shifts' in inst) slot = inst.shifts.find(sh => sh.id === schedule.shiftId)?.slots.find(sl => sl.id === schedule.slotId);
    else { const ps = (inst as Student).schedules.find(s => s.id === schedule.slotId); if (ps) slot = { id: ps.id, startTime: ps.startTime, endTime: ps.endTime, label: 'Aula Particular', type: 'class' }; }
    if (slot) {
      const ex = data.logs.find(l => l.date.startsWith(date) && (l.schoolId === schedule.schoolId || l.studentId === schedule.schoolId) && l.slotId === schedule.slotId);
      
      const record = data.classRecords?.find(r => r.schoolId === schedule.schoolId && r.classId === schedule.classId);
      
      const activeStudents = record ? record.students.filter(s => s.active !== false) : [];
      const defaultAttendance: StudentAttendance[] = activeStudents.map(s => ({ studentId: s.id, status: 'present' }));
      
      setActiveLesson({ schedule, institution: inst, slot, date, type: 'shifts' in inst ? 'school' : 'private' });
      setLogForm({ 
        subject: ex?.subject || '', 
        homework: ex?.homework || '', 
        notes: ex?.notes || '',
        occurrences: ex?.occurrences || [],
        attendance: ex?.attendance || defaultAttendance
      });
      setIsAddingOccurrence(false);
      setTempOccurrence({ type: OCCURRENCE_TYPES[0], description: '', studentIds: [] });
    }
  };

  const handleAddOccurrence = () => {
    if (!tempOccurrence.description.trim()) return;
    
    const newOccurrence: Occurrence = {
      id: crypto.randomUUID(),
      type: tempOccurrence.type,
      description: tempOccurrence.description,
      studentIds: tempOccurrence.studentIds
    };

    setLogForm(prev => ({
      ...prev,
      occurrences: [...prev.occurrences, newOccurrence]
    }));

    setIsAddingOccurrence(false);
    setTempOccurrence({ type: OCCURRENCE_TYPES[0], description: '', studentIds: [] });
  };

  const handleRemoveOccurrence = (id: string) => {
    setLogForm(prev => ({
      ...prev,
      occurrences: prev.occurrences.filter(o => o.id !== id)
    }));
  };

  const toggleStudentInOccurrence = (studentId: string) => {
    setTempOccurrence(prev => {
        const ids = prev.studentIds.includes(studentId) 
            ? prev.studentIds.filter(id => id !== studentId)
            : [...prev.studentIds, studentId];
        return { ...prev, studentIds: ids };
    });
  };

  const handleAttendanceChange = (studentId: string, status: 'present' | 'absent' | 'justified') => {
    setLogForm(prev => ({
      ...prev,
      attendance: prev.attendance.map(a => a.studentId === studentId ? { ...a, status } : a)
    }));
  };

  const handleSaveLog = () => {
    if (!activeLesson) return;

    const logsToSave: LessonLog[] = [];

    const createLogObject = (slotId: string) => ({
       id: crypto.randomUUID(), 
       date: new Date(activeLesson.date + 'T00:00:00').toISOString(), 
       schoolId: activeLesson.type === 'school' ? activeLesson.institution.id : '', 
       studentId: activeLesson.type === 'private' ? activeLesson.institution.id : '', 
       classId: activeLesson.type === 'school' ? activeLesson.schedule.classId : activeLesson.institution.name, 
       slotId: slotId, 
       ...logForm,
       type: 'regular' as const
    });

    logsToSave.push(createLogObject(activeLesson.slot.id));

    if (replicateLog && consecutiveSlots.length > 0) {
      consecutiveSlots.forEach(nextSlot => {
        logsToSave.push(createLogObject(nextSlot.slotId));
      });
    }

    const slotIdsToUpdate = logsToSave.map(l => l.slotId);
    const filteredLogs = data.logs.filter(l => !(
      l.date.startsWith(activeLesson.date) && 
      (l.schoolId === activeLesson.institution.id || l.studentId === activeLesson.institution.id) && 
      slotIdsToUpdate.includes(l.slotId)
    ));

    onUpdateData({ logs: [...filteredLogs, ...logsToSave] });

    setActiveLesson(null);
  };

  const handleSaveExtraLesson = () => {
    if (!extraLessonForm.schoolId || !extraLessonForm.classId || !extraLessonForm.date) return;
    if (extraLessonForm.type === 'substitution' && !extraLessonForm.substitutionSubject) return;

    const newLog: LessonLog = {
      id: crypto.randomUUID(),
      date: new Date(extraLessonForm.date + 'T00:00:00').toISOString(),
      schoolId: extraLessonForm.schoolId,
      classId: extraLessonForm.classId,
      slotId: crypto.randomUUID(),
      subject: extraLessonForm.subject,
      homework: extraLessonForm.homework,
      notes: extraLessonForm.notes,
      occurrences: extraLessonForm.occurrences,
      type: extraLessonForm.type,
      substitutionSubject: extraLessonForm.substitutionSubject,
      startTime: extraLessonForm.startTime,
      endTime: extraLessonForm.endTime
    };

    onUpdateData({ logs: [...data.logs, newLog] });
    setIsExtraLessonModalOpen(false);
    
    setExtraLessonForm({
      type: 'extra',
      date: '',
      schoolId: '',
      classId: '',
      substitutionSubject: '',
      selectedSlotId: 'custom',
      startTime: '',
      endTime: '',
      subject: '',
      homework: '',
      notes: '',
      occurrences: []
    });
  };

  const handleSlotSelection = (slotId: string, schoolId: string) => {
    if (slotId === 'custom') {
      setExtraLessonForm(prev => ({ ...prev, selectedSlotId: 'custom' }));
      return;
    }

    const school = data.schools.find(s => s.id === schoolId);
    if (!school) return;

    let foundSlot: TimeSlot | undefined;
    for (const shift of school.shifts) {
      foundSlot = shift.slots.find(s => s.id === slotId);
      if (foundSlot) break;
    }

    if (foundSlot) {
      setExtraLessonForm(prev => ({ 
        ...prev, 
        selectedSlotId: slotId,
        startTime: foundSlot!.startTime,
        endTime: foundSlot!.endTime
      }));
    }
  };

  const integratedPanoramicColumns = useMemo(() => {
    const dObj = new Date(selectedDate + 'T00:00:00');
    const day = dObj.getDay() as DayOfWeek;
    const isToday = selectedDate === getYYYYMMDD(new Date());
    
    const groupedShifts: Record<string, Array<{ 
      schedule?: ScheduleEntry; 
      inst: any; 
      slot: TimeSlot; 
      log: any; 
      label: string; 
      isWindow?: boolean; 
      isFree?: boolean; 
      startTimeMin: number;
      endTimeMin: number;
      isActive: boolean;
    }>> = {};

    data.schools.forEach(school => {
      school.shifts.forEach(shift => {
        shift.slots.forEach(slot => {
          const schedule = data.schedules.find(s => 
            Number(s.dayOfWeek) === day && 
            s.schoolId === school.id && 
            s.shiftId === shift.id && 
            s.slotId === slot.id
          );

          if (!schedule) return; 

          const log = data.logs.find(l => l.date.startsWith(selectedDate) && l.schoolId === school.id && l.slotId === slot.id);
          
          let displayLabel = slot.label;
          let isWindow = false;
          let isFree = false;

          if (schedule.classId === 'window') {
            displayLabel = 'Janela';
            isWindow = true;
          } else {
            displayLabel = schedule.classId;
          }

          const startMin = parseTimeToMinutes(slot.startTime);
          const endMin = parseTimeToMinutes(slot.endTime);
          const isActive = isToday && currentTime >= startMin && currentTime < endMin;

          if (!groupedShifts[shift.name]) groupedShifts[shift.name] = [];
          groupedShifts[shift.name].push({
            schedule,
            inst: school,
            slot,
            log,
            label: displayLabel,
            isWindow,
            isFree,
            startTimeMin: startMin,
            endTimeMin: endMin,
            isActive
          });
        });
      });
    });

    if (data.settings.isPrivateTeacher) {
      data.students.forEach(st => {
        if (selectedDate < st.startDate) return;
        if (isLessonBlocked(selectedDate, st.id)) return;

        st.schedules.filter(ps => Number(ps.dayOfWeek) === day).forEach(ps => {
          const slot = { id: ps.id, startTime: ps.startTime, endTime: ps.endTime, label: 'Aula Particular', type: 'class' as const };
          const log = data.logs.find(l => l.date.startsWith(selectedDate) && l.studentId === st.id && l.slotId === ps.id);
          
          const startMin = parseTimeToMinutes(ps.startTime);
          const endMin = parseTimeToMinutes(ps.endTime);
          let shiftName = 'Particular';
          if (startMin < 720) shiftName = 'Matutino';
          else if (startMin < 1080) shiftName = 'Vespertino';
          else shiftName = 'Noturno';

          const isActive = isToday && currentTime >= startMin && currentTime < endMin;

          if (!groupedShifts[shiftName]) groupedShifts[shiftName] = [];
          groupedShifts[shiftName].push({ 
            schedule: { dayOfWeek: day, schoolId: st.id, shiftId: 'private', slotId: ps.id, classId: st.name }, 
            inst: st, 
            slot, 
            log,
            label: st.name,
            startTimeMin: startMin,
            endTimeMin: endMin,
            isActive
          });
        });
      });
    }

    Object.keys(groupedShifts).forEach(key => {
      groupedShifts[key].sort((a, b) => a.startTimeMin - b.startTimeMin);
    });

    const sortedKeys = Object.keys(groupedShifts).sort((a, b) => {
      const order: Record<string, number> = { 'Matutino': 1, 'Vespertino': 2, 'Noturno': 3, 'Particular': 4 };
      return (order[a] || 99) - (order[b] || 99);
    });

    return { groupedShifts, sortedKeys };
  }, [data.schools, data.schedules, data.students, data.logs, selectedDate, currentTime]);

  const isFutureDate = selectedDate > getYYYYMMDD(new Date());

  if (activeLesson) {
    return (
      <div className="max-w-2xl mx-auto p-5 md:p-10 bg-white dark:bg-slate-900 rounded-[32px] md:rounded-[48px] shadow-xl border border-slate-100 dark:border-slate-800 animate-in fade-in slide-in-from-right-4">
        {/* ... (cabeçalho e resto do formulário mantidos) ... */}
        <button onClick={() => setActiveLesson(null)} className="flex items-center gap-2 text-[9px] md:text-[10px] font-black uppercase text-slate-500 mb-6 md:mb-8"><ArrowLeft size={16}/> Voltar</button>
        <div className="flex items-center gap-4 md:gap-6 mb-6 md:mb-8">
          <div className="w-12 h-12 md:w-16 md:h-16 rounded-2xl flex items-center justify-center text-white font-black text-xl md:text-2xl shadow-lg" style={{ backgroundColor: activeLesson.institution.color }}>{activeLesson.institution.name[0]}</div>
          <div>
            <h3 className="text-lg md:text-2xl font-black uppercase">{activeLesson.type === 'school' ? activeLesson.schedule.classId : activeLesson.institution.name}</h3>
            <p className="text-[8px] md:text-[9px] font-black text-slate-500 uppercase mt-1">
               {activeLesson.institution.name} • {activeLesson.slot.label} • {activeLesson.type === 'school' ? (activeLesson.institution as School).shifts.find(s => s.id === activeLesson.schedule.shiftId)?.name : 'Particular'} • {new Date(activeLesson.date + 'T00:00:00').toLocaleDateString('pt-BR', {day:'2-digit', month:'long'})}
            </p>
          </div>
        </div>

        {lastLessonInfo && (
          <div className="mb-6 md:mb-8 p-4 md:p-6 rounded-[24px] md:rounded-[32px] border border-primary/20 bg-primary-light" style={{ backgroundColor: 'var(--primary-light)' }}>
            <div className="flex items-center gap-2 mb-2 md:mb-3">
              <History size={12} className="text-primary md:w-3.5 md:h-3.5" />
              <span className="text-[9px] md:text-[10px] font-black text-primary uppercase tracking-widest">Retrospectiva</span>
            </div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300 italic mb-2">"{lastLessonInfo.subject}"</p>
            <div className="flex gap-4">
               {lastLessonInfo.homework && <div className="text-[8px] md:text-[9px] font-black text-slate-500 uppercase">Tarefa: {lastLessonInfo.homework}</div>}
               <div className="text-[8px] md:text-[9px] font-black text-slate-500 uppercase">Em: {new Date(lastLessonInfo.date).toLocaleDateString('pt-BR')}</div>
            </div>
          </div>
        )}

        <div className="space-y-4 md:space-y-6">
          {/* ... (campos de texto mantidos) ... */}
          <div>
            <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase mb-2 ml-2">Conteúdo da Aula {isFutureDate && <span className="text-primary">(Planejamento)</span>}</label>
            <textarea value={logForm.subject} onChange={e => setLogForm({...logForm, subject: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-3xl p-5 md:p-6 font-bold dark:text-white focus:ring-2 focus:ring-primary outline-none text-sm" placeholder={isFutureDate ? "Planeje o conteúdo desta aula..." : "O que foi trabalhado hoje?"} rows={4} />
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase mb-2 ml-2">Tarefa de Casa</label>
              <input value={logForm.homework} onChange={e => setLogForm({...logForm, homework: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl p-4 font-bold dark:text-white focus:ring-2 focus:ring-primary outline-none text-sm" placeholder="Ex: Exercícios pág. 42" />
            </div>
            <div>
              <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase mb-2 ml-2">Notas Extras</label>
              <input value={logForm.notes} onChange={e => setLogForm({...logForm, notes: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl p-4 font-bold dark:text-white focus:ring-2 focus:ring-primary outline-none text-sm" placeholder="Observações..." />
            </div>
          </div>

          <div>
             <div className="flex flex-wrap items-center gap-3 mb-2 ml-2">
                <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase mr-auto">Gestão de Sala</label>
                
                {data.settings.advancedModes?.attendance && classRoster.length > 0 && (
                   <button onClick={() => setIsAttendanceModalOpen(true)} className="flex items-center gap-1 text-[8px] md:text-[9px] font-black text-indigo-600 dark:text-indigo-400 uppercase bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded-lg border border-indigo-100 dark:border-indigo-800/50 hover:brightness-95 transition-all">
                      <ClipboardCheck size={12} /> Fazer Chamada
                   </button>
                )}

                <button onClick={() => setIsAddingOccurrence(!isAddingOccurrence)} className="flex items-center gap-1 text-[8px] md:text-[9px] font-black text-primary uppercase hover:bg-primary/10 px-2 py-1 rounded-lg transition-colors"><Plus size={12} /> Adicionar Ocorrência</button>
             </div>
             
             {/* Lista de Ocorrências */}
             {logForm.occurrences.length > 0 && (
                <div className="space-y-2 mb-4">
                   {logForm.occurrences.map((oc, idx) => (
                      <div key={oc.id} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                         <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-xl shrink-0"><AlertTriangle size={14} /></div>
                         <div className="flex-1">
                            <span className="block text-[9px] font-black uppercase text-red-500 tracking-wider mb-0.5">{oc.type}</span>
                            <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300 leading-snug">"{oc.description}"</p>
                            
                            {oc.studentIds && oc.studentIds.length > 0 && (
                               <div className="flex flex-wrap gap-1 mt-1.5">
                                  {oc.studentIds.map(sid => (
                                     <span key={sid} className="bg-white dark:bg-slate-700 px-1.5 py-0.5 rounded text-[8px] font-bold text-slate-500 border border-slate-100 dark:border-slate-600">
                                        {(data.classRecords?.find(r => r.schoolId === activeLesson.institution.id && r.classId === activeLesson.schedule.classId)?.students.find(s => s.id === sid)?.name) || 'Aluno'}
                                     </span>
                                  ))}
                               </div>
                            )}
                         </div>
                         <button onClick={() => handleRemoveOccurrence(oc.id)} className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={14} /></button>
                      </div>
                   ))}
                </div>
             )}

             {logForm.attendance.some(a => a.status !== 'present') && (
                <div className="mb-4 flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-900/40">
                   <div className="p-2 bg-indigo-100 dark:bg-indigo-800 text-indigo-600 rounded-xl"><ClipboardCheck size={14}/></div>
                   <div>
                      <span className="block text-[9px] font-black uppercase text-indigo-600 dark:text-indigo-300 tracking-wider">Resumo da Chamada</span>
                      <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300">
                         {logForm.attendance.filter(a => a.status === 'absent').length} Faltas, {logForm.attendance.filter(a => a.status === 'justified').length} Justificadas.
                      </p>
                   </div>
                </div>
             )}

             {isAddingOccurrence && (
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 animate-in fade-in slide-in-from-top-2">
                   <div className="grid md:grid-cols-3 gap-3 mb-3">
                      <div className="md:col-span-1"><label className="block text-[8px] font-black text-slate-400 uppercase mb-1 ml-1">Tipo de Ocorrência</label><select value={tempOccurrence.type} onChange={e => setTempOccurrence(prev => ({ ...prev, type: e.target.value }))} className="w-full bg-white dark:bg-slate-700 border-none rounded-xl px-3 py-2 text-xs font-bold outline-none cursor-pointer dark:text-white">{OCCURRENCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                      <div className="md:col-span-2"><label className="block text-[8px] font-black text-slate-400 uppercase mb-1 ml-1">Descrição do Ocorrido</label><input type="text" value={tempOccurrence.description} onChange={e => setTempOccurrence(prev => ({ ...prev, description: e.target.value }))} className="w-full bg-white dark:bg-slate-700 border-none rounded-xl px-3 py-2 text-xs font-bold outline-none dark:text-white" placeholder="Ex: Joãozinho não trouxe o material..." /></div>
                   </div>

                   {/* Seletor de Alunos para Ocorrência Individualizada */}
                   {data.settings.advancedModes?.individualOccurrence && classRoster.length > 0 && (
                      <div className="mb-3 bg-white dark:bg-slate-700/50 p-3 rounded-2xl border border-slate-100 dark:border-slate-600/50">
                         <p className="text-[9px] font-black uppercase text-indigo-500 mb-2 flex items-center gap-1"><Users size={12}/> Alunos Envolvidos (Opcional):</p>
                         <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto custom-scrollbar">
                            {classRoster.map(s => (
                               <button 
                                  key={s.id} 
                                  onClick={() => toggleStudentInOccurrence(s.id)}
                                  className={`px-2 py-1 rounded-lg text-[9px] font-bold border transition-all ${tempOccurrence.studentIds.includes(s.id) ? 'bg-indigo-100 border-indigo-200 text-indigo-700 shadow-sm' : 'bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500 hover:bg-white'}`}
                               >
                                  {s.name}
                               </button>
                            ))}
                         </div>
                         {tempOccurrence.studentIds.length > 0 && <p className="text-[8px] font-black text-slate-400 uppercase mt-1 text-right">{tempOccurrence.studentIds.length} selecionado(s)</p>}
                      </div>
                   )}

                   <div className="flex justify-end gap-2"><button onClick={() => setIsAddingOccurrence(false)} className="px-4 py-2 text-[9px] font-black uppercase text-slate-400 hover:text-slate-600">Cancelar</button><button onClick={handleAddOccurrence} disabled={!tempOccurrence.description.trim()} className="px-4 py-2 bg-red-500 text-white rounded-xl text-[9px] font-black uppercase shadow-lg shadow-red-100 hover:bg-red-600 disabled:opacity-50 disabled:shadow-none transition-all">Confirmar</button></div>
                </div>
             )}
          </div>

          {consecutiveSlots.length > 0 && (
            <label className="flex items-center gap-3 p-4 rounded-2xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 cursor-pointer animate-in fade-in">
               <div className={`w-5 h-5 rounded-lg flex items-center justify-center border-2 transition-all ${replicateLog ? 'bg-blue-600 border-blue-600 text-white' : 'border-blue-300'}`}>{replicateLog && <CheckCircle2 size={14} />}</div>
               <input type="checkbox" className="hidden" checked={replicateLog} onChange={e => setReplicateLog(e.target.checked)} />
               <div className="flex-1"><span className="block text-[10px] font-black uppercase text-blue-700 dark:text-blue-300 tracking-widest mb-0.5">Preencher automaticamente aulas em sequência?</span><p className="text-[9px] font-bold text-blue-500 dark:text-blue-400">Replicar este conteúdo para +{consecutiveSlots.length} aula(s) seguinte(s) desta turma.</p></div>
               <Copy size={16} className="text-blue-400" />
            </label>
          )}

          <button onClick={handleSaveLog} className="w-full py-4 md:py-5 bg-primary text-white rounded-[24px] md:rounded-[32px] font-black uppercase text-[10px] md:text-xs tracking-widest shadow-xl mt-4 flex items-center justify-center gap-2 hover:opacity-90 transition-opacity">Salvar Registro</button>
        </div>

        {/* ... (Modal de Chamada e restante do componente mantido) ... */}
        {isAttendanceModalOpen && (
           <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-slate-900 rounded-[32px] w-full max-w-lg shadow-2xl p-6 flex flex-col max-h-[85vh]">
                 <div className="flex justify-between items-center mb-4 shrink-0">
                    <h3 className="text-lg font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                       <ClipboardCheck className="text-indigo-600"/> Lista de Presença
                    </h3>
                    <button onClick={() => setIsAttendanceModalOpen(false)} className="text-slate-300 hover:text-slate-600"><X /></button>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
                    {classRoster.length > 0 ? classRoster.map(student => {
                       const currentStatus = logForm.attendance.find(a => a.studentId === student.id)?.status || 'present';
                       
                       return (
                          <div key={student.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                             <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate flex-1">{student.name}</span>
                             <div className="flex gap-1">
                                <button 
                                   onClick={() => handleAttendanceChange(student.id, 'present')}
                                   className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${currentStatus === 'present' ? 'bg-green-500 text-white shadow-md' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 hover:bg-slate-300'}`}
                                >
                                   Presente
                                </button>
                                <button 
                                   onClick={() => handleAttendanceChange(student.id, 'absent')}
                                   className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${currentStatus === 'absent' ? 'bg-red-500 text-white shadow-md' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 hover:bg-slate-300'}`}
                                >
                                   Falta
                                </button>
                                <button 
                                   onClick={() => handleAttendanceChange(student.id, 'justified')}
                                   className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${currentStatus === 'justified' ? 'bg-amber-400 text-white shadow-md' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 hover:bg-slate-300'}`}
                                >
                                   Justif.
                                </button>
                             </div>
                          </div>
                       );
                    }) : (
                       <div className="text-center py-10 text-slate-400 text-xs font-bold">Nenhum aluno ativo nesta turma.</div>
                    )}
                 </div>

                 <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 shrink-0">
                    <button onClick={() => setIsAttendanceModalOpen(false)} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all">Confirmar Chamada</button>
                 </div>
              </div>
           </div>
        )}
      </div>
    );
  }

  // ... (Restante do arquivo mantido, renderização do grid) ...
  return (
    <div className="space-y-4 md:space-y-6 max-w-6xl mx-auto pb-20">
      {pendingLessons.length > 0 && (
        <button onClick={() => setShowPendencies(!showPendencies)} className={`w-full flex items-center justify-between p-4 md:p-5 rounded-[24px] md:rounded-[28px] border-2 transition-all shadow-md hover:shadow-lg ${showPendencies ? 'bg-red-600 text-white border-red-700' : 'bg-white dark:bg-slate-900 border-red-100 dark:border-red-900/30'}`}>
          <div className="flex items-center gap-4">
            <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center ${showPendencies ? 'bg-white/20' : 'bg-red-50 dark:bg-red-900/40 text-red-600'}`}>
              <AlertTriangle size={20} className="md:w-6 md:h-6"/>
            </div>
            <div className="text-left">
              <span className={`text-[8px] md:text-[10px] font-black uppercase block mb-0.5 md:mb-1 ${showPendencies ? 'text-white/80' : 'text-slate-500'}`}>Atenção Necessária</span>
              <p className={`text-xs md:text-sm font-black uppercase ${showPendencies ? 'text-white' : 'text-red-600'}`}>Você tem {pendingLessons.length} registros pendentes.</p>
            </div>
          </div>
          <ChevronRight className={`transition-transform ${showPendencies ? 'rotate-90' : 'text-slate-300'}`} />
        </button>
      )}
      
      {showPendencies && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 animate-in slide-in-from-top-4">
           {pendingLessons.map((item, idx) => (
             <button key={idx} onClick={() => handleOpenLog(item.schedule, item.date)} className="flex items-center gap-3 md:gap-4 p-4 md:p-5 bg-white dark:bg-slate-900 border-2 border-red-50 dark:border-red-900/10 rounded-[24px] md:rounded-[32px] text-left hover:border-red-200 transition-colors group">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex flex-col items-center justify-center bg-red-50 text-red-600 shrink-0 group-hover:bg-red-100 transition-colors">
                  <span className="text-[7px] md:text-[8px] font-black">{new Date(item.date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                  <AlertCircle size={14} className="md:w-4 md:h-4" />
                </div>
                <div className="overflow-hidden">
                  <h4 className="text-xs font-black uppercase truncate text-slate-800 dark:text-white">{item.schedule.classId}</h4>
                  <p className="text-[8px] md:text-[9px] text-slate-500 font-bold uppercase truncate">{item.institution.name}</p>
                  <p className="text-[7px] md:text-[8px] text-red-500 font-bold uppercase mt-1">Pendente</p>
                </div>
             </button>
           ))}
        </div>
      )}

      {/* ... (Menu de Abas) ... */}
      <div className="flex bg-white dark:bg-slate-900 p-1 md:p-1.5 rounded-[20px] md:rounded-[28px] border border-slate-100 dark:border-slate-800 shadow-sm w-full overflow-hidden">
        {[{ id: 'day', label: 'Diário', icon: History }, { id: 'registered', label: 'Histórico', icon: CheckCircle2 }, { id: 'future', label: 'Planejamento', icon: CalendarDays }].map(tab => (
          <button key={tab.id} onClick={() => setViewMode(tab.id as any)} className={`flex-1 flex items-center justify-center gap-2 px-2 md:px-4 py-2.5 md:py-3 rounded-2xl text-[9px] md:text-[10px] font-black uppercase transition-all ${viewMode === tab.id ? 'bg-primary text-white shadow-lg' : 'text-slate-500'}`}><tab.icon size={14} className="md:w-3.5 md:h-3.5" /> {tab.label}</button>
        ))}
      </div>

      {viewMode !== 'day' && (
        <div className="bg-white dark:bg-slate-900 p-4 rounded-[28px] border border-slate-100 dark:border-slate-800 shadow-sm space-y-4">
           {/* ... (Filtros) ... */}
           <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
             <select value={filterInstId} onChange={e => { setFilterInstId(e.target.value); setFilterClassId('all'); setFilterPeriodIdx('all'); }} className="bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-4 py-3 text-[10px] font-black uppercase dark:text-white outline-none cursor-pointer">
               <option value="all">Todas Instituições</option>
               {availableInstitutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
             </select>
             <select value={filterClassId} onChange={e => setFilterClassId(e.target.value)} className="bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-4 py-3 text-[10px] font-black uppercase dark:text-white outline-none cursor-pointer">
               <option value="all">Todas as Turmas</option>
               {availableClasses.map(c => <option key={c} value={c}>{c}</option>)}
             </select>
             <select value={filterPeriodIdx} onChange={e => setFilterPeriodIdx(e.target.value)} className="bg-slate-50 dark:bg-slate-800 border-none rounded-2xl px-4 py-3 text-[10px] font-black uppercase dark:text-white outline-none cursor-pointer">
               <option value="all">Todos Períodos</option>
               {periodOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
             </select>
           </div>
           <div className="flex justify-center gap-8 pt-4 border-t border-slate-50 dark:border-slate-800">
              <div className="text-center">
                <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Aulas Programadas</p>
                <p className="text-xl font-black text-slate-800 dark:text-white">{stats.totalPastPlanned}</p>
              </div>
              <div className="text-center">
                <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1">Registradas</p>
                <p className="text-xl font-black text-primary">{stats.loggedPast}</p>
              </div>
           </div>
        </div>
      )}

      <div className="space-y-6">
        {viewMode === 'day' && (
          <div className="w-full">
            {isFutureDate && (
              <div className="mb-4 md:mb-6 p-4 rounded-[32px] bg-purple-100 dark:bg-purple-900/30 border-2 border-purple-200 dark:border-purple-800 flex flex-col items-center justify-center text-center animate-pulse">
                <div className="bg-white dark:bg-slate-900 p-2 md:p-3 rounded-full mb-2 shadow-sm text-purple-600 dark:text-purple-300">
                   <CalendarRange size={20} className="md:w-6 md:h-6" />
                </div>
                <h3 className="text-base md:text-lg font-black uppercase text-purple-700 dark:text-purple-300 tracking-tight">Modo de Planejamento Futuro</h3>
                <p className="text-[10px] md:text-xs font-bold uppercase text-purple-500/80 mt-1">Você está visualizando o dia {new Date(selectedDate + 'T00:00:00').toLocaleDateString('pt-BR')}</p>
                <button 
                   onClick={() => setSelectedDate(getYYYYMMDD(new Date()))} 
                   className="mt-3 flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 text-purple-600 dark:text-purple-300 rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-widest shadow-sm hover:scale-105 transition-transform"
                >
                   <RotateCcw size={12} /> Voltar ao dia de Hoje
                </button>
              </div>
            )}
            
            {/* Grid Diário Panorâmico */}
            <div className="flex flex-col md:flex-row gap-4 md:gap-4 w-full">
              {integratedPanoramicColumns.sortedKeys.length > 0 ? integratedPanoramicColumns.sortedKeys.map(key => (
                <div key={key} className="flex-1 w-full space-y-2 md:space-y-3">
                  <div className="flex items-center gap-2 md:gap-3 px-2 py-1.5 md:px-4 md:py-2 bg-slate-100 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
                    <Clock size={12} className="text-primary md:w-3.5 md:h-3.5" />
                    <h3 className="text-[9px] md:text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">{key}</h3>
                    <span className="ml-auto text-[7px] md:text-[8px] font-black bg-white dark:bg-slate-700 text-slate-500 px-2 py-0.5 rounded-lg">
                      {integratedPanoramicColumns.groupedShifts[key].length} Aulas
                    </span>
                  </div>
                  
                  <div className="space-y-1 md:space-y-2 p-0.5 md:p-1">
                    {integratedPanoramicColumns.groupedShifts[key].map((item, idx) => (
                      <button 
                        key={idx} 
                        disabled={item.slot.type === 'break' || item.isFree || item.isWindow}
                        onClick={() => item.schedule && handleOpenLog(item.schedule, selectedDate)} 
                        className={`w-full flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-[16px] md:rounded-[24px] border-2 transition-all text-left group ${item.slot.type === 'break' ? 'bg-slate-50 dark:bg-slate-800/20 border-transparent opacity-40' : item.isFree ? 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 opacity-60 grayscale' : item.isActive ? 'bg-primary/5 border-primary shadow-lg scale-[1.02] z-10' : item.isWindow ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/30 shadow-sm' : item.log ? (isFutureDate ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800 border-dashed' : 'bg-white dark:bg-slate-900 border-green-100 dark:border-green-900/20') : 'bg-white dark:bg-slate-900 border-slate-50 dark:border-slate-800 hover:border-blue-100'}`}
                      >
                        <div className="w-6 h-6 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center text-white font-black text-[10px] md:text-sm shadow-md shrink-0" style={{ backgroundColor: item.inst.color }}>
                          {item.inst.name[0]}
                        </div>
                        <div className="overflow-hidden flex-1">
                          <div className="flex justify-between items-center">
                             <div className="flex items-center gap-2">
                                <h4 className={`font-black uppercase text-[10px] md:text-xs truncate leading-tight ${item.isActive ? 'text-primary' : item.isWindow ? 'text-amber-800 dark:text-amber-200' : 'text-slate-800 dark:text-white'}`}>{item.label}</h4>
                                {item.isActive && <span className="flex items-center gap-1 bg-primary text-white text-[6px] md:text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider"><PlayCircle size={8} fill="currentColor"/> Agora</span>}
                             </div>
                             <span className="text-[7px] md:text-[8px] font-black text-slate-400 dark:text-slate-600 uppercase shrink-0">{item.slot.startTime}</span>
                          </div>
                          
                          {isFutureDate && item.log && (
                             <div className="mt-1.5 mb-1 px-2 py-1 rounded-lg bg-purple-100 dark:bg-purple-900/40 border border-purple-200 dark:border-purple-800">
                                <p className="text-[7px] md:text-[8px] font-black text-purple-700 dark:text-purple-300 uppercase tracking-tight truncate">Planejado: "{item.log.subject}"</p>
                             </div>
                          )}

                          <div className="flex justify-between items-center mt-0.5 md:mt-1">
                             <div className="flex items-center gap-2">
                               <span className="text-[7px] md:text-[8px] font-bold text-slate-500 truncate max-w-[80px]">{item.inst.name}</span>
                               <span className="text-[6px] md:text-[7px] font-black text-slate-400 bg-slate-50 dark:bg-slate-800 px-1.5 rounded uppercase">{idx + 1}ª Aula</span>
                             </div>
                             <div className={`flex items-center gap-1 text-[7px] font-black uppercase ${item.slot.type === 'break' ? 'text-slate-500' : item.isFree ? 'text-slate-500' : item.isWindow ? 'text-amber-600' : item.log ? (isFutureDate ? 'text-purple-500' : 'text-green-500') : 'text-blue-500'}`}>
                                {item.log ? <CheckCircle2 size={10}/> : null} 
                                {item.slot.type === 'break' ? 'Intervalo' : item.isFree ? 'Livre' : item.isWindow ? 'Janela' : item.log ? (isFutureDate ? 'Planejado' : 'OK') : 'Pendente'}
                             </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )) : (
                <div className="col-span-full py-20 w-full text-center">
                  <Palmtree className="mx-auto mb-2 text-slate-300" size={32} />
                  <p className="text-[10px] font-black uppercase text-slate-500">Nenhuma aula cadastrada hoje.</p>
                </div>
              )}
            </div>

            {extraLogsForDay.length > 0 && (
               <div className="mt-6 p-4 rounded-[24px] bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-200 dark:border-slate-700">
                  <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Registros Extras / Substituições</h4>
                  <div className="grid gap-2">
                     {extraLogsForDay.map(log => {
                        const school = data.schools.find(s => s.id === log.schoolId);
                        return (
                           <div key={log.id} className={`flex items-center gap-3 p-3 rounded-2xl border bg-white dark:bg-slate-900 ${log.type === 'substitution' ? 'border-amber-200 dark:border-amber-900/30' : 'border-indigo-200 dark:border-indigo-900/30'}`}>
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white ${log.type === 'substitution' ? 'bg-amber-500' : 'bg-indigo-500'}`}>
                                 {log.type === 'substitution' ? <Replace size={14}/> : <BookPlus size={14}/>}
                              </div>
                              <div className="flex-1 overflow-hidden">
                                 <h5 className="text-[10px] font-black uppercase text-slate-800 dark:text-white truncate">
                                    {log.type === 'substitution' ? `Substituição: ${log.substitutionSubject}` : `Aula Extra: ${log.subject}`}
                                 </h5>
                                 <p className="text-[8px] font-bold text-slate-500 uppercase truncate">
                                    {school?.name} • Turma {log.classId} {log.startTime && `• ${log.startTime}`}
                                 </p>
                              </div>
                           </div>
                        )
                     })}
                  </div>
               </div>
            )}

            <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
               <button 
                  onClick={() => {
                     setExtraLessonForm(prev => ({...prev, date: selectedDate}));
                     setIsExtraLessonModalOpen(true);
                  }}
                  className="w-full py-4 rounded-[24px] border-2 border-dashed border-indigo-200 dark:border-indigo-900/40 text-indigo-600 dark:text-indigo-400 font-black uppercase text-[10px] tracking-widest hover:bg-indigo-50 dark:hover:bg-indigo-900/10 transition-all flex items-center justify-center gap-2"
               >
                  <Plus size={16} /> Adicionar Aula Extra / Substituição
               </button>
            </div>
          </div>
        )}

        {viewMode === 'future' && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {(() => {
              const activeTerm = filterInstId !== 'all' && filterPeriodIdx !== 'all' 
                ? data.calendars.find(c => c.schoolId === filterInstId)?.terms[Number(filterPeriodIdx)] 
                : null;

              const now = new Date();
              const monthsToShow: Date[] = [];
              
              if (activeTerm && activeTerm.start && activeTerm.end) {
                const startDate = new Date(activeTerm.start + 'T00:00:00');
                const endDate = new Date(activeTerm.end + 'T00:00:00');
                let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
                while (cursor <= endDate) {
                  monthsToShow.push(new Date(cursor));
                  cursor.setMonth(cursor.getMonth() + 1);
                }
              } else {
                for(let i=0; i<12; i++) { 
                  monthsToShow.push(new Date(now.getFullYear(), now.getMonth()+i, 1)); 
                }
              }
              return monthsToShow.map((m, idx) => <div key={idx}>{renderMiniCalendar(m)}</div>);
            })()}
          </div>
        )}

        {viewMode === 'registered' && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {(() => {
              const combined: any[] = [];
              const now = new Date();
              const todayStr = getYYYYMMDD(now);
              const currentMins = getCurrentTimeInMinutes();

              for (let i = 0; i < 300; i++) {
                const checkDate = new Date(); 
                checkDate.setDate(now.getDate() - i); 
                const dateStr = getYYYYMMDD(checkDate); 
                const dayOfWeek = checkDate.getDay() as DayOfWeek;
                
                if (dateStr > todayStr) continue;
                if (isHoliday(checkDate)) continue;

                data.schedules.forEach(s => {
                  if (Number(s.dayOfWeek) !== dayOfWeek || s.classId === 'window') return;
                  if (filterInstId !== 'all' && s.schoolId !== filterInstId) return;
                  if (filterClassId !== 'all' && s.classId !== filterClassId) return;
                  
                  const school = data.schools.find(sc => sc.id === s.schoolId);
                  
                  if (isLessonBlocked(dateStr, s.schoolId, s.shiftId, s.classId)) return;

                  const slot = school?.shifts.find(sh => sh.id === s.shiftId)?.slots.find(sl => sl.id === s.slotId);
                  if (!slot) return;

                  const calendar = data.calendars.find(c => c.schoolId === s.schoolId);
                  if (calendar) {
                    if (calendar.start && dateStr < calendar.start) return;
                    if (calendar.end && dateStr > calendar.end) return;
                  }

                  let isPast = false;
                  if (dateStr < todayStr) isPast = true;
                  else if (dateStr === todayStr) isPast = currentMins >= parseTimeToMinutes(slot.endTime);

                  if (!isPast) return;

                  const log = data.logs.find(l => l.date.startsWith(dateStr) && l.slotId === s.slotId && l.schoolId === s.schoolId);
                  if (log && log.type === 'substitution') return;

                  combined.push({ schedule: s, log, date: dateStr, institution: school, slot });
                });

                const extraLogs = data.logs.filter(l => 
                   l.date.startsWith(dateStr) && 
                   l.type === 'extra' && 
                   (filterInstId === 'all' || l.schoolId === filterInstId) &&
                   (filterClassId === 'all' || l.classId === filterClassId)
                );

                extraLogs.forEach(el => {
                   const school = data.schools.find(sc => sc.id === el.schoolId);
                   combined.push({
                      schedule: { classId: el.classId, schoolId: el.schoolId, dayOfWeek, shiftId: 'extra', slotId: el.slotId },
                      log: el,
                      date: dateStr,
                      institution: school,
                      slot: { startTime: el.startTime || '??:??', endTime: el.endTime || '??:??', label: 'Extra', id: el.slotId, type: 'class' }
                   });
                });

                if (data.settings.isPrivateTeacher) {
                  data.students.forEach(st => {
                    if (filterInstId !== 'all' && st.id !== filterInstId) return;
                    if (filterClassId !== 'all' && st.name !== filterClassId) return;
                    if (dateStr < st.startDate) return;
                    if (isLessonBlocked(dateStr, st.id)) return;
                    
                    st.schedules.filter(ps => Number(ps.dayOfWeek) === dayOfWeek).forEach(ps => {
                      let isPast = false;
                      if (dateStr < todayStr) isPast = true;
                      else if (dateStr === todayStr) isPast = currentMins >= parseTimeToMinutes(ps.endTime);

                      if (!isPast) return;

                      const log = data.logs.find(l => l.date.startsWith(dateStr) && l.slotId === ps.id && l.studentId === st.id);
                      combined.push({ 
                        schedule: { dayOfWeek, schoolId: st.id, shiftId: 'private', slotId: ps.id, classId: st.name }, 
                        log, 
                        date: dateStr, 
                        institution: st,
                        slot: { id: ps.id, startTime: ps.startTime, endTime: ps.endTime, label: 'Particular', type: 'class' }
                      });
                    });
                  });
                }
              }
              
              const sorted = combined.sort((a,b) => b.date.localeCompare(a.date));

              if (sorted.length === 0) {
                return (
                  <div className="col-span-full py-20 text-center">
                    <History className="mx-auto mb-2 text-slate-300" size={32} />
                    <p className="text-[10px] font-black uppercase text-slate-500">Nenhum histórico encontrado para este período.</p>
                  </div>
                );
              }

              return sorted.map((item, idx) => (
                <button key={idx} onClick={() => handleOpenLog(item.schedule as any, item.date)} className={`bg-white dark:bg-slate-900 p-6 rounded-[32px] border-2 transition-all text-left flex items-center gap-5 hover:shadow-lg ${item.log ? 'border-green-100 dark:border-green-900/20' : 'border-red-50 dark:border-red-900/10'}`}>
                  <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center border-b-2 shrink-0 ${item.log ? 'bg-green-50 text-green-600 border-green-100 dark:bg-green-900/40' : 'bg-red-50 text-red-600 border-red-100 dark:bg-red-900/40'}`}>
                    <span className="text-[8px] font-black uppercase">{DAYS_OF_WEEK_NAMES[new Date(item.date + 'T00:00:00').getDay() as DayOfWeek].slice(0, 3)}</span>
                    <span className="text-xs font-black">{new Date(item.date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                  </div>
                  <div className="overflow-hidden flex-1">
                    {/* Updated Wrapper with School Color Background */}
                    <div className="mb-2 p-2 rounded-xl border-l-4" style={{ backgroundColor: (item.institution?.color || '#cbd5e1') + '15', borderColor: item.institution?.color || '#cbd5e1' }}>
                       <h4 className="text-sm font-black uppercase truncate text-slate-800 dark:text-white">
                          {item.schedule.classId} {item.log?.type === 'extra' && '(Extra)'}
                       </h4>
                       <p className="text-[9px] font-bold text-slate-600 dark:text-slate-300 uppercase truncate opacity-90 mt-0.5">
                          {item.institution?.name} • {item.slot.label} {item.institution && 'shifts' in item.institution ? `• ${item.institution.shifts.find((s:any) => s.id === item.schedule.shiftId)?.name || ''}` : ''}
                       </p>
                    </div>

                    <div className={`p-2 rounded-xl text-[10px] font-bold italic truncate ${item.log ? 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400' : 'bg-red-50/50 dark:bg-red-900/20 text-red-400 dark:text-red-300'}`}>
                      {item.log ? `"${item.log.subject}"` : "⚠ Registro Pendente"}
                    </div>
                  </div>
                </button>
              ));
            })()}
          </div>
        )}
      </div>

      {/* Modal de Aula Extra / Substituição REIMPLEMENTADO */}
      {isExtraLessonModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[32px] md:rounded-[40px] p-6 md:p-8 w-full max-w-xl shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
             <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg md:text-xl font-black uppercase text-slate-800 dark:text-white">Registrar Aula Extra</h3>
                <button onClick={() => setIsExtraLessonModalOpen(false)} className="text-slate-300 hover:text-slate-600"><X /></button>
             </div>
             
             <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                   <button onClick={() => setExtraLessonForm({...extraLessonForm, type: 'extra'})} className={`py-4 rounded-xl font-black uppercase text-[10px] tracking-widest border-2 transition-all ${extraLessonForm.type === 'extra' ? 'bg-indigo-50 border-indigo-500 text-indigo-600 shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>Aula Extra</button>
                   <button onClick={() => setExtraLessonForm({...extraLessonForm, type: 'substitution'})} className={`py-4 rounded-xl font-black uppercase text-[10px] tracking-widest border-2 transition-all ${extraLessonForm.type === 'substitution' ? 'bg-amber-50 border-amber-500 text-amber-600 shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>Substituição</button>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                   <div>
                     <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Data</label>
                     <input type="date" value={extraLessonForm.date} onChange={e => setExtraLessonForm({...extraLessonForm, date: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm" />
                   </div>
                   <div>
                     <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Escola</label>
                     <select value={extraLessonForm.schoolId} onChange={e => setExtraLessonForm({...extraLessonForm, schoolId: e.target.value, classId: '', selectedSlotId: 'custom'})} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm">
                        <option value="">Selecione...</option>
                        {data.schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                     </select>
                   </div>
                </div>

                {extraLessonForm.schoolId && (
                   <div>
                     <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Turma</label>
                     <select value={extraLessonForm.classId} onChange={e => setExtraLessonForm({...extraLessonForm, classId: e.target.value})} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm">
                        <option value="">Selecione...</option>
                        {data.schools.find(s => s.id === extraLessonForm.schoolId)?.classes.map(c => <option key={c} value={c}>{c}</option>)}
                     </select>
                   </div>
                )}

                {extraLessonForm.type === 'substitution' && (
                   <div>
                     <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Disciplina Substituída</label>
                     <input type="text" value={extraLessonForm.substitutionSubject} onChange={e => setExtraLessonForm({...extraLessonForm, substitutionSubject: e.target.value})} className="w-full bg-amber-50 dark:bg-amber-900/10 border-none rounded-xl px-4 py-3 font-bold text-amber-700 dark:text-amber-400 text-sm" placeholder="Ex: Matemática, História..." />
                   </div>
                )}

                {extraLessonForm.schoolId && (
                   <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
                      <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Horário da Aula</label>
                      <select value={extraLessonForm.selectedSlotId} onChange={e => handleSlotSelection(e.target.value, extraLessonForm.schoolId)} className="w-full bg-white dark:bg-slate-700 border-none rounded-xl px-4 py-2 font-bold dark:text-white text-xs mb-3">
                         <option value="custom">Horário Personalizado</option>
                         {data.schools.find(s => s.id === extraLessonForm.schoolId)?.shifts.map(shift => (
                            <optgroup key={shift.id} label={shift.name}>
                               {shift.slots.filter(s => s.type === 'class').map(slot => (
                                  <option key={slot.id} value={slot.id}>{slot.label} ({slot.startTime} - {slot.endTime})</option>
                               ))}
                            </optgroup>
                         ))}
                      </select>
                      <div className="flex gap-2">
                         <input type="time" value={extraLessonForm.startTime} onChange={e => setExtraLessonForm({...extraLessonForm, startTime: e.target.value, selectedSlotId: 'custom'})} className="flex-1 bg-white dark:bg-slate-700 border-none rounded-xl px-3 py-2 font-bold dark:text-white text-xs text-center" />
                         <span className="text-slate-300 font-bold self-center">às</span>
                         <input type="time" value={extraLessonForm.endTime} onChange={e => setExtraLessonForm({...extraLessonForm, endTime: e.target.value, selectedSlotId: 'custom'})} className="flex-1 bg-white dark:bg-slate-700 border-none rounded-xl px-3 py-2 font-bold dark:text-white text-xs text-center" />
                      </div>
                   </div>
                )}

                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Conteúdo Ministrado</label>
                  <textarea value={extraLessonForm.subject} onChange={e => setExtraLessonForm({...extraLessonForm, subject: e.target.value})} rows={2} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm" placeholder="O que foi dado na aula..." />
                </div>
             </div>

             <div className="mt-8 flex gap-4">
                <button onClick={() => setIsExtraLessonModalOpen(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-[10px]">Cancelar</button>
                <button onClick={handleSaveExtraLesson} disabled={!extraLessonForm.date || !extraLessonForm.schoolId || !extraLessonForm.classId} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-indigo-100 disabled:opacity-50 disabled:shadow-none">Salvar Aula</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LessonLogger;