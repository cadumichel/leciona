import React, { useState, useMemo, useEffect } from 'react';
import { AppData, SchoolEvent, TimeSlot, LessonLog, AcademicCalendar, Term } from '../types';
import {
  FileCheck, Calendar, Trash2, Plus, X, Copy, CheckCircle2, Pencil,
  School as SchoolIcon, Search, ChevronRight, ChevronDown, SlidersHorizontal,
  Clock, AlertTriangle, CheckCheck, BookOpen
} from 'lucide-react';
import { isHoliday, getHolidayName, getDayOfWeekFromDate, getSafeDate } from '../utils';
import { getSchedulesForDate } from '../utils/schedule';

interface AssessmentManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatMonthHeader(dateStr: string): string {
  const d = getSafeDate(dateStr);
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    .replace(/^\w/, c => c.toUpperCase());
}

function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

// Return the Monday (YYYY-MM-DD) of the week containing dateStr
function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun … 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

// Return the Friday (YYYY-MM-DD) of the week starting on mondayStr
function getFridayOfWeek(mondayStr: string): string {
  const d = new Date(mondayStr + 'T12:00:00');
  d.setDate(d.getDate() + 4);
  return d.toISOString().split('T')[0];
}

function fmtShort(dateStr: string): string {
  return getSafeDate(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// ─── Component ───────────────────────────────────────────────────────────────

const AssessmentManagement: React.FC<AssessmentManagementProps> = ({ data, onUpdateData }) => {

  // ── Modal State ──────────────────────────────────────────────────────────
  const [isAdding, setIsAdding] = useState(false);
  const [newEvent, setNewEvent] = useState<Partial<SchoolEvent>>({
    type: 'test', title: '', date: new Date().toISOString().split('T')[0],
    schoolId: '', classId: '', slotId: '', description: ''
  });
  const [dateWarning, setDateWarning] = useState('');
  const [isInvalidDate, setIsInvalidDate] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Filter State ─────────────────────────────────────────────────────────
  const [filterSchoolId, setFilterSchoolId] = useState('all');
  const [filterClassId, setFilterClassId] = useState('all');
  const [filterTermIdx, setFilterTermIdx] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'scheduled' | 'done'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // ── Layout/Grouping State ────────────────────────────────────────────────
  const [cardsPerRow, setCardsPerRow] = useState(4);
  const [groupByWeek, setGroupByWeek] = useState(false);

  // ── Copy State ───────────────────────────────────────────────────────────
  const [isCopyOpen, setIsCopyOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyData, setCopyData] = useState({
    targetDate: '', targetSchoolId: '', targetClassId: '', targetSlotId: '',
  });

  // ── Derived: active school for the form ──────────────────────────────────
  const activeSchool = useMemo(
    () => (data.schools || []).find(s => s.id === newEvent.schoolId),
    [data.schools, newEvent.schoolId]
  );

  // Auto-select first school when modal opens
  useEffect(() => {
    if (isAdding) {
      const isValid = (data.schools || []).some(s => s.id === newEvent.schoolId && !s.deleted);
      if (!newEvent.schoolId || !isValid) {
        const first = (data.schools || []).find(s => !s.deleted);
        if (first) setNewEvent(prev => ({ ...prev, schoolId: first.id }));
      }
    }
  }, [isAdding, data.schools, newEvent.schoolId]);

  // Auto-select school for copy modal
  useEffect(() => {
    if (copyData.isOpen && !copyData.targetSchoolId && data.schools.length > 0) {
      setCopyData(prev => ({ ...prev, targetSchoolId: data.schools[0].id }));
    }
  }, [copyData.isOpen, data.schools]);

  // Reset save animation on field change
  useEffect(() => { setSaveSuccess(false); },
    [newEvent.title, newEvent.classId, newEvent.slotId, newEvent.date, newEvent.schoolId]);

  // ── Validation helpers ────────────────────────────────────────────────────
  const validateDateLogic = (dateStr: string, schoolId: string, classId: string) => {
    const date = getSafeDate(dateStr);
    let warning = '', invalid = false;
    if (isHoliday(date)) { warning = `Feriado: ${getHolidayName(date)}.`; invalid = true; }
    else {
      const calendar = data.calendars.find(c => c.schoolId === schoolId);
      if (calendar) {
        if (calendar.midYearBreak.start && dateStr >= calendar.midYearBreak.start && dateStr <= calendar.midYearBreak.end) {
          warning = 'Data em período de recesso.'; invalid = true;
        } else if (calendar.extraRecesses?.some(r => r.date === dateStr)) {
          warning = 'Data em período de recesso.'; invalid = true;
        }
      }
    }
    if (!invalid) {
      const blocking = data.events.find(e =>
        e.schoolId === schoolId && e.date.startsWith(dateStr) && e.blocksClasses && (!e.classId || e.classId === classId)
      );
      if (blocking) { warning = `Conflito: "${blocking.title}" cancela aulas.`; invalid = true; }
    }
    return { warning, invalid };
  };

  const handleDateChange = (dateStr: string) => {
    const { warning, invalid } = validateDateLogic(dateStr, newEvent.schoolId!, newEvent.classId!);
    setIsInvalidDate(invalid); setDateWarning(warning);
    setNewEvent(prev => ({ ...prev, date: dateStr, slotId: '' }));
  };

  const handleClassChange = (classId: string) => {
    const { warning, invalid } = validateDateLogic(newEvent.date!, newEvent.schoolId!, classId);
    setIsInvalidDate(invalid); setDateWarning(warning);
    setNewEvent(prev => ({ ...prev, classId, slotId: '' }));
  };

  // ── Available slots for the form ─────────────────────────────────────────
  const { restrictedAvailableSlots, isOutOfClassDay } = useMemo(() => {
    if (!activeSchool || !newEvent.date || !newEvent.classId || isInvalidDate) return { restrictedAvailableSlots: [], isOutOfClassDay: false };
    const dow = getDayOfWeekFromDate(newEvent.date);
    const cls = activeSchool.classes.find(c => (typeof c === 'string' ? c : c.id) === newEvent.classId);
    if (!cls) return { restrictedAvailableSlots: [], isOutOfClassDay: false };
    const cName = typeof cls === 'string' ? cls : cls.name;
    const cId = typeof cls === 'string' ? cls : cls.id;
    const entries = getSchedulesForDate(data, newEvent.date).filter(s =>
      Number(s.dayOfWeek) === dow && s.schoolId === newEvent.schoolId &&
      (s.classId === cId || s.classId === cName)
    );
    const slots: TimeSlot[] = [];
    let outOfClass = false;
    if (entries.length > 0) {
      entries.forEach(entry => {
        const shift = activeSchool.shifts?.find(sh => sh.id === entry.shiftId);
        const slot = shift?.slots.find(sl => sl.id === entry.slotId);
        if (slot) slots.push(slot);
      });
    } else {
      outOfClass = true;
      activeSchool.shifts?.forEach(shift => {
        shift.slots.forEach(slot => {
          slots.push(slot);
        });
      });
    }
    const uniqueSlots = Array.from(new Map(slots.map(s => [s.id, s])).values());
    return { restrictedAvailableSlots: uniqueSlots, isOutOfClassDay: outOfClass };
  }, [activeSchool, newEvent.date, newEvent.classId, data.schedules, isInvalidDate]);

  // ── Available slots for copy ──────────────────────────────────────────────
  const copyTargetSchool = useMemo(
    () => (data.schools || []).find(s => s.id === copyData.targetSchoolId),
    [data.schools, copyData.targetSchoolId]
  );
  const { availableSlotsForCopy, isCopyOutOfClassDay } = useMemo(() => {
    if (!copyTargetSchool || !copyData.targetDate || !copyData.targetClassId) return { availableSlotsForCopy: [], isCopyOutOfClassDay: false };
    const { invalid } = validateDateLogic(copyData.targetDate, copyData.targetSchoolId, copyData.targetClassId);
    if (invalid) return { availableSlotsForCopy: [], isCopyOutOfClassDay: false };
    const dow = getDayOfWeekFromDate(copyData.targetDate);
    const cls = copyTargetSchool.classes.find(c => (typeof c === 'string' ? c : c.id) === copyData.targetClassId);
    if (!cls) return { availableSlotsForCopy: [], isCopyOutOfClassDay: false };
    const cName = typeof cls === 'string' ? cls : cls.name;
    const cId = typeof cls === 'string' ? cls : cls.id;
    const entries = getSchedulesForDate(data, copyData.targetDate).filter(s =>
      Number(s.dayOfWeek) === dow && s.schoolId === copyData.targetSchoolId &&
      (s.classId === cId || s.classId === cName)
    );
    const slots: TimeSlot[] = [];
    let outOfClass = false;
    if (entries.length > 0) {
      entries.forEach(entry => {
        const shift = copyTargetSchool.shifts?.find(sh => sh.id === entry.shiftId);
        const slot = shift?.slots.find(sl => sl.id === entry.slotId);
        if (slot) slots.push(slot);
      });
    } else {
      outOfClass = true;
      copyTargetSchool.shifts?.forEach(shift => {
        shift.slots.forEach(slot => {
          slots.push(slot);
        });
      });
    }
    const uniqueSlots = Array.from(new Map(slots.map(s => [s.id, s])).values());
    return { availableSlotsForCopy: uniqueSlots, isCopyOutOfClassDay: outOfClass };
  }, [copyTargetSchool, copyData.targetDate, copyData.targetClassId, data.schedules]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSaveEvent = () => {
    if (!newEvent.title || !newEvent.classId || !newEvent.slotId || isInvalidDate) return;
    const safeDateISO = getSafeDate(newEvent.date!).toISOString();
    const eventId = newEvent.id || crypto.randomUUID();
    let currentLogs = [...data.logs];
    let currentEvents = [...data.events];
    if (newEvent.id) {
      const orig = data.events.find(e => e.id === newEvent.id);
      if (orig) {
        currentEvents = currentEvents.filter(e => e.id !== newEvent.id);
        currentLogs = currentLogs.filter(l => !(l.date === orig.date && l.schoolId === orig.schoolId && l.slotId === orig.slotId));
      }
    }
    const event: SchoolEvent = {
      id: eventId, title: newEvent.title!, date: safeDateISO,
      schoolId: newEvent.schoolId!, classId: newEvent.classId!, slotId: newEvent.slotId,
      type: newEvent.type as 'test' | 'work', description: newEvent.description || '', blocksClasses: false
    };
    const newLog: LessonLog = {
      id: crypto.randomUUID(), date: safeDateISO, schoolId: event.schoolId,
      classId: event.classId!, slotId: event.slotId!,
      subject: `Avaliação: ${event.title}`, homework: '', notes: event.description || ''
    };
    currentLogs = currentLogs.filter(l =>
      !(l.date.split('T')[0] === newEvent.date && l.schoolId === event.schoolId && l.slotId === event.slotId)
    );
    onUpdateData({ events: [...currentEvents, event], logs: [...currentLogs, newLog] });
    setSaveSuccess(true);
    if (!newEvent.id) setNewEvent(prev => ({ ...prev, id: eventId }));
    setTimeout(() => {
      setSaveSuccess(false);
      setIsAdding(false);
      setIsCopyOpen(false);
    }, 1500);
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDeleteEvent = () => {
    if (!newEvent.id) return;
    const eventId = newEvent.id;
    const event = data.events.find(e => e.id === eventId);
    if (!event) return;

    const currentEvents = data.events.filter(e => e.id !== eventId);
    const currentGrades = data.grades.filter(g => g.assessmentId !== eventId);

    // Remover o registro de diário (LessonLog) que foi gerado automaticamente para esta avaliação
    const safeDateStr = event.date.split('T')[0];
    const currentLogs = data.logs.filter(l =>
      !(l.date.split('T')[0] === safeDateStr && l.schoolId === event.schoolId && l.slotId === event.slotId && l.subject.startsWith('Avaliação:'))
    );

    onUpdateData({ events: currentEvents, grades: currentGrades, logs: currentLogs });
    setDeletingEventId(null);
    setIsAdding(false);
  };

  // ── Copy ──────────────────────────────────────────────────────────────────
  const handleCopyAssessment = () => {
    if (!newEvent.title || !copyData.targetDate || !copyData.targetClassId || !copyData.targetSlotId) return;
    const safeDateISO = getSafeDate(copyData.targetDate).toISOString();
    const eventId = crypto.randomUUID();
    const event: SchoolEvent = {
      id: eventId, title: newEvent.title, date: safeDateISO,
      schoolId: copyData.targetSchoolId, classId: copyData.targetClassId, slotId: copyData.targetSlotId,
      type: newEvent.type as 'test' | 'work', description: newEvent.description || '', blocksClasses: false
    };
    const newLog: LessonLog = {
      id: crypto.randomUUID(), date: safeDateISO, schoolId: event.schoolId,
      classId: event.classId!, slotId: event.slotId!,
      subject: `Avaliação: ${event.title}`, homework: '', notes: event.description || ''
    };
    const filteredLogs = data.logs.filter(l =>
      !(l.date.split('T')[0] === copyData.targetDate && l.schoolId === event.schoolId && l.slotId === event.slotId)
    );
    onUpdateData({ events: [...data.events, event], logs: [...filteredLogs, newLog] });
    setCopyData(prev => ({ ...prev, targetClassId: '', targetSlotId: '' }));
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  };

  // ── Filter options derived from data ──────────────────────────────────────
  const assessmentEvents = useMemo(
    () => data.events.filter(e => e.type === 'test' || e.type === 'work'),
    [data.events]
  );

  // Collect unique schools that have assessments
  const schoolsWithEvents = useMemo(() => {
    const ids = new Set(assessmentEvents.map(e => e.schoolId));
    return (data.schools || []).filter(s => ids.has(s.id));
  }, [assessmentEvents, data.schools]);

  // Classes for selected filter school
  const classesForFilter = useMemo(() => {
    if (filterSchoolId === 'all') {
      const all: { id: string; name: string }[] = [];
      schoolsWithEvents.forEach(s => {
        (s.classes || []).filter(c => typeof c === 'string' || !c.deleted).forEach(c => {
          const id = typeof c === 'string' ? c : c.id;
          const name = typeof c === 'string' ? c : c.name;
          if (!all.find(x => x.id === id)) all.push({ id, name });
        });
      });
      return all.sort((a, b) => a.name.localeCompare(b.name));
    }
    const school = data.schools.find(s => s.id === filterSchoolId);
    return (school?.classes || [])
      .filter(c => typeof c === 'string' || !c.deleted)
      .map(c => ({ id: typeof c === 'string' ? c : c.id, name: typeof c === 'string' ? c : c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filterSchoolId, schoolsWithEvents, data.schools]);

  // Terms for selected filter school
  const termsForFilter = useMemo((): (Term & { idx: number })[] => {
    const schoolId = filterSchoolId !== 'all' ? filterSchoolId : null;
    const cal = data.calendars.find(c => !schoolId || c.schoolId === schoolId);
    if (!cal) return [];
    return cal.terms.map((t, i) => ({ ...t, idx: i }));
  }, [filterSchoolId, data.calendars]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  const filteredEvents = useMemo(() => {
    let list = assessmentEvents;

    if (filterSchoolId !== 'all') list = list.filter(e => e.schoolId === filterSchoolId);

    if (filterClassId !== 'all') {
      list = list.filter(e => {
        const school = data.schools.find(s => s.id === e.schoolId);
        const cls = school?.classes.find(c =>
          (typeof c === 'string' ? c : c.id) === filterClassId ||
          (typeof c === 'string' ? c : c.name) === filterClassId
        );
        if (!cls) return false;
        const cId = typeof cls === 'string' ? cls : cls.id;
        const cName = typeof cls === 'string' ? cls : cls.name;
        return e.classId === cId || e.classId === cName;
      });
    }

    if (filterTermIdx !== 'all') {
      const idx = parseInt(filterTermIdx);
      // Find term dates — try to find the matching calendar
      const calendars = data.calendars;
      list = list.filter(e => {
        const cal = calendars.find(c => c.schoolId === e.schoolId) || calendars[0];
        const term = cal?.terms[idx];
        if (!term) return false;
        const d = e.date.split('T')[0];
        return d >= term.start && d <= term.end;
      });
    }

    if (filterStatus !== 'all') {
      list = list.filter(e => {
        const d = e.date.split('T')[0];
        const hasGrades = data.grades.some(g => g.assessmentId === e.id);
        const isDone = hasGrades || d < today;
        return filterStatus === 'done' ? isDone : !isDone;
      });
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e =>
        e.title.toLowerCase().includes(q) ||
        (e.description || '').toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [assessmentEvents, filterSchoolId, filterClassId, filterTermIdx, filterStatus, searchQuery, data.schools, data.calendars, data.grades, today]);

  // Group by month (and optionally by Mon–Fri week inside each month)
  type WeekGroup = { weekKey: string; label: string; events: SchoolEvent[] };
  type MonthGroup = { key: string; label: string; weeks: WeekGroup[] };

  const grouped = useMemo((): MonthGroup[] => {
    const months: MonthGroup[] = [];
    // Track sequential week number across the whole list
    const weekSeq = new Map<string, number>();
    let weekCounter = 0;

    filteredEvents.forEach(e => {
      const monthKey = getMonthKey(e.date);
      let month = months.find(m => m.key === monthKey);
      if (!month) { month = { key: monthKey, label: formatMonthHeader(e.date), weeks: [] }; months.push(month); }

      const weekKey = getMondayOfWeek(e.date.split('T')[0]);
      let week = month.weeks.find(w => w.weekKey === weekKey);
      if (!week) {
        if (!weekSeq.has(weekKey)) { weekSeq.set(weekKey, ++weekCounter); }
        const fridayStr = getFridayOfWeek(weekKey);
        const label = `Semana ${weekSeq.get(weekKey)}: ${fmtShort(weekKey)} a ${fmtShort(fridayStr)}`;
        week = { weekKey, label, events: [] };
        month.weeks.push(week);
      }
      week.events.push(e);
    });
    return months;
  }, [filteredEvents]);

  // ── Helper: resolve class name from event ─────────────────────────────────
  const resolveClassName = (event: SchoolEvent) => {
    const school = data.schools.find(s => s.id === event.schoolId);
    const cls = school?.classes.find(c =>
      (typeof c === 'string' ? c : c.id) === event.classId ||
      (typeof c === 'string' ? c : c.name) === event.classId
    );
    return cls ? (typeof cls === 'string' ? cls : cls.name) : event.classId;
  };

  // ── Helper: status badge for assessment ───────────────────────────────────
  const getStatusBadge = (event: SchoolEvent) => {
    const d = event.date.split('T')[0];
    const hasGrades = data.grades.some(g => g.assessmentId === event.id);
    if (hasGrades) return { label: 'Notas Lançadas', color: 'bg-blue-50 text-blue-600 border-blue-200', icon: <CheckCheck size={12} strokeWidth={3} /> };
    if (d < today) return { label: 'Realizada', color: 'bg-emerald-50 text-emerald-600 border-emerald-200', icon: <CheckCircle2 size={12} strokeWidth={3} /> };
    return { label: 'Agendada', color: 'bg-amber-50 text-amber-600 border-amber-200', icon: <Calendar size={12} strokeWidth={3} /> };
  };

  // ── Open form for new assessment ──────────────────────────────────────────
  const openNewForm = () => {
    setSaveSuccess(false);
    setNewEvent({
      type: 'test', title: '', date: new Date().toISOString().split('T')[0],
      schoolId: (data.schools || [])[0]?.id || '', classId: '', slotId: '', description: ''
    });
    setDateWarning(''); setIsInvalidDate(false);
    setIsAdding(true);
  };

  const openEditForm = (event: SchoolEvent) => {
    setSaveSuccess(false);
    setNewEvent({
      id: event.id, title: event.title, date: event.date.split('T')[0],
      schoolId: event.schoolId, classId: event.classId, slotId: event.slotId,
      type: event.type, description: event.description
    });
    setDateWarning(''); setIsInvalidDate(false);
    setIsAdding(true);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 md:space-y-6 pb-20">

      {/* ── Header ── */}
      <div className="bg-white dark:bg-slate-900 p-4 md:p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2">
            <FileCheck className="text-blue-600 w-5 h-5" /> Avaliações
          </h3>
          <p className="text-[9px] text-slate-500 font-black uppercase tracking-tight mt-0.5">
            {filteredEvents.length} avaliação{filteredEvents.length !== 1 ? 'ões' : ''} {filterSchoolId !== 'all' || filterClassId !== 'all' || filterTermIdx !== 'all' || searchQuery ? 'encontrada' + (filteredEvents.length !== 1 ? 's' : '') : 'no total'}
          </p>
        </div>
        <button
          onClick={openNewForm}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-black uppercase text-[9px] tracking-tight shadow-lg shadow-blue-100 hover:brightness-110 transition-all flex items-center gap-2 self-start sm:self-auto shrink-0"
        >
          <Plus size={15} /> Nova Avaliação
        </button>
      </div>

      {/* ── Filter Toolbar ── */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-3 md:p-4 space-y-3">
        {/* Search row */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar avaliação..."
            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border-none text-sm font-bold dark:text-white placeholder:text-slate-400 placeholder:font-normal"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filter dropdowns row */}
        <div className="flex gap-2 flex-wrap">
          <div className="flex items-center gap-1 shrink-0">
            <SlidersHorizontal size={12} className="text-slate-400" />
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-tight">Filtros:</span>
          </div>

          {/* School filter */}
          <select
            value={filterSchoolId}
            onChange={e => { setFilterSchoolId(e.target.value); setFilterClassId('all'); setFilterTermIdx('all'); }}
            className="bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-1.5 text-[10px] font-bold dark:text-white flex-1 min-w-[120px]"
          >
            <option value="all">Todas as escolas</option>
            {schoolsWithEvents.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {/* Class filter */}
          <select
            value={filterClassId}
            onChange={e => setFilterClassId(e.target.value)}
            className="bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-1.5 text-[10px] font-bold dark:text-white flex-1 min-w-[110px]"
          >
            <option value="all">Todas as turmas</option>
            {classesForFilter.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {/* Period filter */}
          {termsForFilter.length > 0 && (
            <select
              value={filterTermIdx}
              onChange={e => setFilterTermIdx(e.target.value)}
              className="bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-1.5 text-[10px] font-bold dark:text-white flex-1 min-w-[110px]"
            >
              <option value="all">Todo o período</option>
              {termsForFilter.map(t => <option key={t.idx} value={String(t.idx)}>{t.name}</option>)}
            </select>
          )}

        </div>

        {/* Layout row */}
        <div className="flex items-center gap-3 pt-1 border-t border-slate-100 dark:border-slate-800">
          {/* Cards per row */}
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-tight shrink-0">Cards/linha:</span>
            <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-1">
              {[1, 2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  onClick={() => setCardsPerRow(n)}
                  className={`w-6 h-6 flex-shrink-0 flex items-center justify-center rounded text-[9px] font-black transition-all ${cardsPerRow === n
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-slate-200'
                    }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Week grouping toggle */}
          <button
            onClick={() => setGroupByWeek(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-tight transition-all ${groupByWeek
              ? 'bg-blue-600 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-slate-200'
              }`}
          >
            <Calendar size={11} />
            Por semana
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Status filter */}
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
            {([['all', 'Todas'], ['scheduled', 'Agendadas'], ['done', 'Realizadas']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFilterStatus(val)}
                className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-tight transition-all ${filterStatus === val
                  ? val === 'done'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : val === 'scheduled'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
                  }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Grouped Assessment List ── */}
      {grouped.length === 0 ? (
        <div className="py-16 bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center gap-4 text-center">
          <FileCheck size={40} className="text-slate-300 dark:text-slate-700" />
          <div>
            <p className="text-slate-500 font-black uppercase text-[10px] tracking-tight">
              {searchQuery || filterSchoolId !== 'all' || filterClassId !== 'all' || filterTermIdx !== 'all' || filterStatus !== 'all'
                ? 'Nenhuma avaliação encontrada'
                : 'Nenhuma avaliação agendada'}
            </p>
            <p className="text-slate-400 text-[9px] uppercase mt-1">
              {searchQuery || filterSchoolId !== 'all' || filterClassId !== 'all' || filterTermIdx !== 'all' || filterStatus !== 'all'
                ? 'Tente ajustar os filtros.'
                : 'Clique em "Nova Avaliação" para começar.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(group => {
            const totalInMonth = group.weeks.reduce((s, w) => s + w.events.length, 0);
            const allMonthEvents = group.weeks.flatMap(w => w.events);

            // Reusable card renderer
            const renderCard = (event: SchoolEvent) => {
              const school = data.schools.find(s => s.id === event.schoolId);
              const color = school?.color || '#3b82f6';
              const status = getStatusBadge(event);
              // Diary-style date badge helpers
              const evDate = getSafeDate(event.date);
              const dayAbbr = evDate.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
              const dayMonth = evDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
              const evtClassName = resolveClassName(event);
              const shiftInfo = (() => {
                if (!school || !event.slotId) return { label: null, shiftName: null };
                for (const shift of (school.shifts || [])) {
                  const slot = shift.slots.find(s => s.id === event.slotId);
                  if (slot) return { label: slot.label, shiftName: shift.name };
                }
                return { label: null, shiftName: null };
              })();

              return (
                <div
                  key={event.id}
                  onClick={() => openEditForm(event)}
                  title={event.title}
                  data-compact={cardsPerRow >= 3}
                  className="relative bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer group overflow-hidden flex flex-col"
                >
                  {/* Top strip: date badge + center info + right slot */}
                  <div className="flex items-center gap-2 data-[compact=true]:p-2 p-3">

                    {/* LEFT: Colored date badge */}
                    <div
                      className="rounded-xl flex flex-col items-center justify-center shrink-0 data-[compact=true]:px-1.5 data-[compact=true]:py-1 px-2.5 py-1.5 data-[compact=true]:min-w-[40px] min-w-[48px]"
                      style={{ backgroundColor: color }}
                    >
                      <span className="data-[compact=true]:text-[6px] text-[8px] font-black text-white/80 uppercase tracking-widest leading-none">{dayAbbr}</span>
                      <span className="data-[compact=true]:text-[10px] text-[13px] font-black text-white leading-tight mt-0.5">{dayMonth}</span>
                    </div>

                    {/* CENTER: Class name + assessment title */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <p className="data-[compact=true]:text-[10px] text-[13px] font-black text-slate-700 dark:text-white leading-tight truncate">{evtClassName}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="data-[compact=true]:text-[8px] text-[10px] font-bold text-slate-500 dark:text-slate-400 truncate">{event.title}</p>
                        <span
                          className="data-[compact=true]:hidden text-[7px] font-black px-1.5 py-0.5 rounded uppercase shrink-0"
                          style={{ backgroundColor: color + `22`, color }}
                        >
                          {event.type === `test` ? `Prova` : `Trabalho`}
                        </span>
                      </div>
                    </div>

                    {/* RIGHT: Slot label + shift name */}
                    <div className="shrink-0 text-right data-[compact=true]:hidden">
                      {shiftInfo.label && (
                        <p className="text-[9px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-tight">{shiftInfo.label}</p>
                      )}
                      {shiftInfo.shiftName && (
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-tight mt-0.5">{shiftInfo.shiftName}</p>
                      )}
                    </div>
                  </div>

                  {/* Removed Action Buttons */}

                  {/* Bottom strip: school name + status badge + optional description */}
                  <div className="border-t border-slate-50 dark:border-slate-800 px-3 py-1.5 flex items-center gap-2">
                    <span className="data-[compact=true]:text-[7px] text-[9px] font-black truncate max-w-[50%]" style={{ color }}>{school?.name}</span>
                    <div className="flex-1" />
                    {event.description && event.description.trim() && (
                      <p className="data-[compact=true]:hidden text-[9px] text-slate-400 font-medium truncate flex items-center gap-1 max-w-[140px]">
                        <BookOpen size={9} className="text-slate-300 shrink-0" />
                        {event.description}
                      </p>
                    )}
                    <span title={status.label} className={`p-1 rounded-md border shrink-0 flex items-center justify-center cursor-help transition-colors ${status.color}`}>
                      {status.icon}
                    </span>
                  </div>
                </div>
              );
            };

            return (
              <div key={group.key}>
                {/* Month divider */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{group.label}</span>
                  <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
                  <span className="text-[9px] font-black text-slate-300 uppercase">{totalInMonth} av.</span>
                </div>

                {groupByWeek ? (
                  /* ── Week sub-groups ── */
                  <div className="space-y-4">
                    {group.weeks.map(week => (
                      <div key={week.weekKey}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-wide">{week.label}</span>
                          <div className="flex-1 h-px bg-slate-100 dark:bg-slate-700" />
                          <span className="text-[8px] font-bold text-slate-300">{week.events.length} av.</span>
                        </div>
                        <div className={`grid gap-2 ${cardsPerRow >= 3 ? 'grid-cols-3 max-sm:grid-cols-2' : ''}`} style={cardsPerRow < 3 ? { gridTemplateColumns: `repeat(${cardsPerRow}, minmax(0, 1fr))` } : {}}>
                          {week.events.map(renderCard)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* ── One flat grid for the whole month ── */
                  <div className={`grid gap-2 ${cardsPerRow >= 3 ? 'grid-cols-3 max-sm:grid-cols-2' : ''}`} style={cardsPerRow < 3 ? { gridTemplateColumns: `repeat(${cardsPerRow}, minmax(0, 1fr))` } : {}}>
                    {allMonthEvents.map(renderCard)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add / Edit Modal ── */}
      {
        isAdding && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 w-full max-w-lg shadow-2xl animate-in zoom-in-95 max-h-[95vh] flex flex-col">
              <div className="flex justify-between items-center mb-4 shrink-0 gap-2">
                <h3 className="text-base font-black uppercase truncate">{newEvent.id ? 'Editar Avaliação' : 'Agendar Avaliação'}</h3>
                <div className="flex items-center gap-2 shrink-0">
                  {newEvent.id && (
                    deletingEventId === newEvent.id ? (
                      <div className="flex items-center gap-1 mr-2">
                        <span className="text-[10px] text-red-500 font-bold uppercase mr-1">Excluir?</span>
                        <button onClick={handleDeleteEvent} className="bg-red-500 text-white px-2 py-1 rounded text-[10px] font-bold">Sim</button>
                        <button onClick={() => setDeletingEventId(null)} className="bg-slate-200 text-slate-600 px-2 py-1 rounded text-[10px] font-bold">Não</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeletingEventId(newEvent.id!)} className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-all" title="Excluir">
                        <Trash2 size={16} />
                      </button>
                    )
                  )}
                  <button onClick={() => { setIsAdding(false); setDeletingEventId(null); }} className="text-slate-400 hover:text-slate-600 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 p-1.5 rounded-full transition-colors"><X size={16} /></button>
                </div>
              </div>

              <div className="overflow-y-auto flex-1 pr-1 pb-1 custom-scrollbar">
                <div className="space-y-3">
                  {/* Type */}
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setNewEvent({ ...newEvent, type: 'test' })} className={`py-2.5 rounded-lg font-black uppercase text-[9px] tracking-tight border-2 transition-all ${newEvent.type === 'test' ? 'bg-red-50 border-red-500 text-red-600 shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>Prova</button>
                    <button onClick={() => setNewEvent({ ...newEvent, type: 'work' })} className={`py-2.5 rounded-lg font-black uppercase text-[9px] tracking-tight border-2 transition-all ${newEvent.type === 'work' ? 'bg-blue-50 border-blue-500 text-blue-600 shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>Trabalho</button>
                  </div>

                  {/* Title */}
                  <div>
                    <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Assunto / Título</label>
                    <input type="text" value={newEvent.title} onChange={e => setNewEvent(prev => ({ ...prev, title: e.target.value }))} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-4 py-2.5 font-bold dark:text-white text-sm" placeholder="Ex: Prova Mensal de História" />
                  </div>

                  {/* School + Class */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Escola</label>
                      <select value={newEvent.schoolId} onChange={e => setNewEvent(prev => ({ ...prev, schoolId: e.target.value, classId: '', slotId: '' }))} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2.5 font-bold dark:text-white text-sm">
                        {(data.schools || []).filter(s => !s.deleted).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Turma</label>
                      <select value={newEvent.classId} onChange={e => handleClassChange(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2.5 font-bold dark:text-white text-sm" disabled={!activeSchool}>
                        <option value="">Selecione...</option>
                        {(activeSchool?.classes || []).filter(c => typeof c === 'string' || !c.deleted).sort((a, b) => (typeof a === 'string' ? a : a.name).localeCompare(typeof b === 'string' ? b : b.name)).map(c => {
                          const cId = typeof c === 'string' ? c : c.id;
                          const cName = typeof c === 'string' ? c : c.name;
                          return <option key={cId} value={cId}>{cName}</option>;
                        })}
                      </select>
                    </div>
                  </div>

                  {/* Date + Slot */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Data</label>
                      <input type="date" value={newEvent.date} onChange={e => handleDateChange(e.target.value)} className={`w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2.5 font-bold dark:text-white text-sm ${isInvalidDate ? 'ring-2 ring-pink-500' : ''}`} />
                      {dateWarning && <p className="text-[8px] text-pink-600 font-black uppercase mt-0.5 ml-1">{dateWarning}</p>}
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Horário (Slot)</label>
                      <select disabled={!newEvent.classId || isInvalidDate} value={newEvent.slotId} onChange={e => setNewEvent(prev => ({ ...prev, slotId: e.target.value }))} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2.5 font-bold dark:text-white disabled:opacity-50 text-sm">
                        <option value="">{restrictedAvailableSlots.length > 0 ? 'Escolha o horário...' : (newEvent.classId ? 'Nenhum horário' : 'Selecione a turma')}</option>
                        {restrictedAvailableSlots.map(s => <option key={s.id} value={s.id}>{s.label} ({s.startTime})</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Descrição / Observações</label>
                    <textarea value={newEvent.description} onChange={e => setNewEvent(prev => ({ ...prev, description: e.target.value }))} rows={2} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-4 py-2.5 font-bold dark:text-white text-sm resize-none" placeholder="Capítulos, observações..." />
                  </div>
                </div>

                {/* ── Inline Copy Accordion ── */}
                <div className="border-t border-slate-100 dark:border-slate-800 pt-3 mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !isCopyOpen;
                      setIsCopyOpen(next);
                      if (next) {
                        setCopySuccess(false);
                        setCopyData({
                          targetSchoolId: newEvent.schoolId || data.schools[0]?.id || '',
                          targetDate: newEvent.date || '',
                          targetClassId: '',
                          targetSlotId: '',
                        });
                      }
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-tight transition-all ${isCopyOpen
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-blue-500 hover:bg-blue-50'
                      }`}
                  >
                    <span className="flex items-center gap-2"><Copy size={12} /> Criar Cópia (Replicar Avaliação)</span>
                    <ChevronDown size={12} className={`transition-transform ${isCopyOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isCopyOpen && (
                    <div className="mt-3 space-y-3 animate-in slide-in-from-top-2 duration-200">
                      {copySuccess && (
                        <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-3 py-2 rounded-lg">
                          <CheckCircle2 size={14} className="shrink-0 animate-in zoom-in-50" />
                          <span className="text-[9px] font-black uppercase">Cópia criada com sucesso!</span>
                        </div>
                      )}

                      {(data.schools || []).filter(s => !s.deleted).length > 1 && (
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Escola de Destino</label>
                          <select
                            value={copyData.targetSchoolId}
                            onChange={e => setCopyData(prev => ({ ...prev, targetSchoolId: e.target.value, targetClassId: '', targetSlotId: '' }))}
                            className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold dark:text-white"
                          >
                            {(data.schools || []).filter(s => !s.deleted).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                      )}

                      <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Para qual turma?</label>
                        <select
                          value={copyData.targetClassId}
                          onChange={e => setCopyData(prev => ({ ...prev, targetClassId: e.target.value, targetSlotId: '' }))}
                          className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold dark:text-white"
                        >
                          <option value="">Selecione a turma...</option>
                          {(copyTargetSchool?.classes || []).filter(c => typeof c === 'string' || !c.deleted)
                            .sort((a, b) => (typeof a === 'string' ? a : a.name).localeCompare(typeof b === 'string' ? b : b.name))
                            .map(c => {
                              const cId = typeof c === 'string' ? c : c.id;
                              const cName = typeof c === 'string' ? c : c.name;
                              return <option key={cId} value={cId}>{cName}</option>;
                            })}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Para qual dia?</label>
                        <input
                          type="date"
                          value={copyData.targetDate}
                          onChange={e => setCopyData(prev => ({ ...prev, targetDate: e.target.value, targetSlotId: '' }))}
                          className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Horário (Slot)</label>
                        <select
                          value={copyData.targetSlotId}
                          onChange={e => setCopyData(prev => ({ ...prev, targetSlotId: e.target.value }))}
                          disabled={!copyData.targetDate || !copyData.targetClassId}
                          className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold dark:text-white disabled:opacity-50"
                        >
                          <option value="">
                            {availableSlotsForCopy.length > 0
                              ? 'Selecione o horário...'
                              : (copyData.targetClassId && copyData.targetDate ? 'Nenhum horário disponível' : 'Aguardando seleção...')}
                          </option>
                          {availableSlotsForCopy.map(s => <option key={s.id} value={s.id}>{s.label} ({s.startTime})</option>)}
                        </select>
                      </div>

                      {isCopyOutOfClassDay && (
                        <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 p-2.5 rounded-lg text-[10px] font-bold uppercase mb-2">
                          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                          <span className="leading-tight text-left">A data selecionada não é um dia de aula regular da turma! A cópia será criada assim mesmo.</span>
                        </div>
                      )}
                      <button
                        onClick={handleCopyAssessment}
                        disabled={!copyData.targetSlotId || !newEvent.title}
                        className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-black uppercase text-[9px] tracking-tight shadow-lg shadow-blue-100 hover:brightness-110 disabled:opacity-50 disabled:shadow-none transition-all flex items-center justify-center gap-2"
                      >
                        <Copy size={12} /> Salvar Cópia
                      </button>
                    </div>
                  )}
                </div>

              </div>

              <div className="mt-4 flex flex-col gap-3 shrink-0 pt-3 border-t border-slate-100 dark:border-slate-800">
                {isOutOfClassDay && (
                  <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 p-2.5 rounded-lg text-[10px] font-bold uppercase">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span className="leading-tight text-left">A data selecionada não é um dia de aula regular da turma! A avaliação será agendada assim mesmo.</span>
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => { setIsAdding(false); setIsCopyOpen(false); }} className="flex-1 py-3 font-black text-slate-400 uppercase text-[9px]">Cancelar</button>
                  <button
                    onClick={handleSaveEvent}
                    disabled={!newEvent.title || !newEvent.slotId || isInvalidDate}
                    className={`flex-1 py-3 rounded-lg font-black uppercase text-[9px] tracking-tight transition-all duration-300 flex items-center justify-center gap-2
                  ${saveSuccess
                        ? 'bg-green-500 text-white shadow-lg shadow-green-200 scale-105'
                        : (!newEvent.title || !newEvent.slotId || isInvalidDate)
                          ? 'bg-slate-100 text-slate-300'
                          : 'bg-blue-600 text-white shadow-xl shadow-blue-100 hover:brightness-110'
                      }`}
                  >
                    {saveSuccess ? (<><CheckCircle2 size={14} className="animate-in zoom-in-50 duration-300" /> Salvo!</>) : 'Salvar Avaliação'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

    </div>
  );
};

export default AssessmentManagement;
