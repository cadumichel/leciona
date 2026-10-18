import React, { useState, useMemo, useEffect } from 'react';
import { AppData, SchoolEvent, TimeSlot, LessonLog, AcademicCalendar, Term } from '../types';
import {
  FileCheck, Calendar, Trash2, Plus, X, Copy, CheckCircle2, Pencil,
  School as SchoolIcon, Search, ChevronRight, ChevronDown, SlidersHorizontal,
  Clock, AlertTriangle, CheckCheck, BookOpen
} from 'lucide-react';
import { isHoliday, getHolidayName, getDayOfWeekFromDate, getSafeDate, toSafeISO } from '../utils';
import { getSchedulesForDate } from '../utils/schedule';
import { DisconnectedNotice } from './ConnectionWarnings';
import {
  KIND_LABELS, buildRecovery, checkAssessmentDate, linkedAssessments, nextLessonDate, parentCandidates,
  recoveryPolicyOf, secondCallModeOf, suggestRecovery, termRecoveryContent
} from '../utils/recovery';

interface AssessmentManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
  /** Conta Google desconectada: mostra o aviso na janela de cadastro */
  disconnected?: boolean;
  onConnect?: () => void;
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
  return d.toLocaleDateString('en-CA');
}

// Return the Friday (YYYY-MM-DD) of the week starting on mondayStr
function getFridayOfWeek(mondayStr: string): string {
  const d = new Date(mondayStr + 'T12:00:00');
  d.setDate(d.getDate() + 4);
  return d.toLocaleDateString('en-CA');
}

function fmtShort(dateStr: string): string {
  return getSafeDate(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// ─── Component ───────────────────────────────────────────────────────────────

const AssessmentManagement: React.FC<AssessmentManagementProps> = ({ data, onUpdateData, disconnected, onConnect }) => {

  // ── Modal State ──────────────────────────────────────────────────────────
  const [isAdding, setIsAdding] = useState(false);
  const [newEvent, setNewEvent] = useState<Partial<SchoolEvent>>({
    type: 'test', title: '', date: new Date().toLocaleDateString('en-CA'),
    schoolId: '', classId: '', slotId: '', description: ''
  });
  // Recuperação e 2ª chamada (utils/recovery.ts)
  const [formKind, setFormKind] = useState<'regular' | 'recovery' | 'term_recovery' | 'second_call'>('regular');
  const [createRec, setCreateRec] = useState(true);
  const [recDate, setRecDate] = useState('');
  const [recSlotId, setRecSlotId] = useState('');
  const [descTouched, setDescTouched] = useState(false);
  const [dateWarning, setDateWarning] = useState('');
  const [isInvalidDate, setIsInvalidDate] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Filter State ─────────────────────────────────────────────────────────
  const [filterSchoolId, setFilterSchoolId] = useState('all');
  const [filterClassId, setFilterClassId] = useState('all');
  const [filterTermIdx, setFilterTermIdx] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'scheduled' | 'done'>('scheduled');
  const [searchQuery, setSearchQuery] = useState('');

  // ── Layout/Grouping State ────────────────────────────────────────────────
  const [cardsPerRow, setCardsPerRow] = useState(4);
  const [groupByWeek, setGroupByWeek] = useState(true);

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

  // ── Recuperação: regra da escola e sugestões ──────────────────────────────
  const recoveryPolicy = recoveryPolicyOf(activeSchool);
  const secondCallOffSchedule = formKind === 'second_call' && secondCallModeOf(activeSchool) === 'off_schedule';
  const offerRec = !newEvent.id && formKind === 'regular' && newEvent.type === 'test' && recoveryPolicy === 'parallel';
  const recCheck = useMemo(() => {
    if (!offerRec || !createRec || !activeSchool || !newEvent.classId || !recDate) return null;
    return checkAssessmentDate(data, activeSchool, newEvent.classId, recDate);
  }, [offerRec, createRec, activeSchool, newEvent.classId, recDate, data]);
  const recSuggestion = useMemo(() => {
    if (!offerRec || !activeSchool || !newEvent.classId || !newEvent.date) return null;
    return suggestRecovery(data, activeSchool, newEvent.classId, newEvent.date);
  }, [offerRec, activeSchool, newEvent.classId, newEvent.date, data]);

  // Data sugerida da REC acompanha a data da prova (o professor confirma ou troca)
  useEffect(() => {
    if (recSuggestion) { setRecDate(recSuggestion.date); setRecSlotId(''); }
  }, [recSuggestion?.date]);
  // Aula da REC: a mesma da prova, se a turma tiver aula nesse horário; senão a primeira do dia
  useEffect(() => {
    if (!recCheck) return;
    if (recCheck.lessons.some(l => l.id === recSlotId)) return;
    const same = recCheck.lessons.find(l => l.id === newEvent.slotId);
    setRecSlotId(same ? same.id : (recCheck.lessons[0]?.id || ''));
  }, [recCheck, newEvent.slotId]);

  // REC trimestral: conteúdo das provas do trimestre (enquanto o professor não editar a descrição)
  useEffect(() => {
    if (formKind !== 'term_recovery' || descTouched || !newEvent.schoolId || !newEvent.classId || !newEvent.date) return;
    const content = termRecoveryContent(data, newEvent.schoolId, newEvent.classId, newEvent.date);
    setNewEvent(prev => ({ ...prev, description: content }));
  }, [formKind, descTouched, newEvent.schoolId, newEvent.classId, newEvent.date, data.events]);

  const secondCallOptions = useMemo(
    () => (formKind === 'second_call' && newEvent.schoolId && newEvent.classId ? parentCandidates(data, newEvent.schoolId, newEvent.classId) : []),
    [formKind, newEvent.schoolId, newEvent.classId, data]
  );

  const chooseSecondCallParent = (parentId: string) => {
    const parent = data.events.find(e => e.id === parentId);
    setNewEvent(prev => ({
      ...prev, parentId,
      title: parent ? `2ª chamada — ${parent.title}` : prev.title,
      description: parent?.description || '',
      type: parent?.type || prev.type
    }));
  };

  // Pode salvar? (a 2ª chamada no contraturno não tem aula; a 2ª chamada precisa da avaliação original)
  const canSave = !!newEvent.title && !!newEvent.classId && !isInvalidDate &&
    (secondCallOffSchedule || !!newEvent.slotId) &&
    (formKind !== 'second_call' || !!newEvent.parentId);

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
    const needsSlot = !secondCallOffSchedule;
    if (!newEvent.title || !newEvent.classId || (needsSlot && !newEvent.slotId) || isInvalidDate) return;
    if (formKind === 'second_call' && !newEvent.parentId) return;
    const safeDateISO = toSafeISO(newEvent.date!);
    const eventId = newEvent.id || crypto.randomUUID();
    let currentLogs = [...data.logs];
    let currentEvents = [...data.events];
    if (newEvent.id) {
      const orig = data.events.find(e => e.id === newEvent.id);
      if (orig) {
        currentEvents = currentEvents.filter(e => e.id !== newEvent.id);
        currentLogs = currentLogs.filter(l => !(l.date.split('T')[0] === orig.date.split('T')[0] && l.schoolId === orig.schoolId && l.slotId === orig.slotId));
      }
    }
    // Ao editar, mantém o que não está no formulário (situação, peso, nota máxima, ligações)
    const original = newEvent.id ? data.events.find(e => e.id === newEvent.id) : undefined;
    const kind = formKind === 'regular' ? undefined : formKind;
    const event: SchoolEvent = {
      ...(original || {}),
      id: eventId, title: newEvent.title!, date: safeDateISO,
      schoolId: newEvent.schoolId!, classId: newEvent.classId!,
      type: newEvent.type as 'test' | 'work', description: newEvent.description || '', blocksClasses: false
    } as SchoolEvent;
    if (needsSlot && newEvent.slotId) event.slotId = newEvent.slotId; else delete event.slotId;
    if (kind) event.kind = kind; else delete event.kind;
    if ((kind === 'second_call' || kind === 'recovery') && newEvent.parentId) event.parentId = newEvent.parentId;
    else delete event.parentId;

    const newEvents: SchoolEvent[] = [event];
    if (event.slotId) {
      currentLogs = currentLogs.filter(l =>
        !(l.date.split('T')[0] === newEvent.date && l.schoolId === event.schoolId && l.slotId === event.slotId)
      );
      currentLogs.push({
        id: crypto.randomUUID(), date: safeDateISO, schoolId: event.schoolId,
        classId: event.classId!, slotId: event.slotId,
        subject: `Avaliação: ${event.title}`, homework: '', notes: event.description || ''
      });
    }

    // REC paralela criada junto com a prova (só no cadastro novo)
    if (offerRec && createRec && recDate && recSlotId) {
      const rec = buildRecovery(event, recDate, recSlotId, crypto.randomUUID());
      newEvents.push(rec);
      const hasLog = currentLogs.some(l => l.date.split('T')[0] === recDate && l.schoolId === rec.schoolId && l.slotId === recSlotId);
      if (!hasLog) {
        currentLogs.push({
          id: crypto.randomUUID(), date: rec.date, schoolId: rec.schoolId, classId: rec.classId!, slotId: recSlotId,
          subject: `Avaliação: ${rec.title}`, homework: '', notes: rec.description || ''
        });
      }
    }
    onUpdateData({ events: [...currentEvents, ...newEvents], logs: currentLogs });
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

    // A REC e a 2ª chamada ligadas a esta avaliação saem junto
    const removed = [event, ...linkedAssessments(data.events, eventId)];
    const removedIds = new Set(removed.map(e => e.id));
    const currentEvents = data.events.filter(e => !removedIds.has(e.id));
    const currentGrades = data.grades.filter(g => !removedIds.has(g.assessmentId));

    // Remover o registro de diário (LessonLog) que foi gerado automaticamente para cada avaliação
    const currentLogs = data.logs.filter(l => !removed.some(e =>
      e.slotId && l.date.split('T')[0] === e.date.split('T')[0] && l.schoolId === e.schoolId && l.slotId === e.slotId && l.subject.startsWith('Avaliação:')
    ));

    onUpdateData({ events: currentEvents, grades: currentGrades, logs: currentLogs });
    setDeletingEventId(null);
    setIsAdding(false);
  };

  // ── Copy ──────────────────────────────────────────────────────────────────
  const handleCopyAssessment = () => {
    if (!newEvent.title || !copyData.targetDate || !copyData.targetClassId || !copyData.targetSlotId) return;
    const safeDateISO = toSafeISO(copyData.targetDate);
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
  const today = new Date().toLocaleDateString('en-CA');

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
      const weekKey = getMondayOfWeek(e.date.split('T')[0]);
      
      // A semana toda pertencerá ao mês em que a segunda-feira inicia
      const monthKey = getMonthKey(weekKey);
      
      let month = months.find(m => m.key === monthKey);
      if (!month) { 
        month = { key: monthKey, label: formatMonthHeader(weekKey), weeks: [] }; 
        months.push(month); 
      }

      let week = month.weeks.find(w => w.weekKey === weekKey);
      if (!week) {
        if (!weekSeq.has(weekKey)) { weekSeq.set(weekKey, ++weekCounter); }
        const fridayStr = getFridayOfWeek(weekKey);
        
        let label = `Semana ${weekSeq.get(weekKey)}: ${fmtShort(weekKey)} a ${fmtShort(fridayStr)}`;
        
        // Verifica se a semana divide meses
        const startMonthName = getSafeDate(weekKey).toLocaleDateString('pt-BR', { month: 'long' });
        const endMonthName = getSafeDate(fridayStr).toLocaleDateString('pt-BR', { month: 'long' });
        
        if (startMonthName !== endMonthName) {
           label += ` - Obs: Início da semana em ${startMonthName} e fim da semana em ${endMonthName}!`;
        }
        
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
      type: 'test', title: '', date: new Date().toLocaleDateString('en-CA'),
      schoolId: (data.schools || [])[0]?.id || '', classId: '', slotId: '', description: ''
    });
    setDateWarning(''); setIsInvalidDate(false);
    setFormKind('regular'); setCreateRec(true); setRecDate(''); setRecSlotId(''); setDescTouched(false);
    setIsAdding(true);
  };

  const openEditForm = (event: SchoolEvent) => {
    setSaveSuccess(false);
    setNewEvent({
      id: event.id, title: event.title, date: event.date.split('T')[0],
      schoolId: event.schoolId, classId: event.classId, slotId: event.slotId,
      type: event.type, description: event.description, parentId: event.parentId
    });
    setDateWarning(''); setIsInvalidDate(false);
    setFormKind(event.kind || 'regular');
    setCreateRec(false); setDescTouched(true);
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
        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-slate-100 dark:border-slate-800">
          {/* Cards per row */}
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-tight shrink-0">Cards/linha:</span>
            <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-1">
              {[1, 2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  onClick={() => setCardsPerRow(n)}
                  className={`w-6 h-6 flex-shrink-0 flex items-center justify-center rounded text-[9px] font-black transition-all ${n > 3 ? 'max-sm:hidden ' : ''
                    }${cardsPerRow === n
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
                  className={`relative rounded-xl border shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer group overflow-hidden flex flex-col ${event.prepared
                    ? 'bg-emerald-100 border-emerald-300 dark:bg-emerald-900/40 dark:border-emerald-700'
                    : event.scheduled
                      ? 'bg-orange-100 border-orange-300 dark:bg-orange-900/40 dark:border-orange-700'
                      : 'bg-white border-slate-100 dark:bg-slate-900 dark:border-slate-800'
                    }`}
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
                        {event.kind && (
                          <span className="text-[7px] font-black px-1.5 py-0.5 rounded uppercase shrink-0 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
                            {KIND_LABELS[event.kind]}
                          </span>
                        )}
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
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-tight mt-0.5">
                          {shiftInfo.shiftName.toUpperCase().startsWith('MAT') ? 'MAT' :
                           shiftInfo.shiftName.toUpperCase().startsWith('VES') ? 'VESP' :
                           shiftInfo.shiftName.toUpperCase().startsWith('NOT') ? 'NOT' :
                           shiftInfo.shiftName}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Removed Action Buttons */}

                  {/* Bottom strip: school name + status badge + optional description */}
                  <div className="border-t border-slate-50 dark:border-slate-800 px-3 py-1.5 flex items-center gap-2">
                    <span className="data-[compact=true]:text-[7px] text-[9px] font-black truncate max-w-[50%]" style={{ color }}>{school?.name}</span>
                    <div className="flex-1" />

                    {/* Status Dropdown */}
                    <div className="flex items-center z-10" onClick={e => e.stopPropagation()}>
                       <select
                         value={event.prepared ? 'ready' : event.scheduled ? 'scheduled' : 'pending'}
                         onChange={(e) => {
                            const val = e.target.value;
                            const updatedEvents = data.events.map(ev =>
                               ev.id === event.id ? {
                                  ...ev,
                                  prepared: val === 'ready',
                                  scheduled: val === 'scheduled'
                               } : ev
                            );
                            onUpdateData({ events: updatedEvents });
                         }}
                         className={`text-[9px] font-bold uppercase tracking-tight outline-none border rounded-lg px-2 py-1 cursor-pointer transition-colors max-md:appearance-none text-center min-w-[70px] ${
                            event.prepared ? 'bg-emerald-500 border-emerald-600 text-white' :
                            event.scheduled ? 'bg-orange-500 border-orange-600 text-white' :
                            'bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
                         }`}
                       >
                         <option value="pending">Pendente</option>
                         <option value="scheduled">Agendada</option>
                         <option value="ready">Pronta</option>
                       </select>
                    </div>

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
                        <div className={`grid gap-2 ${cardsPerRow === 1 ? 'grid-cols-1' : cardsPerRow === 2 ? 'grid-cols-2' : cardsPerRow === 3 ? 'grid-cols-3' : cardsPerRow === 4 ? 'grid-cols-4' : cardsPerRow === 5 ? 'grid-cols-5' : 'grid-cols-6'} ${cardsPerRow >= 3 ? 'max-sm:grid-cols-2' : ''}`}>
                          {week.events.map(renderCard)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* ── One flat grid for the whole month ── */
                  <div className={`grid gap-2 ${cardsPerRow === 1 ? 'grid-cols-1' : cardsPerRow === 2 ? 'grid-cols-2' : cardsPerRow === 3 ? 'grid-cols-3' : cardsPerRow === 4 ? 'grid-cols-4' : cardsPerRow === 5 ? 'grid-cols-5' : 'grid-cols-6'} ${cardsPerRow >= 3 ? 'max-sm:grid-cols-2' : ''}`}>
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
                {disconnected && <DisconnectedNotice onConnect={onConnect} />}
                <div className="space-y-3">
                  {/* Type */}
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setNewEvent({ ...newEvent, type: 'test' })} className={`py-2.5 rounded-lg font-black uppercase text-[9px] tracking-tight border-2 transition-all ${newEvent.type === 'test' ? 'bg-red-50 border-red-500 text-red-600 shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>Prova</button>
                    <button onClick={() => setNewEvent({ ...newEvent, type: 'work' })} className={`py-2.5 rounded-lg font-black uppercase text-[9px] tracking-tight border-2 transition-all ${newEvent.type === 'work' ? 'bg-blue-50 border-blue-500 text-blue-600 shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>Trabalho</button>
                  </div>

                  {/* Recuperação / 2ª chamada */}
                  {newEvent.id ? (
                    formKind !== 'regular' && (
                      <p className="text-[9px] font-black uppercase text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg px-3 py-2">
                        {KIND_LABELS[formKind]}{newEvent.parentId && ` — ligada a "${data.events.find(e => e.id === newEvent.parentId)?.title || 'avaliação apagada'}"`}
                      </p>
                    )
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {([['regular', 'Regular'], ['term_recovery', 'REC trimestral'], ['second_call', '2ª chamada']] as const).map(([k, label]) => (
                        <button key={k} type="button"
                          onClick={() => {
                            setFormKind(k); setDescTouched(false);
                            setNewEvent(prev => ({ ...prev, parentId: undefined, description: '', title: k === 'term_recovery' ? 'REC trimestral' : (k === 'regular' ? '' : prev.title) }));
                          }}
                          className={`py-2 rounded-lg font-black uppercase text-[8px] tracking-tight border-2 transition-all ${formKind === k ? 'bg-indigo-50 border-indigo-500 text-indigo-600' : 'bg-slate-50 dark:bg-slate-800 border-transparent text-slate-400'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

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

                  {formKind === 'second_call' && !newEvent.id && (
                    <div>
                      <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Avaliação original</label>
                      <select value={newEvent.parentId || ''} onChange={e => chooseSecondCallParent(e.target.value)} disabled={!newEvent.classId}
                        className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2.5 font-bold dark:text-white text-sm disabled:opacity-50">
                        <option value="">{newEvent.classId ? (secondCallOptions.length ? 'Escolha a avaliação...' : 'Nenhuma avaliação dessa turma') : 'Selecione a turma'}</option>
                        {secondCallOptions.map(e => <option key={e.id} value={e.id}>{e.title} ({e.date.split('T')[0].split('-').reverse().slice(0, 2).join('/')})</option>)}
                      </select>
                      <p className="text-[8px] text-slate-400 font-bold mt-1 ml-1">O título e o conteúdo vêm da avaliação original.</p>
                    </div>
                  )}

                  {/* Date + Slot */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Data</label>
                      <input type="date" value={newEvent.date} onChange={e => handleDateChange(e.target.value)} className={`w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2.5 font-bold dark:text-white text-sm ${isInvalidDate ? 'ring-2 ring-pink-500' : ''}`} />
                      {dateWarning && <p className="text-[8px] text-pink-600 font-black uppercase mt-0.5 ml-1">{dateWarning}</p>}
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Horário (Slot)</label>
                      {secondCallOffSchedule ? (
                        <p className="text-[9px] font-bold text-slate-500 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2.5">Contraturno: fora das suas aulas (sem registro no diário)</p>
                      ) : (
                      <select disabled={!newEvent.classId || isInvalidDate} value={newEvent.slotId} onChange={e => setNewEvent(prev => ({ ...prev, slotId: e.target.value }))} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2.5 font-bold dark:text-white disabled:opacity-50 text-sm">
                        <option value="">{restrictedAvailableSlots.length > 0 ? 'Escolha o horário...' : (newEvent.classId ? 'Nenhum horário' : 'Selecione a turma')}</option>
                        {restrictedAvailableSlots.map(s => <option key={s.id} value={s.id}>{s.label} ({s.startTime})</option>)}
                      </select>
                      )}
                    </div>
                  </div>

                  {/* REC paralela automática */}
                  {offerRec && (
                    <div className="rounded-xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-900/10 p-3 space-y-2">
                      <label className="flex items-center gap-2 text-[10px] font-black uppercase text-indigo-700 dark:text-indigo-300 cursor-pointer">
                        <input type="checkbox" checked={createRec} onChange={e => setCreateRec(e.target.checked)} className="accent-indigo-600" />
                        Criar a recuperação (REC) automaticamente
                      </label>
                      {createRec && (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Data da REC</label>
                              <input type="date" value={recDate} onChange={e => { setRecDate(e.target.value); setRecSlotId(''); }}
                                className={`w-full bg-white dark:bg-slate-800 border-none rounded-lg px-3 py-2 font-bold dark:text-white text-sm ${recCheck?.blocked ? 'ring-2 ring-pink-500' : ''}`} />
                            </div>
                            <div>
                              <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Aula da REC</label>
                              <select value={recSlotId} onChange={e => setRecSlotId(e.target.value)} disabled={!recCheck?.lessons.length}
                                className="w-full bg-white dark:bg-slate-800 border-none rounded-lg px-3 py-2 font-bold dark:text-white text-sm disabled:opacity-50">
                                <option value="">{recCheck?.lessons.length ? 'Escolha a aula...' : 'Sem aula nesse dia'}</option>
                                {(recCheck?.lessons || []).map(s => <option key={s.id} value={s.id}>{s.label} ({s.startTime})</option>)}
                              </select>
                            </div>
                          </div>
                          {recCheck && recCheck.warnings.length > 0 && (
                            <ul className="text-[9px] font-bold text-amber-700 dark:text-amber-300 space-y-0.5 ml-1">
                              {recCheck.warnings.map(w => <li key={w}>⚠️ {w}</li>)}
                            </ul>
                          )}
                          {recCheck && (recCheck.blocked || !recCheck.lessons.length) && activeSchool && newEvent.classId && (() => {
                            const next = nextLessonDate(data, activeSchool, newEvent.classId, recDate);
                            return next && next !== recDate ? (
                              <button type="button" onClick={() => { setRecDate(next); setRecSlotId(''); }}
                                className="text-[9px] font-black uppercase text-indigo-600 underline ml-1">
                                Usar a próxima aula da turma: {next.split('-').reverse().join('/')}
                              </button>
                            ) : null;
                          })()}
                          {!recSlotId && <p className="text-[8px] font-bold text-slate-400 ml-1">Sem aula escolhida, a REC não é criada.</p>}
                        </>
                      )}
                    </div>
                  )}

                  {/* Description */}
                  <div>
                    <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Descrição / Observações</label>
                    <textarea value={newEvent.description} onChange={e => { setDescTouched(true); setNewEvent(prev => ({ ...prev, description: e.target.value })); }} rows={2} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-4 py-2.5 font-bold dark:text-white text-sm resize-none" placeholder="Capítulos, observações..." />
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
                    disabled={!canSave}
                    className={`flex-1 py-3 rounded-lg font-black uppercase text-[9px] tracking-tight transition-all duration-300 flex items-center justify-center gap-2
                  ${saveSuccess
                        ? 'bg-green-500 text-white shadow-lg shadow-green-200 scale-105'
                        : (!canSave)
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
