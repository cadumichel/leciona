import React, { useState, useMemo, useEffect } from 'react';
import { AppData, LessonLog, ScheduleEntry, TimeSlot, School, DayOfWeek, Student, Term, Occurrence, StudentAttendance } from '../types';
import {
  History,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Clock,
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
  BookOpen,
  ClipboardCheck,
  X,

  RotateCcw,
  BarChart2,
  LayoutList,
  Loader2,
  ArrowUpNarrowWide,
  ArrowDownWideNarrow,
  Edit3
} from 'lucide-react';
import { DAYS_OF_WEEK_NAMES } from '../constants';
import { parseTimeToMinutes, getCurrentTimeInMinutes, getHolidayName, isHoliday, getDayOfWeekFromDate, getCurrentDate } from '../utils';
import { getSchedulesForDate } from '../utils/schedule';
import { getLessonDisplayItems, deriveStatsFromLessons, LessonDisplayItem } from '../utils/lessonStats';
import { sanitizeText, LIMITS } from '../utils/validation';
import { useToast } from '../hooks/useToast';

interface LessonLoggerProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
  initialLessonData?: { schedule: ScheduleEntry; date: string } | null;
  onClearInitialLesson: () => void;
  defaultShowPendencies?: boolean;
  onClearShowPendencies?: () => void;
}

type ViewMode = 'day' | 'registered' | 'future';
type FutureViewType = 'calendar' | 'list';
type HistoryViewType = 'list' | 'calendar';

const OCCURRENCE_TYPES = [
  "Sem Tarefa",
  "Sem trabalho",
  "Participação",
  "Brincadeira em sala",
  "Desrespeito",
  "Outros"
];

interface EditableContentFieldProps {
  initialValue: string;
  onSave: (newValue: string, contextId?: string) => Promise<string | void>;
  isBulkEditing: boolean;
  isPlaceholder?: boolean;
}

const EditableContentField: React.FC<EditableContentFieldProps> = ({ initialValue, onSave, isBulkEditing, isPlaceholder }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  // Store the ID of the created/updated log to handle subsequent edits (e.g. create -> update)
  const [savedContext, setSavedContext] = useState<{ id: string } | null>(null);

  // Update local value if prop changes (e.g. external refresh)
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleSave = async () => {
    // Basic check: if value hasn't changed AND we don't have a pending "newly created" context to rely on, skip.
    // However, if we JUST created a log (savedContext exists) and we edit again, we want to ensure we pass that ID.
    if (value === initialValue && !isEditing && !savedContext) {
      setIsEditing(false);
      return;
    }

    setSaveStatus('saving');
    try {
      // Pass the savedContext ID if available to force an update instead of create
      const result = await onSave(value, savedContext?.id);

      // If the save returns an ID (meaning a log was created/updated), store it.
      if (result && typeof result === 'string') {
        setSavedContext({ id: result });
      }

      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error("Failed to save:", error);
      setSaveStatus('error');
    }

    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // Stop event from bubbling to parent card
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // Prevent newline, trigger save
      e.currentTarget.blur();
    }
  };

  const showEditor = isEditing || isBulkEditing;

  if (showEditor) {
    return (
      <div
        className="relative w-full"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()} // Stop bubbling for all keys at container level
        onKeyUp={(e) => e.stopPropagation()}
        onKeyPress={(e) => e.stopPropagation()}
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleSave}
          autoFocus={!isBulkEditing} // Only autofocus if clicked specifically
          className={`w-full bg-white dark:bg-slate-800 border-2 rounded-xl p-2 text-[10px] md:text-xs font-bold dark:text-white outline-none resize-none transition-all ${saveStatus === 'error' ? 'border-red-300 focus:border-red-500' : 'border-blue-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100'}`}
          rows={isBulkEditing ? 3 : 2}
          placeholder="O que foi trabalhado?"

          // Event Stopping Handlers - Applied directly to textarea per user request
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            handleKeyDown(e);
          }}
          onKeyUp={(e) => e.stopPropagation()}
          onKeyPress={(e) => e.stopPropagation()}
        />
        {saveStatus === 'saving' && (
          <div className="absolute top-2 right-2">
            <Loader2 size={12} className="animate-spin text-blue-500" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
      className="group relative cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg p-1 -m-1 transition-colors"
    >
      {saveStatus === 'success' && <div className="absolute -top-1 -right-1 text-green-500 animate-in zoom-in"><CheckCircle2 size={12} /></div>}

      {value ? (
        <p className="text-[10px] font-bold italic text-slate-600 dark:text-slate-400 truncate block w-full" style={{ whiteSpace: 'normal', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          "{value}"
        </p>
      ) : (
        <p className="text-[10px] font-bold italic text-slate-400 dark:text-slate-600 flex items-center gap-1">
          <Edit3 size={10} /> {isPlaceholder ? "Planejar aula..." : "Adicionar conteúdo..."}
        </p>
      )}

      <div className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-slate-900 rounded-full p-1 shadow-sm border border-slate-100 dark:border-slate-800 pointer-events-none">
        <Edit3 size={10} className="text-slate-400" />
      </div>
    </div>
  );
};

// Funções Utilitárias para Agrupamento por Semana
const getWeekStart = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Segunda-feira
  const weekStart = new Date(d.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
};

const formatWeekRange = (weekStartStr: string): string => {
  const start = new Date(weekStartStr + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const formatDate = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

  return `${formatDate(start)} - ${formatDate(end)}`;
};

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
  const [futureViewType, setFutureViewType] = useState<FutureViewType>('calendar');
  const [historyViewType, setHistoryViewType] = useState<HistoryViewType>('list');
  const [futureSortOrder, setFutureSortOrder] = useState<'asc' | 'desc'>('asc');
  const [historySortOrder, setHistorySortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentTime, setCurrentTime] = useState(getCurrentTimeInMinutes());

  // Security: Toast notifications
  const { showError, showSuccess } = useToast();

  const getYYYYMMDD = (date: Date) => {
    return date.toLocaleDateString('en-CA');
  };

  const [selectedDate, setSelectedDate] = useState(getYYYYMMDD(new Date()));

  // Self-Healing: Remove Duplicate Logs on Mount
  useEffect(() => {
    // Safety check ensuring data.logs exists
    if (!data.logs) return;

    const uniqueLogs = new Map<string, LessonLog>();
    const duplicates: string[] = [];
    let hasChanges = false;

    // Only check active logs
    const activeLogs = data.logs.filter(l => l.status !== 'removed');

    activeLogs.forEach(log => {
      // Key: Date + School + Slot (Defines a unique lesson slot)
      const key = `${log.date}-${log.schoolId || log.studentId}-${log.slotId}`;

      if (uniqueLogs.has(key)) {
        const existing = uniqueLogs.get(key)!;
        // DUPLICATE FOUND
        // Strategy: Keep the one with clearer content.
        const existingLen = (existing.subject || '').length;
        const currentLen = (log.subject || '').length;

        if (currentLen > existingLen) {
          // Replace existing with current (mark existing as dup)
          duplicates.push(existing.id);
          uniqueLogs.set(key, log);
        } else {
          // Keep existing, mark current as dup
          duplicates.push(log.id);
        }
        hasChanges = true;
      } else {
        uniqueLogs.set(key, log);
      }
    });

    if (hasChanges && duplicates.length > 0) {
      console.log(`[Self-Healing] Found ${duplicates.length} duplicate logs. Cleaning up...`, duplicates);
      const cleanedLogs = data.logs.filter(l => !duplicates.includes(l.id));
      onUpdateData({ logs: cleanedLogs });
      showSuccess(`Base de dados otimizada: ${duplicates.length} duplicatas removidas.`);
    }
  }, []); // Run once on mount

  const [activeLesson, setActiveLesson] = useState<{ schedule: ScheduleEntry, institution: School | Student, slot: TimeSlot, date: string, type: 'school' | 'private' } | null>(null);

  const [isExtraLessonModalOpen, setIsExtraLessonModalOpen] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [extraLessonForm, setExtraLessonForm] = useState<{
    type: 'regular' | 'extra' | 'substitution';
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

  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'loading'>('idle');
  const [showDeleteOptionsModal, setShowDeleteOptionsModal] = useState(false);

  // Column Density Control
  const [gridColumns, setGridColumns] = useState(() => {
    const saved = localStorage.getItem('leciona_grid_cols');
    return saved ? parseInt(saved) : 3;
  });

  const [showWithContent, setShowWithContent] = useState(true);
  const [showWithoutContent, setShowWithoutContent] = useState(true);

  const [showPendencies, setShowPendencies] = useState(false);
  const [isBulkEditMode, setIsBulkEditMode] = useState(false);

  // Auto-expand pendencies if requested via prop (Banner Click)
  useEffect(() => {
    if (defaultShowPendencies) {
      // NEW BEHAVIOR: Open History Tab with "Without Content" filter only
      setViewMode('registered');
      setShowWithContent(false);
      setShowWithoutContent(true);
      setShowPendencies(false); // Ensure accordion is closed if we return to day view

      if (onClearShowPendencies) onClearShowPendencies();
    }
  }, [defaultShowPendencies, onClearShowPendencies]);

  useEffect(() => {
    localStorage.setItem('leciona_grid_cols', gridColumns.toString());
  }, [gridColumns]);

  const getGridClass = (cols: number) => {
    const map: Record<number, string> = {
      // Seleção 1: 1 coluna no mobile e desktop (Modo Foco)
      1: "grid-cols-1 max-w-4xl mx-auto",

      // Seleção 2: 2 colunas JÁ no mobile (grid-cols-2 base)
      2: "grid-cols-2",

      // Seleção 3: 3 colunas JÁ no mobile (grid-cols-3 base)
      3: "grid-cols-3",

      // Seleção 4+: Mobile trava em 3 colunas (limite de legibilidade), Desktop expande
      4: "grid-cols-3 xl:grid-cols-4",
      5: "grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
      6: "grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
    };
    return map[cols] || map[3];
  };

  const DensitySelector = () => (
    <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5 mr-2">
      <select
        value={gridColumns}
        onChange={(e) => setGridColumns(Number(e.target.value))}
        className="bg-transparent text-[9px] md:text-[10px] font-black text-slate-600 dark:text-slate-300 outline-none px-1 py-1 cursor-pointer"
      >
        {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}x</option>)}
      </select>
    </div>
  );

  // Reset save status when navigating between lessons
  useEffect(() => {
    setSaveStatus('idle');
  }, [activeLesson?.schedule?.slotId, activeLesson?.date]);

  const handleAddLesson = (type: 'regular' | 'extra') => {
    if (type === 'regular') {
      setCreateRegularForm({
        date: selectedDate,
        schoolId: '',
        classId: '',
        shiftId: '',
        slotId: ''
      });
      setShowCreateRegularModal(true);
    } else {
      setExtraLessonForm(prev => ({ ...prev, type: type, date: selectedDate }));
      setIsExtraLessonModalOpen(true);
    }
  };

  const [showCreateRegularModal, setShowCreateRegularModal] = useState(false);
  const [createRegularForm, setCreateRegularForm] = useState<{
    date: string;
    schoolId: string;
    classId: string;
    shiftId: string;
    slotId: string;
  }>({ date: '', schoolId: '', classId: '', shiftId: '', slotId: '' });

  const handleCreateRegularSkeleton = () => {
    const { date, schoolId, classId, shiftId, slotId } = createRegularForm;
    if (!date || !schoolId || !classId || !shiftId || !slotId) return;

    const school = data.schools.find(s => s.id === schoolId);
    if (!school) return;

    const shift = school.shifts.find(s => s.id === shiftId);
    const slot = shift?.slots.find(s => s.id === slotId);

    if (!slot) return;

    const newLog: LessonLog = {
      id: crypto.randomUUID(),
      date: new Date(date + 'T00:00:00').toISOString(),
      schoolId: schoolId,
      classId: classId,
      slotId: slotId,
      startTime: slot.startTime || '00:00', // Ensure fallback
      endTime: slot.endTime || '00:00',     // Ensure fallback
      subject: '',
      homework: '',
      notes: '',
      occurrences: [],
      attendance: [],
      type: 'regular',
      status: 'active' // Explicitly active
    };

    onUpdateData({ logs: [...data.logs, newLog] });
    setShowCreateRegularModal(false);
    showSuccess('Aula criada com sucesso! Clique no card para editar.');
  };



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

  const [replicateLog, setReplicateLog] = useState(true);
  const [consecutiveSlots, setConsecutiveSlots] = useState<{ slotId: string, startTime: number }[]>([]);
  const [filterInstId, setFilterInstId] = useState<string>('all');
  const [filterClassId, setFilterClassId] = useState<string>('all');
  const [filterPeriodIdx, setFilterPeriodIdx] = useState<string>('all');

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(getCurrentTimeInMinutes()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Calculate the valid date range based on academic calendars
  const activeCalendarRange = useMemo(() => {
    let start: string | null = null;
    let end: string | null = null;

    if (filterInstId !== 'all') {
      const calendar = data.calendars.find(c => c.schoolId === filterInstId);
      if (calendar) {
        start = calendar.start;
        end = calendar.end;
      }
    } else {
      // If "All Institutions", find the earliest start and latest end
      const starts = data.calendars.map(c => c.start).filter(Boolean).sort();
      const ends = data.calendars.map(c => c.end).filter(Boolean).sort();

      if (starts.length > 0) start = starts[0];
      if (ends.length > 0) end = ends[ends.length - 1];
    }

    // Default to current year if no calendar found
    const currentYear = new Date().getFullYear();
    return {
      start: start || `${currentYear}-01-01`,
      end: end || `${currentYear}-12-31`
    };
  }, [data.calendars, filterInstId]);

  // Ensure initial selected date is within range
  useEffect(() => {
    if (selectedDate < activeCalendarRange.start) {
      setSelectedDate(activeCalendarRange.start);
    } else if (selectedDate > activeCalendarRange.end) {
      setSelectedDate(activeCalendarRange.end);
    }
  }, [activeCalendarRange, selectedDate]);

  const handlePrevDay = () => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    const newDate = getYYYYMMDD(d);
    if (newDate >= activeCalendarRange.start) {
      setSelectedDate(newDate);
    }
  };

  const handleNextDay = () => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const newDate = getYYYYMMDD(d);
    if (newDate <= activeCalendarRange.end) {
      setSelectedDate(newDate);
    }
  };

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
    // Nota: classId pode ser o ID da turma OU o nome da turma
    const record = data.classRecords?.find(r => {
      const schoolMatch = r.schoolId === activeLesson.institution.id;

      // Tentar match por ID exato
      if (schoolMatch && r.classId === activeLesson.schedule.classId) {
        return true;
      }

      // Tentar match por nome da turma (fallback para compatibilidade)
      // Buscar a turma na escola para verificar nome
      const school = data.schools.find(s => s.id === activeLesson.institution.id);
      if (school && schoolMatch) {
        const schoolClass = school.classes.find(c =>
          (typeof c === 'string' ? c : c.id) === r.classId ||
          (typeof c === 'string' ? c : c.name) === activeLesson.schedule.classId
        );
        if (schoolClass) {
          return true;
        }
      }

      return false;
    });

    return record ? record.students.filter(s => s.active !== false) : [];
  }, [activeLesson, data.classRecords, data.schools]);

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

    // FIX: Use version-aware schedule retrieval
    const dailySchedules = getSchedulesForDate(data, activeLesson.date);

    // Find all schedules for this class on this day
    const classSchedules = dailySchedules.filter(s =>
      Number(s.dayOfWeek) === dayOfWeek &&
      s.schoolId === schoolId &&
      s.classId === classId
    );

    let allClassLessons: { slotId: string, startTime: number }[] = [];

    classSchedules.forEach(s => {
      const shift = school.shifts.find(sh => sh.id === s.shiftId);
      const slot = shift?.slots.find(sl => sl.id === s.slotId);

      if (slot) {
        allClassLessons.push({
          slotId: slot.id,
          startTime: parseTimeToMinutes(slot.startTime)
        });
      }
    });

    allClassLessons.sort((a, b) => a.startTime - b.startTime);
    // Remove duplicates
    allClassLessons = allClassLessons.filter((v, i, a) => a.findIndex(t => (t.slotId === v.slotId)) === i);

    const currentIndex = allClassLessons.findIndex(x => x.slotId === currentSlotId);

    const nextLessons = [];
    if (currentIndex !== -1) {
      for (let i = currentIndex + 1; i < allClassLessons.length; i++) {
        nextLessons.push(allClassLessons[i]);
      }
    }

    setConsecutiveSlots(nextLessons);
    setReplicateLog(true);

  }, [activeLesson, data.schedules, data.schools, data.scheduleVersions]);

  const availableInstitutions = useMemo(() => {
    return [
      ...data.schools.filter(s => !s.deleted).map(s => ({ id: s.id, name: s.name, color: s.color, type: 'school' as const })),
      ...(data.settings.isPrivateTeacher ? data.students.map(st => ({ id: st.id, name: st.name, color: st.color, type: 'private' as const })) : [])
    ].sort((a, b) => a.name.localeCompare(b.name));
  }, [data.schools, data.students, data.settings.isPrivateTeacher]);

  const availableClasses = useMemo(() => {
    if (filterInstId === 'all') {
      return Array.from(new Set([...data.schools.filter(s => !s.deleted).flatMap(s => s.classes ? s.classes.filter(c => typeof c === 'string' || !c.deleted).map(c => typeof c === 'string' ? c : c.name) : []), ...data.students.map(st => st.name)])).sort((a, b) => a.localeCompare(b));
    }
    const school = data.schools.find(s => s.id === filterInstId);
    if (school && !school.deleted) return school.classes ? school.classes.filter(c => typeof c === 'string' || !c.deleted).map(c => typeof c === 'string' ? c : c.name).sort((a, b) => a.localeCompare(b)) : [];
    const student = data.students.find(st => st.id === filterInstId);
    if (student) return [student.name];
    return [];
  }, [data.schools, data.students, filterInstId]);

  const periodOptions = useMemo(() => {
    if (filterInstId === 'all') return [];
    // FIX: Select calendar for the current year to avoid old/empty calendars
    const currentYear = new Date().getFullYear();
    const calendar = data.calendars.find(c => c.schoolId === filterInstId && c.year === currentYear) || data.calendars.find(c => c.schoolId === filterInstId);

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

  const getBlockReason = (dateStr: string, schoolId: string, shiftId?: string, classId?: string): string | null => {
    const calendar = data.calendars.find(c => c.schoolId === schoolId);

    // Check mid-year break
    if (calendar?.midYearBreak.start && dateStr >= calendar.midYearBreak.start && dateStr <= calendar.midYearBreak.end) {
      return "Recesso de Meio de Ano";
    }

    // Check extra recesses
    const recess = calendar?.extraRecesses?.find(r => r.date === dateStr);
    if (recess) {
      return recess.name; // e.g., "Carnaval", "Páscoa"
    }

    // Check blocking events
    const event = data.events.find(e =>
      e.schoolId === schoolId &&
      e.date.startsWith(dateStr) &&
      e.blocksClasses &&
      (!e.slotId || e.slotId === shiftId) &&
      (!e.classId || e.classId === classId)
    );

    if (event) {
      return event.title; // e.g., "Reunião Pedagógica", "Conselho de Classe"
    }

    return null;
  };

  const pendingLessons = useMemo(() => {
    const now = new Date();
    const endStr = getYYYYMMDD(now);
    const start = new Date(now);
    start.setDate(now.getDate() - 365); // 1 year lookback for pendencies
    const startStr = getYYYYMMDD(start);

    // Fetch all display items for the last year
    const allItems = getLessonDisplayItems(data, {
      start: startStr,
      end: endStr,
      schoolId: 'all',
      classId: 'all',
      showWithContent: true,
      showWithoutContent: true
    });

    // Filter for past lessons without content
    return allItems
      .filter(i => i.isPast && !i.hasContent)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data]);

  // Calculate Date Range for History View (Unified with Stats)
  const historyDateRange = useMemo(() => {
    const now = new Date();
    const todayStr = getYYYYMMDD(now);
    const currentYear = now.getFullYear();

    const activeCalendar = filterInstId !== 'all'
      ? (data.calendars.find(c => c.schoolId === filterInstId && c.year === currentYear) || data.calendars.find(c => c.schoolId === filterInstId))
      : null;

    const activeTerm = activeCalendar && filterPeriodIdx !== 'all'
      ? activeCalendar.terms[Number(filterPeriodIdx)]
      : null;

    let startDate: Date;
    let endDate: Date;

    if (activeTerm && activeTerm.start && activeTerm.end) {
      startDate = new Date(activeTerm.start + 'T00:00:00');
      endDate = new Date(activeTerm.end + 'T00:00:00');
    } else {
      // Fallback: Earliest Calendar Start OR 1 Year Ago
      const calendarStarts = data.calendars.map(c => c.start).filter(Boolean).sort();
      if (calendarStarts.length > 0) {
        startDate = new Date(calendarStarts[0] + 'T00:00:00');
        endDate = new Date(currentYear, 11, 31);
      } else {
        startDate = new Date(now);
        startDate.setFullYear(now.getFullYear() - 1);
        endDate = new Date(currentYear, 11, 31);
      }
    }

    // REGRA DE OURO 2: Não mostrar nada depois de hoje
    const endStr = getYYYYMMDD(endDate);
    const effectiveEnd = endStr > todayStr ? todayStr : endStr;

    return { start: getYYYYMMDD(startDate), end: effectiveEnd };
  }, [data.calendars, filterInstId, filterPeriodIdx]);

  // Unified History Items
  const historyItems = useMemo(() => {
    const items = getLessonDisplayItems(data, {
      start: historyDateRange.start,
      end: historyDateRange.end,
      schoolId: filterInstId,
      classId: filterClassId,
      periodIdx: filterPeriodIdx,
      showWithContent,
      showWithoutContent
    });

    const today = new Date();
    today.setHours(23, 59, 59, 999);

    return items.filter(item => {
      // 1. Ocultar o que foi deletado (Soft Delete)
      if (item.log?.status === 'removed') return false;

      // 2. Ocultar aulas "Particulares" vazias (Ghost records)
      // Se for do tipo 'custom' ou 'private' E não tiver conteúdo, não mostrar
      // Private students are identified by having 'schedules' property or type check if available
      if ('schedules' in item.institution && !item.hasContent) return false;

      const lessonDate = new Date(item.date + 'T00:00:00');

      // 1. Não mostrar nada depois de hoje
      if (lessonDate > today) return false;

      // 2. Não mostrar nada antes do início das aulas
      if (item.institution) {
        // Aluno Particular
        if ('startDate' in item.institution && item.institution.startDate) {
          if (item.date < item.institution.startDate) return false;
        }
        // Escola
        else if ('id' in item.institution) {
          const schoolId = item.institution.id;
          const itemYear = lessonDate.getFullYear();
          const calendar = data.calendars.find(c => c.schoolId === schoolId && c.year === itemYear);

          if (calendar && calendar.start) {
            if (item.date < calendar.start) return false;
          }
        }
      }

      return true;
    });
  }, [data, historyDateRange, filterInstId, filterClassId, filterPeriodIdx, showWithContent, showWithoutContent]);

  const stats = useMemo(() => {
    const pastItems = historyItems.filter(i => i.isPast);
    return {
      totalPastPlanned: pastItems.length,
      loggedPast: pastItems.filter(i => i.hasContent).length,
      totalSchedule: historyItems.length,
      totalWithContent: historyItems.filter(i => i.hasContent).length,
      totalFutureWithContent: historyItems.filter(i => !i.isPast && i.hasContent).length
    };
  }, [historyItems]);

  const lastLessonInfo = useMemo(() => {
    if (!activeLesson) return null;
    const classId = activeLesson.type === 'school' ? activeLesson.schedule.classId : activeLesson.institution.name;
    const instId = activeLesson.institution.id;
    const currentSlotStart = parseTimeToMinutes(activeLesson.slot.startTime);

    // Find the current lesson's log (if any)
    const currentLog = data.logs.find(l =>
      l.date.startsWith(activeLesson.date) &&
      (l.schoolId === instId || l.studentId === instId) &&
      l.slotId === activeLesson.schedule.slotId &&
      l.status !== 'removed'
    );

    return data.logs
      .filter(l => {
        // Exclude current lesson log from retrospective
        if (currentLog && l.id === currentLog.id) return false;

        // Filter by Class and Institution
        if (l.classId !== classId) return false;
        if (l.schoolId !== instId && l.studentId !== instId) return false;
        if (l.status === 'removed') return false;

        const logDateStr = l.date.split('T')[0];

        // previous dates: accepted
        if (logDateStr < activeLesson.date) return true;

        // future dates: rejected
        if (logDateStr > activeLesson.date) return false;

        // same date: must be strictly earlier
        if (logDateStr === activeLesson.date) {
          // Find slot for this log to check time
          // Strategy: Try to find slot in the school structure
          // If it's the SAME slot ID, it's the same lesson (discard) -> "Scheduled Test" case
          if (l.slotId === activeLesson.schedule.slotId) return false;

          const logSchool = data.schools.find(s => s.id === l.schoolId);
          if (logSchool) {
            for (const shift of logSchool.shifts) {
              const s = shift.slots.find(slot => slot.id === l.slotId);
              if (s && s.startTime) {
                const logStart = parseTimeToMinutes(s.startTime);
                return logStart < currentSlotStart;
              }
            }
          }
          // If private teacher or slot not found, fallback to safer "exclude" to avoid weird recursion
          return false;
        }

        return false;
      })
      .sort((a, b) => {
        // Sort by Date Descending
        const dateDiff = b.date.localeCompare(a.date);
        if (dateDiff !== 0) return dateDiff;

        // If same date, we ideally sort by time, but logs don't have explicit time easily accessible without lookup.
        // However, since we filtered strictly earlier stuff, the order might not matter heavily for just "the last one", 
        // BUT if we have period 1 and period 2, and we are in period 3, we want period 2.
        // Period 2 likely created AFTER period 1. So 'created_at' or simply ID?
        // We don't have created_at.
        // We can rely on insertion order or try to sort by slot time if possible.
        // For now, let's assume the filter is robust enough and Date sort handles the bulk. 
        // For same-day multiple previous lessons, sorting might be unstable without time lookup.
        return 0;
      })[0];
  }, [activeLesson, data.logs, data.schools]);

  const extraLogsForDay = useMemo(() => {
    const dayOfWeek = getDayOfWeekFromDate(selectedDate);
    const dailySchedules = getSchedulesForDate(data, selectedDate);

    // 1. Get all potential logs for today
    const potentialLogs = data.logs.filter(l =>
      l.date.startsWith(selectedDate) &&
      l.status !== 'removed' &&
      (l.type === 'extra' || l.type === 'substitution')
    );

    // 2. Get all scheduled slots for today (to identify what is ALREADY in the grid)
    const scheduledSlots = dailySchedules.filter(s =>
      Number(s.dayOfWeek) === dayOfWeek &&
      s.classId !== 'window'
    );

    // 3. Filter criteria (if needed, or just return detailed logs)
    return potentialLogs;
  }, [selectedDate, data.logs, data.scheduleVersions, data.schedules]);

  const renderMiniCalendar = (baseDate: Date, maxDate?: string) => {
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const days = [];
    const todayStr = getYYYYMMDD(new Date());

    const activeTerm = filterInstId !== 'all' && filterPeriodIdx !== 'all'
      ? data.calendars.find(c => c.schoolId === filterInstId)?.terms[Number(filterPeriodIdx)]
      : null;

    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= lastDay; i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const dObj = new Date(dateStr + 'T00:00:00');
      const dayOfWeek = dObj.getDay() as DayOfWeek;
      const holidayName = getHolidayName(dObj);
      const isFuture = dateStr > todayStr;

      const isBlocked = filterInstId !== 'all' ? isLessonBlocked(dateStr, filterInstId) : false;
      const isWithinFilteredTerm = !activeTerm || (dateStr >= activeTerm.start && dateStr <= activeTerm.end);

      // Get versioned schedules for this date
      const dailySchedules = getSchedulesForDate(data, dateStr);
      const hasFilteredSchedule = isWithinFilteredTerm && (!maxDate || dateStr <= maxDate) && (
        dailySchedules.some(s => {
          const school = data.schools.find(sc => sc.id === s.schoolId);
          if (school?.deleted) return false;
          return Number(s.dayOfWeek) === dayOfWeek && s.classId !== 'window' && (filterInstId === 'all' || s.schoolId === filterInstId) && (filterClassId === 'all' || s.classId === filterClassId) && !isLessonBlocked(dateStr, s.schoolId, s.shiftId, s.classId);
        }) ||
        (data.settings.isPrivateTeacher && data.students.some(st => (filterInstId === 'all' || st.id === filterInstId) && (filterClassId === 'all' || st.name === filterClassId) && dateStr >= st.startDate && st.schedules.some(ps => Number(ps.dayOfWeek) === dayOfWeek) && !isLessonBlocked(dateStr, st.id)))
      ) && !isBlocked && !holidayName;

      days.push({ day: i, dateStr, isBlocked, holidayName, hasFilteredSchedule, isFuture });
    }

    return (
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 animate-in fade-in zoom-in-95">
        <h4 className="font-black uppercase text-[9px] mb-4 text-center">{baseDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })}</h4>
        <div className="grid grid-cols-7 gap-1">
          {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <div key={`${d}-${i}`} className="text-center text-[7px] font-black text-slate-400">{d}</div>)}
          {days.map((d, i) => {
            if (!d) return <div key={i} />;
            let bg = 'bg-slate-50 dark:bg-slate-800/50';
            if (d.holidayName || d.isBlocked) bg = 'bg-pink-100 dark:bg-pink-900/30';
            else if (d.hasFilteredSchedule) bg = 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-100';
            if (selectedDate === d.dateStr) bg = 'bg-primary scale-110 z-10';

            // Logic for History Mode: Disable future dates
            const isHistoryDisabled = viewMode === 'registered' && d.isFuture;
            if (isHistoryDisabled) {
              bg = 'bg-slate-100 dark:bg-slate-800 opacity-20 cursor-not-allowed grayscale';
            }

            return (
              <button
                key={i}
                onClick={() => {
                  if (isHistoryDisabled) return;
                  setSelectedDate(d.dateStr);
                  setViewMode('day');
                }}
                disabled={isHistoryDisabled}
                className={`aspect-square rounded-lg flex items-center justify-center relative transition-all ${bg}`}
              >
                <span className={`text-[9px] font-black ${selectedDate === d.dateStr ? 'text-white' : d.holidayName ? 'text-pink-600' : 'text-slate-500'}`}>{d.day}</span>
                {d.hasFilteredSchedule && selectedDate !== d.dateStr && !isHistoryDisabled && <div className="absolute top-1 right-1 w-1 h-1 bg-blue-500 rounded-full" />}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const handleOpenLog = (schedule: ScheduleEntry, date: string) => {
    const dObj = new Date(date + 'T00:00:00');

    // Verificar se é aula extra (schedule.shiftId === 'extra')
    if (schedule.shiftId === 'extra') {
      // Aula extra - carregar log existente
      const existingLog = data.logs.find(l => l.id === schedule.slotId);
      if (!existingLog) return;

      const school = data.schools.find(s => s.id === schedule.schoolId);
      if (!school) return;

      // Criar slot virtual baseado no horário da aula extra
      const virtualSlot: TimeSlot = {
        id: existingLog.id,
        startTime: existingLog.startTime || '00:00',
        endTime: existingLog.endTime || '00:00',
        label: existingLog.type === 'extra' ? 'Aula Extra' : existingLog.type === 'regular' ? (data.classRecords?.find(r => r.classId === existingLog.classId)?.className || existingLog.classId) : 'Substituição',
        type: 'class'
      };

      const record = data.classRecords?.find(r => r.schoolId === schedule.schoolId && r.classId === schedule.classId);
      const activeStudents = record ? record.students.filter(s => s.active !== false) : [];
      const defaultAttendance: StudentAttendance[] = activeStudents.map(s => ({ studentId: s.id, status: 'present' }));

      setActiveLesson({
        schedule,
        institution: school,
        slot: virtualSlot,
        date,
        type: 'school'
      });

      setLogForm({
        subject: existingLog.subject || '',
        homework: existingLog.homework || '',
        notes: existingLog.notes || '',
        occurrences: existingLog.occurrences || [],
        attendance: existingLog.attendance || defaultAttendance
      });

      setIsAddingOccurrence(false);
      setTempOccurrence({ type: OCCURRENCE_TYPES[0], description: '', studentIds: [] });
      return;
    }

    // Allow opening even if blocked - we'll handle read-only mode inside the modal
    const inst = data.schools.find(s => s.id === schedule.schoolId) || data.students.find(st => st.id === schedule.schoolId);
    if (!inst) return;
    let slot: TimeSlot | undefined;
    if ('shifts' in inst) {
      slot = inst.shifts.find(sh => sh.id === schedule.shiftId)?.slots.find(sl => sl.id === schedule.slotId);

      // FALLBACK: If Strict Shift ID match fails, try finding the slot in ANY shift of this school
      // (This handles "regular" shiftId logs or legacy data)
      if (!slot) {
        for (const shift of inst.shifts) {
          const found = shift.slots.find(s => s.id === schedule.slotId);
          if (found) {
            slot = found;
            break; // Stop once found
          }
        }
      }
    } else { const ps = (inst as Student).schedules.find(s => s.id === schedule.slotId); if (ps) slot = { id: ps.id, startTime: ps.startTime, endTime: ps.endTime, label: 'Aula Particular', type: 'class' }; }

    // FALLBACK: If slot not found in official shifts, try to find a log by ID (Extra Lesson Masked as Regular Shift)
    if (!slot) {
      const existingLog = data.logs.find(l => l.id === schedule.slotId);
      if (existingLog) {
        const virtualSlot: TimeSlot = {
          id: existingLog.id,
          startTime: existingLog.startTime || '00:00',
          endTime: existingLog.endTime || '00:00',
          label: existingLog.type === 'extra' ? 'Aula Extra' : existingLog.type === 'regular' ? (data.classRecords?.find(r => r.classId === existingLog.classId)?.className || existingLog.classId) : 'Substituição',
          type: 'class'
        };

        const record = data.classRecords?.find(r => r.schoolId === schedule.schoolId && r.classId === schedule.classId);
        const activeStudents = record ? record.students.filter(s => s.active !== false) : [];
        const defaultAttendance: StudentAttendance[] = activeStudents.map(s => ({ studentId: s.id, status: 'present' }));

        setActiveLesson({
          schedule: { ...schedule, shiftId: 'extra' }, // Force 'extra' context for clarity
          institution: inst,
          slot: virtualSlot,
          date,
          type: 'school'
        });

        setLogForm({
          subject: existingLog.subject || '',
          homework: existingLog.homework || '',
          notes: existingLog.notes || '',
          occurrences: existingLog.occurrences || [],
          attendance: existingLog.attendance || defaultAttendance
        });
        setIsAddingOccurrence(false);
        setTempOccurrence({ type: OCCURRENCE_TYPES[0], description: '', studentIds: [] });
        return;
      }
    }

    if (slot) {
      let ex = data.logs.find(l => l.date.startsWith(date) && (l.schoolId === schedule.schoolId || l.studentId === schedule.schoolId) && l.slotId === schedule.slotId);

      // FALLBACK: If Strict Slot ID match fails, try finding by Time/Class Match
      // (This handles Extra Lessons created on top of slots where Log Slot ID != Schedule Slot ID)
      if (!ex) {
        ex = data.logs.find(l =>
          l.date.startsWith(date) &&
          l.schoolId === schedule.schoolId &&
          l.classId === schedule.classId &&
          l.startTime === slot!.startTime
        );
      }

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


  const [navMode, setNavMode] = useState<'day' | 'class'>('day');

  const findNextLesson = (direction: 'next' | 'prev') => {
    if (!activeLesson) return;

    if (activeLesson.type === 'private') {
      if (navMode === 'class') {
        navigateByStudent(direction);
      } else {
        navigateByDay(direction);
      }
      return;
    }

    if (navMode === 'day') {
      navigateByDay(direction);
    } else {
      navigateByClass(direction);
    }
  };

  const navigateByDay = (direction: 'next' | 'prev') => {
    if (!activeLesson || !activeLesson.schedule) return;

    const currentMinute = parseTimeToMinutes(activeLesson.slot.startTime);
    const dayOfWeek = getDayOfWeekFromDate(activeLesson.date);

    // Find all lessons for this day
    const lessonsForDay: { schedule: ScheduleEntry, slot: TimeSlot, startMin: number }[] = [];

    // School lessons
    const dailySchedules = getSchedulesForDate(data, activeLesson.date);
    dailySchedules.filter(s => Number(s.dayOfWeek) === dayOfWeek && s.classId !== 'window').forEach(s => {
      const school = data.schools.find(sc => sc.id === s.schoolId);
      if (school?.deleted) return;
      const slot = school?.shifts.find(sh => sh.id === s.shiftId)?.slots.find(sl => sl.id === s.slotId);
      if (slot && !isLessonBlocked(activeLesson.date, s.schoolId, s.shiftId, s.classId)) {
        lessonsForDay.push({ schedule: s, slot, startMin: parseTimeToMinutes(slot.startTime) });
      }
    });

    // Private lessons
    if (data.settings.isPrivateTeacher) {
      data.students.forEach(st => {
        if (activeLesson.date < st.startDate || isLessonBlocked(activeLesson.date, st.id)) return;
        st.schedules.filter(ps => Number(ps.dayOfWeek) === dayOfWeek).forEach(ps => {
          lessonsForDay.push({
            schedule: { dayOfWeek, schoolId: st.id, shiftId: 'private', slotId: ps.id, classId: st.name },
            slot: { id: ps.id, label: 'Particular', startTime: ps.startTime, endTime: ps.endTime, type: 'class' },
            startMin: parseTimeToMinutes(ps.startTime)
          });
        });
      });
    }

    lessonsForDay.sort((a, b) => a.startMin - b.startMin);

    const currentIndex = lessonsForDay.findIndex(l =>
      l.schedule.schoolId === activeLesson.schedule.schoolId &&
      l.schedule.slotId === activeLesson.schedule.slotId &&
      l.schedule.classId === activeLesson.schedule.classId
    );

    if (currentIndex === -1) return;

    const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (targetIndex >= 0 && targetIndex < lessonsForDay.length) {
      handleOpenLog(lessonsForDay[targetIndex].schedule, activeLesson.date);
    } else {
      alert(direction === 'next' ? 'Esta é a última aula deste dia.' : 'Esta é a primeira aula deste dia.');
    }
  };


  const navigateByClass = (direction: 'next' | 'prev') => {
    // Find next/prev date for THIS class
    if (!activeLesson || activeLesson.type !== 'school') return;

    const schedule = activeLesson.schedule;
    const schoolId = schedule.schoolId;
    const classId = schedule.classId;

    // Boundary Check
    const calendar = data.calendars.find(c => c.schoolId === schoolId);
    if (calendar) {
      const currentDateStr = getYYYYMMDD(new Date(activeLesson.date + 'T00:00:00'));
      if (direction === 'prev' && calendar.start && currentDateStr <= calendar.start) {
        showWarning('Início do ano letivo alcançado.');
        return;
      }
      if (direction === 'next' && calendar.end && currentDateStr >= calendar.end) {
        showWarning('Fim do ano letivo alcançado.');
        return;
      }
    }

    // Limit search to 60 days
    const current = new Date(activeLesson.date + 'T00:00:00');
    let found = false;
    let attempts = 0;

    while (!found && attempts < 60) {
      if (direction === 'next') current.setDate(current.getDate() + 1);
      else current.setDate(current.getDate() - 1);
      attempts++;

      const dateStr = getYYYYMMDD(current);
      const dayOfWeek = current.getDay() as DayOfWeek;

      if (isHoliday(current)) continue;

      // Check for blocked dates (recesses)
      const isBlocked = isLessonBlocked(dateStr, schoolId);
      if (isBlocked) continue;

      // Check if class has schedule on this day
      const dailySchedules = getSchedulesForDate(data, dateStr);
      const targetSchedule = dailySchedules.find(s =>
        Number(s.dayOfWeek) === dayOfWeek &&
        s.schoolId === schoolId &&
        s.classId === classId &&
        !isLessonBlocked(dateStr, schoolId, s.shiftId, classId)
      );

      if (targetSchedule) {
        handleOpenLog(targetSchedule, dateStr);
        found = true;
      }
    }

    if (!found) {
      alert(`Não foi encontrada aula para ${classId} nos próximos/anteriores 60 dias.`);
    }
  };

  const navigateByStudent = (direction: 'next' | 'prev') => {
    // Find next/prev date for THIS Private Student
    if (!activeLesson || activeLesson.type !== 'private') return;

    const studentId = activeLesson.institution.id;

    // Boundary Check
    const student = data.students.find(s => s.id === studentId);
    if (!student) return;

    const currentDateStr = getYYYYMMDD(new Date(activeLesson.date + 'T00:00:00'));
    if (direction === 'prev' && student.startDate && currentDateStr <= student.startDate) {
      showWarning('Data de início das aulas do aluno alcançada.');
      return;
    }

    // Limit search to 60 days
    const current = new Date(activeLesson.date + 'T00:00:00');
    let found = false;
    let attempts = 0;

    while (!found && attempts < 60) {
      if (direction === 'next') current.setDate(current.getDate() + 1);
      else current.setDate(current.getDate() - 1);
      attempts++;

      const dateStr = getYYYYMMDD(current);
      const dayOfWeek = current.getDay() as DayOfWeek;

      if (isHoliday(current)) continue;
      if (isLessonBlocked(dateStr, studentId)) continue;
      if (dateStr < student.startDate) continue;

      // Check if student has schedule on this day
      const targetSchedule = student.schedules.find(s =>
        Number(s.dayOfWeek) === dayOfWeek
      );

      if (targetSchedule) {
        // Construct a schedule entry for handleOpenLog
        // We need to mimic the structure used in other places for private students
        const scheduleEntry: ScheduleEntry = {
          dayOfWeek,
          schoolId: studentId,
          shiftId: 'private',
          slotId: targetSchedule.id,
          classId: student.name
        };
        handleOpenLog(scheduleEntry, dateStr);
        found = true;
      }
    }

    if (!found) {
      alert(`Não foi encontrada aula para ${student.name} nos próximos/anteriores 60 dias.`);
    }
  };


  const [copyData, setCopyData] = useState({
    isOpen: false,
    targetDate: getYYYYMMDD(new Date()),
    selectedClasses: [] as string[],
    selectedSlots: [] as string[], // Format: "schoolId|shiftId|slotId|classId"
    contentTypes: { subject: true, homework: true, notes: false }
  });

  const availableSlotsForCopy = useMemo(() => {
    if (!copyData.isOpen || !copyData.targetDate) return [];

    const dayOfWeek = new Date(copyData.targetDate + 'T00:00:00').getDay() as DayOfWeek;
    const slots: { id: string, label: string, schoolName: string, className: string, time: string, hasContent: boolean }[] = [];

    // Proteção defensiva: garantir que data.schools existe e é um array
    if (!data?.schools || !Array.isArray(data.schools)) return [];

    // Iterate over schools and shifts
    data.schools.filter(s => !s.deleted).forEach(school => {
      // Proteção: garantir que shifts existe
      if (!school.shifts || !Array.isArray(school.shifts)) return;

      school.shifts.forEach(shift => {
        // Proteção: garantir que slots existe
        if (!shift.slots || !Array.isArray(shift.slots)) return;

        shift.slots.forEach(slot => {
          // Check if there is a schedule for this slot on the target day
          const schedules = (data.schedules || []).filter(s =>
            Number(s.dayOfWeek) === dayOfWeek &&
            s.schoolId === school.id &&
            s.shiftId === shift.id &&
            s.slotId === slot.id &&
            s.classId !== 'window' &&
            // Compatibilidade Híbrida: ID ou Nome
            (copyData.selectedClasses.length === 0 ||
              copyData.selectedClasses.includes(s.classId) ||
              (school.classes.find(c => c.id === s.classId)?.name && copyData.selectedClasses.includes(school.classes.find(c => c.id === s.classId)!.name))
            )
          );

          schedules.forEach(sched => {
            // Check if log exists
            const hasContent = (data.logs || []).some(l =>
              l.date.startsWith(copyData.targetDate) &&
              l.schoolId === school.id &&
              l.slotId === slot.id
            );

            slots.push({
              id: `${school.id}|${shift.id}|${slot.id}|${sched.classId}`,
              label: `${sched.classId} - ${school.name}`,
              schoolName: school.name,
              className: sched.classId,
              time: `${slot.startTime} - ${slot.endTime}`,
              hasContent
            });
          });
        });
      });
    });

    return slots;
  }, [copyData, data.schedules, data.schools, data.logs]);

  const handleCopyLesson = () => {
    if (copyData.selectedSlots.length === 0) return;

    const newLogs: LessonLog[] = [];
    const updatedLogsRaw: LessonLog[] = [...data.logs];

    copyData.selectedSlots.forEach(slotKey => {
      const [schoolId, shiftId, slotId, classId] = slotKey.split('|');

      // Check if log exists
      const existingLogIndex = updatedLogsRaw.findIndex(l =>
        l.date.startsWith(copyData.targetDate) &&
        l.schoolId === schoolId &&
        l.slotId === slotId
      );

      if (existingLogIndex >= 0) {
        // Update existing
        updatedLogsRaw[existingLogIndex] = {
          ...updatedLogsRaw[existingLogIndex],
          subject: copyData.contentTypes.subject ? logForm.subject : updatedLogsRaw[existingLogIndex].subject,
          homework: copyData.contentTypes.homework ? logForm.homework : updatedLogsRaw[existingLogIndex].homework,
          notes: copyData.contentTypes.notes ? logForm.notes : updatedLogsRaw[existingLogIndex].notes,
        };
      } else {
        // Create new
        newLogs.push({
          id: crypto.randomUUID(),
          date: new Date(copyData.targetDate + 'T00:00:00').toISOString(),
          schoolId,
          classId,
          slotId,
          studentId: '', // TODO: Handle private lessons copy if needed
          subject: copyData.contentTypes.subject ? logForm.subject : '',
          homework: copyData.contentTypes.homework ? logForm.homework : '',
          notes: copyData.contentTypes.notes ? logForm.notes : '',
          occurrences: [],
          attendance: [],
          type: 'regular'
        });
      }
    });

    onUpdateData({ logs: [...updatedLogsRaw, ...newLogs] });
    setCopyData(prev => ({ ...prev, isOpen: false, selectedSlots: [] }));
    // Maybe show a toast/alert?
    alert('Aula copiada com sucesso!');
  };

  const handleAttendanceChange = (studentId: string, status: 'present' | 'absent' | 'justified') => {
    setLogForm(prev => ({
      ...prev,
      attendance: prev.attendance.map(a => a.studentId === studentId ? { ...a, status } : a)
    }));
  };

  const handleSaveLog = async () => {
    if (!activeLesson) return;
    setSaveStatus('loading');

    // Validações de segurança
    if (!logForm.subject.trim()) {
      showError('O campo "Conteúdo" é obrigatório.');
      return;
    }

    if (logForm.subject.length > LIMITS.MAX_SUBJECT_LENGTH) {
      showError(`O conteúdo deve ter no máximo ${LIMITS.MAX_SUBJECT_LENGTH} caracteres.`);
      return;
    }

    // Sanitização de dados
    const sanitizedLogForm = {
      subject: sanitizeText(logForm.subject, LIMITS.MAX_SUBJECT_LENGTH),
      homework: sanitizeText(logForm.homework, LIMITS.MAX_HOMEWORK_LENGTH),
      notes: sanitizeText(logForm.notes, LIMITS.MAX_TEXT_LENGTH),
      occurrences: logForm.occurrences,
      attendance: logForm.attendance
    };

    // Verificar se é aula extra
    if (activeLesson.schedule.shiftId === 'extra') {
      // Atualizar log existente
      const updatedLogs = data.logs.map(l => {
        if (l.id === activeLesson.schedule.slotId) {
          return {
            ...l,
            ...sanitizedLogForm
          };
        }
        return l;
      });

      onUpdateData({ logs: updatedLogs });
      showSuccess('Aula atualizada com sucesso!');
      setSaveStatus('success');
      return;
    }

    // Lógica normal para aulas regulares
    const logsToSave: LessonLog[] = [];

    const createLogObject = (slotId: string) => ({
      id: crypto.randomUUID(),
      date: new Date(activeLesson.date + 'T00:00:00').toISOString(),
      schoolId: activeLesson.type === 'school' ? activeLesson.institution.id : '',
      studentId: activeLesson.type === 'private' ? activeLesson.institution.id : '',
      classId: activeLesson.type === 'school' ? activeLesson.schedule.classId : activeLesson.institution.name,
      slotId: slotId,
      ...sanitizedLogForm,
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

    const count = logsToSave.length;
    showSuccess(count > 1 ? `${count} aulas registradas com sucesso!` : 'Aula registrada com sucesso!');

    setSaveStatus('success');
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

  // Lógica para montar a Grade Integrada Panorâmica (Fixed + Manual)
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

    const processedSlotKeys = new Set<string>();

    // Proteção defensiva: garantir que data.schools existe
    if (!data?.schools || !Array.isArray(data.schools)) {
      return { groupedShifts, sortedKeys: [] };
    }

    // Get versioned schedules for the selected date
    const dailySchedules = getSchedulesForDate(data, selectedDate);

    data.schools.filter(s => !s.deleted).forEach(school => {
      // Proteção: garantir que shifts existe
      if (!school.shifts || !Array.isArray(school.shifts)) return;

      school.shifts.forEach(shift => {
        // Proteção: garantir que slots existe
        if (!shift.slots || !Array.isArray(shift.slots)) return;

        // FIX: Check Academic Calendar for this school
        const currentYear = new Date(selectedDate).getFullYear();
        const calendar = data.calendars.find(c => c.schoolId === school.id && c.year === currentYear) ||
          data.calendars.find(c => c.schoolId === school.id);

        if (calendar) {
          if (calendar.start && selectedDate < calendar.start) return;
          if (calendar.end && selectedDate > calendar.end) return;
        }

        shift.slots.forEach(slot => {
          const schedule = dailySchedules.find(s =>
            Number(s.dayOfWeek) === day &&
            s.schoolId === school.id &&
            s.shiftId === shift.id &&
            s.slotId === slot.id
          );

          if (!schedule) return;

          const log = (data.logs || []).find(l => l.date.startsWith(selectedDate) && l.schoolId === school.id && l.slotId === slot.id);

          if (log && log.status === 'removed') return;

          if (log && log.status === 'removed') return;

          processedSlotKeys.add(`${school.id}-${shift.id}-${slot.id}`);

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

    if (data.settings?.isPrivateTeacher && data.students && Array.isArray(data.students)) {
      data.students.forEach(st => {
        if (selectedDate < st.startDate) return;
        if (isLessonBlocked(selectedDate, st.id)) return;

        // Proteção: garantir que schedules existe
        if (!st.schedules || !Array.isArray(st.schedules)) return;

        st.schedules.filter(ps => Number(ps.dayOfWeek) === day).forEach(ps => {
          const slot = { id: ps.id, startTime: ps.startTime, endTime: ps.endTime, label: 'Aula Particular', type: 'class' as const };
          const log = (data.logs || []).find(l => l.date.startsWith(selectedDate) && l.studentId === st.id && l.slotId === ps.id);

          if (log && log.status === 'removed') return;

          processedSlotKeys.add(`${st.id}-private-${ps.id}`);

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

    // 3. Process Manual Logs (Regular + Extra) - Unified
    const manualLogs = (data.logs || []).filter(l =>
      l.date.startsWith(selectedDate) &&
      l.status !== 'removed' &&
      (l.type === 'extra' || l.type === 'substitution' || l.type === 'regular')
    );

    // Mapa de slots ocupados por aulas extras (para substituir aulas regulares)
    const extraOccupiedSlots = new Set<string>();

    manualLogs.forEach(log => {
      const school = (data.schools || []).find(s => s.id === log.schoolId);
      const inst = school || (data.settings.isPrivateTeacher ? data.students.find(s => s.id === log.studentId) : null);

      if (!inst) return;

      // Check for redundant Regular logs
      let isRedundantRegular = false;
      if (log.type === 'regular') {
        if (school && school.shifts) {
          for (const shift of school.shifts) {
            if (shift.slots.some(s => s.id === log.slotId)) {
              const key = `${school.id}-${shift.id}-${log.slotId}`;
              if (processedSlotKeys.has(key)) {
                isRedundantRegular = true;
                break;
              }
            }
          }
        }
        if (!school && inst && processedSlotKeys.has(`${inst.id}-private-${log.slotId}`)) {
          isRedundantRegular = true;
        }
      }

      if (isRedundantRegular) return;

      // Unmatched Manual Log -> Add to Grid
      let matchedShiftName = 'Extras';
      let matchedShiftId = 'extra';
      let slotInfo: TimeSlot = {
        id: log.slotId || log.id,
        label: log.type === 'regular' ? 'Aula Regular' : log.type === 'substitution' ? 'Substituição' : 'Aula Extra',
        startTime: log.startTime || '00:00',
        endTime: log.endTime || '00:00',
        type: 'class'
      };

      // Try to find matching slot
      let matchedSlot: TimeSlot | null = null;
      if (school && school.shifts) {
        for (const shift of school.shifts) {
          const idMatch = shift.slots.find(s => s.id === log.slotId);
          if (idMatch) {
            matchedShiftName = shift.name;
            matchedShiftId = shift.id;
            slotInfo = idMatch;
            matchedSlot = idMatch;
            break;
          }
          const timeMatch = shift.slots.find(s => s.type === 'class' && s.startTime === log.startTime);
          if (timeMatch) {
            matchedShiftName = shift.name;
            break;
          }
        }
      }

      // Fallback Shift
      if (matchedShiftName === 'Extras' || matchedShiftName === 'Particular') {
        const startMin = parseTimeToMinutes(slotInfo.startTime);
        if (startMin < 720) matchedShiftName = 'Matutino';
        else if (startMin < 1080) matchedShiftName = 'Vespertino';
        else matchedShiftName = 'Noturno';
      }

      // Determine effective IDs for opening the log
      // If we found an exact ID match, we can use the real schedule coordinates
      // Otherwise (time match or no match), we must use 'extra' mode to load by log ID
      let effectiveShiftId = matchedShiftId;
      let effectiveSlotId = log.slotId;

      // If no exact ID match (matched via time or fallback), force 'extra' mode
      if (matchedShiftId !== 'extra' && matchedSlot && matchedSlot.id !== log.slotId) {
        effectiveShiftId = 'extra';
        effectiveSlotId = log.id;
      }
      // If generic extra
      if (matchedShiftId === 'extra') {
        effectiveSlotId = log.id;
      }

      const startMin = parseTimeToMinutes(slotInfo.startTime);
      const endMin = parseTimeToMinutes(slotInfo.endTime);
      const isActive = isToday && currentTime >= startMin && currentTime < endMin;

      // Resolve Class Name for Display
      let displayName = log.classId;
      if (school && school.classes) {
        const classObj = school.classes.find(c => c.id === log.classId);
        if (classObj) displayName = classObj.name;
      }

      // If substitution or extra occupying a slot, mark it to hide original
      if ((log.type === 'substitution' || log.type === 'extra') && matchedSlot && matchedShiftId !== 'extra') {
        const slotKey = `${log.schoolId}-${matchedShiftId}-${matchedSlot.id}`;
        extraOccupiedSlots.add(slotKey);
      }

      if (!groupedShifts[matchedShiftName]) groupedShifts[matchedShiftName] = [];
      groupedShifts[matchedShiftName].push({
        schedule: {
          dayOfWeek: day,
          schoolId: inst.id,
          shiftId: effectiveShiftId,
          slotId: effectiveSlotId,
          classId: log.classId
        },
        inst,
        slot: slotInfo,
        log,
        label: log.type === 'substitution' ? `Subst: ${log.substitutionSubject}` :
          log.type === 'regular' ? displayName :
            `Extra: ${log.subject}`,
        isWindow: false,
        isFree: false,
        startTimeMin: startMin,
        endTimeMin: endMin,
        isActive,
        isExtra: true
      });
    });

    // Filtrar aulas regulares que foram substituídas por aulas extras
    Object.keys(groupedShifts).forEach(key => {
      groupedShifts[key] = groupedShifts[key].filter(item => {
        // Se for aula extra, manter sempre
        if ((item as any).isExtra) return true;

        // Se for aula regular, verificar se não foi substituída
        if (item.schedule) {
          const slotKey = `${item.schedule.schoolId}-${item.schedule.shiftId}-${item.schedule.slotId}`;
          return !extraOccupiedSlots.has(slotKey);
        }

        return true;
      });
    });

    Object.keys(groupedShifts).forEach(key => {
      groupedShifts[key].sort((a, b) => a.startTimeMin - b.startTimeMin);
    });

    const sortedKeys = Object.keys(groupedShifts).sort((a, b) => {
      const order: Record<string, number> = { 'Matutino': 1, 'Vespertino': 2, 'Noturno': 3, 'Particular': 4, 'Extras': 5 };
      return (order[a] || 99) - (order[b] || 99);
    });

    return { sortedKeys, groupedShifts };
  }, [data.scheduleVersions, data.schedules, selectedDate, data.schools, data.students, data.logs, viewMode]);

  // Calculate statistics for history and planning views
  const lessonStats = useMemo(() => {
    const now = new Date();
    const todayStr = getYYYYMMDD(now);
    let totalPastPlanned = 0;
    let totalGeneralPlanned = 0;
    let loggedPast = 0;
    let loggedFuture = 0;

    // Determine date range based on filters
    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (filterInstId !== 'all') {
      const calendar = data.calendars.find(c => c.schoolId === filterInstId);
      if (calendar?.start) {
        startDate = new Date(calendar.start + 'T00:00:00');
      }
      if (calendar?.end) {
        endDate = new Date(calendar.end + 'T00:00:00');
      }
    } else {
      // Find earliest start date from all calendars
      const starts = data.calendars.map(c => c.start).filter(Boolean);
      if (starts.length > 0) {
        startDate = new Date(Math.min(...starts.map(s => new Date(s + 'T00:00:00').getTime())));
      }
    }

    // Default: if no calendar, use 1 year back
    if (!startDate) {
      startDate = new Date(now);
      startDate.setFullYear(now.getFullYear() - 1);
    }

    // Count past lessons (from calendar start to today)
    const currentDate = new Date(startDate);
    while (currentDate <= now) {
      const dateStr = getYYYYMMDD(currentDate);
      const dayOfWeek = currentDate.getDay() as DayOfWeek;

      if (!isHoliday(currentDate)) {
        const dailySchedules = getSchedulesForDate(data, dateStr);
        dailySchedules.forEach(s => {
          if (Number(s.dayOfWeek) !== dayOfWeek || s.classId === 'window') return;
          if (filterInstId !== 'all' && s.schoolId !== filterInstId) return;
          if (filterClassId !== 'all' && s.classId !== filterClassId) return;

          const school = data.schools.find(sc => sc.id === s.schoolId);
          if (!school || school.deleted) return;

          // Check if date is within specific school calendar
          const schoolCalendar = data.calendars.find(c => c.schoolId === s.schoolId);
          if (schoolCalendar && (dateStr < schoolCalendar.start || dateStr > schoolCalendar.end)) {
            return;
          }

          if (isLessonBlocked(dateStr, s.schoolId, s.shiftId, s.classId)) return;

          totalPastPlanned++;

          const log = data.logs.find(l => l.date.startsWith(dateStr) && l.slotId === s.slotId && l.schoolId === s.schoolId && l.status !== 'removed');
          if (log && log.subject) loggedPast++;
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Count future lessons (from tomorrow to calendar end or 1 year ahead)
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const futureEnd = endDate || new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    const futureDate = new Date(tomorrow);

    while (futureDate <= futureEnd) {
      const dateStr = getYYYYMMDD(futureDate);
      const dayOfWeek = futureDate.getDay() as DayOfWeek;

      if (!isHoliday(futureDate)) {
        const dailySchedules = getSchedulesForDate(data, dateStr);
        dailySchedules.forEach(s => {
          if (Number(s.dayOfWeek) !== dayOfWeek || s.classId === 'window') return;
          if (filterInstId !== 'all' && s.schoolId !== filterInstId) return;
          if (filterClassId !== 'all' && s.classId !== filterClassId) return;

          const school = data.schools.find(sc => sc.id === s.schoolId);
          if (!school || school.deleted) return;

          // Check if date is within specific school calendar
          const schoolCalendar = data.calendars.find(c => c.schoolId === s.schoolId);
          if (schoolCalendar && (dateStr < schoolCalendar.start || dateStr > schoolCalendar.end)) {
            return;
          }

          if (isLessonBlocked(dateStr, s.schoolId, s.shiftId, s.classId)) return;

          // Check if date is within selected Term (Correcting Stats Counter)
          if (filterPeriodIdx !== 'all' && schoolCalendar) {
            const term = schoolCalendar.terms[Number(filterPeriodIdx)];
            if (term && (dateStr < term.start || dateStr > term.end)) {
              return;
            }
          }

          totalGeneralPlanned++;

          const log = data.logs.find(l => l.date.startsWith(dateStr) && l.slotId === s.slotId && l.schoolId === s.schoolId && l.status !== 'removed');
          if (log && log.subject) loggedFuture++;
        });
      }

      futureDate.setDate(futureDate.getDate() + 1);
    }

    return { totalPastPlanned, totalGeneralPlanned, loggedPast, loggedFuture };
  }, [data.scheduleVersions, data.schools, data.logs, data.calendars, filterInstId, filterClassId, filterPeriodIdx]);

  // Determine if current active lesson is blocked by recess/event
  const blockReason = useMemo(() => {
    if (!activeLesson) return null;
    return getBlockReason(
      activeLesson.date,
      activeLesson.institution.id,
      activeLesson.schedule.shiftId,
      activeLesson.type === 'school' ? activeLesson.schedule.classId : undefined
    );
  }, [activeLesson, data.calendars, data.events]);

  // Reset save status when form changes
  useEffect(() => {
    if (saveStatus === 'success') {
      setSaveStatus('idle');
    }
  }, [logForm]);

  const isReadOnlyRecess = !!blockReason;
  const isFutureDate = selectedDate > getYYYYMMDD(new Date());

  // Auto-fill form with recess reason when opening blocked lesson
  useEffect(() => {
    if (blockReason && activeLesson) {
      setLogForm({
        subject: blockReason,
        homework: '',
        notes: 'Aula não realizada devido a evento/recesso',
        occurrences: [],
        attendance: []
      });
    }
  }, [blockReason, activeLesson]);

  if (activeLesson) {
    return (
      <div className="max-w-2xl mx-auto p-5 md:p-6 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-800 animate-in fade-in slide-in-from-right-4">
        {/* ... (cabeçalho e resto do formulário mantidos) ... */}
        <div className="flex justify-between items-center mb-6 md:mb-8">
          <button onClick={() => setActiveLesson(null)} className="flex items-center gap-2 text-[9px] md:text-[10px] font-black uppercase text-slate-500 hover:text-slate-800 transition-colors"><ArrowLeft size={16} /> Voltar</button>

          <div className="flex items-center gap-2">
            {activeLesson && (() => {
              const existingLog = data.logs.find(l =>
                l.date === activeLesson.date &&
                ((l.schoolId === activeLesson.institution.id && l.slotId === activeLesson.schedule.slotId) ||
                  (l.id === activeLesson.schedule.slotId)) // Handle Extra Lesson ID match
              ) || data.logs.find(l =>
                l.date.startsWith(activeLesson.date) &&
                l.schoolId === activeLesson.institution.id &&
                l.slotId === activeLesson.schedule.slotId
              );

              const isScheduled = activeLesson.type === 'school' && activeLesson.schedule.shiftId !== 'extra';
              const canDelete = existingLog || isScheduled;

              if (!canDelete) return null;

              return (
                <button
                  onClick={() => setShowDeleteOptionsModal(true)}
                  className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  title="Opções de Exclusão"
                >
                  <Trash2 size={20} />
                </button>
              );
            })()}

            {/* Navigation Controls */}
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 p-1 rounded-xl border border-slate-100 dark:border-slate-800">
              <div className="flex bg-white dark:bg-slate-700 rounded-lg p-0.5 shadow-sm">
                <button onClick={() => setNavMode('day')} className={`px-2 py-1 rounded-md text-[8px] font-black uppercase transition-all ${navMode === 'day' ? 'bg-primary text-white' : 'text-slate-400'}`}>Dia</button>
                <button onClick={() => setNavMode('class')} className={`px-2 py-1 rounded-md text-[8px] font-black uppercase transition-all ${navMode === 'class' ? 'bg-primary text-white' : 'text-slate-400'}`}>{activeLesson.type === 'private' ? 'Aluno' : 'Turma'}</button>
              </div>
              <div className="flex items-center gap-1 pl-2 border-l border-slate-200 dark:border-slate-600">
                <button onClick={() => findNextLesson('prev')} className="p-1.5 text-slate-400 hover:text-primary hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-all"><ChevronLeft size={16} /></button>
                <button onClick={() => findNextLesson('next')} className="p-1.5 text-slate-400 hover:text-primary hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-all"><ChevronRight size={16} /></button>
              </div>
            </div>
          </div>


        </div>
        <div className="flex items-center gap-4 md:gap-6 mb-6 md:mb-8">
          <div className="w-12 h-12 md:w-16 md:h-16 rounded-2xl flex items-center justify-center text-white font-black text-xl md:text-2xl shadow-lg" style={{ backgroundColor: activeLesson.institution.color }}>{activeLesson.institution.name[0]}</div>
          <div>
            {(() => {
              const school = activeLesson.institution as School;
              let title = activeLesson.schedule.classId;
              let subtitle = `${activeLesson.institution.name}`;
              let isOfficial = false;

              // 1. Resolve Title (Class Name)
              if (activeLesson.type === 'school' && school.classes) {
                // Try to find by ID first (if schedule.classId is ID) or Name
                const cls = school.classes.find(c => c.id === activeLesson.schedule.classId || c.name === activeLesson.schedule.classId);
                if (cls) title = cls.name;

                // Fallback: If we have a log with classId, try that
                if (activeLesson.log && activeLesson.log.classId) {
                  const clsLog = school.classes.find(c => c.id === activeLesson.log.classId);
                  if (clsLog) title = clsLog.name;
                }
              } else if (activeLesson.type === 'private') {
                title = activeLesson.institution.name; // Student Name
              }

              // 2. Resolve Subtitle (Slot Match)
              const startTime = activeLesson.log?.startTime || activeLesson.slot.startTime;

              if (activeLesson.type === 'school' && school.shifts) {
                let matchFound = false;
                for (const shift of school.shifts) {
                  const match = shift.slots.find(s => s.startTime === startTime);
                  if (match && match.type === 'class') {
                    const lessonIdx = shift.slots.filter(s => s.type === 'class').indexOf(match) + 1;
                    subtitle += ` • ${lessonIdx}ª AULA • ${shift.name.toUpperCase()}`;
                    matchFound = true;
                    isOfficial = true;
                    break;
                  }
                }
                if (!matchFound) {
                  const rawTime = startTime && startTime !== '00:00' ? startTime : activeLesson.slot.startTime;
                  subtitle += ` • ${rawTime}`;
                  // Add generic shift
                  const startMin = parseTimeToMinutes(rawTime);
                  if (startMin < 720) subtitle += ' • MATUTINO';
                  else if (startMin < 1080) subtitle += ' • VESPERTINO';
                  else subtitle += ' • NOTURNO';
                }
              } else {
                subtitle += ` • ${activeLesson.slot.label}`;
              }

              // Date
              subtitle += ` • ${new Date(activeLesson.date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}`;

              return (
                <>
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg md:text-2xl font-black uppercase text-slate-800 dark:text-white tracking-tight">
                      {title}
                    </h3>
                    {activeLesson.date < getYYYYMMDD(new Date()) && (
                      <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-black uppercase tracking-tight">
                        Histórico
                      </span>
                    )}
                    {activeLesson.date > getYYYYMMDD(new Date()) && (
                      <span className="px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 text-[10px] font-black uppercase tracking-tight">
                        Planejamento
                      </span>
                    )}
                  </div>
                  <p className="text-[8px] md:text-[9px] font-black text-slate-500 uppercase mt-1">
                    {subtitle}
                  </p>
                </>
              );
            })()}
          </div>
        </div>

        {lastLessonInfo && (
          <div className="mb-6 md:mb-8 p-4 md:p-6 rounded-xl border border-primary/20 bg-primary-light" style={{ backgroundColor: 'var(--primary-light)' }}>
            <div className="flex items-center gap-2 mb-2 md:mb-3">
              <History size={12} className="text-primary md:w-3.5 md:h-3.5" />
              <span className="text-[9px] md:text-[10px] font-black text-primary uppercase tracking-tight">Retrospectiva</span>
            </div>
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300 italic mb-2">"{lastLessonInfo.subject}"</p>
            <div className="flex gap-4">
              {lastLessonInfo.homework && <div className="text-[8px] md:text-[9px] font-black text-slate-500 uppercase">Tarefa: {lastLessonInfo.homework}</div>}
              <div className="text-[8px] md:text-[9px] font-black text-slate-500 uppercase">Em: {new Date(lastLessonInfo.date).toLocaleDateString('pt-BR')}</div>
            </div>
          </div>
        )}

        {/* Recess/Event Read-Only Mode Banner */}
        {isReadOnlyRecess && (
          <div className="mb-6 p-4 rounded-2xl bg-pink-50 dark:bg-pink-900/20 border border-pink-100 dark:border-pink-900/30 flex items-center gap-3">
            <Palmtree className="text-pink-500" size={20} />
            <div>
              <span className="block text-[9px] font-black uppercase text-pink-600 tracking-tight">Modo Visualização</span>
              <p className="text-xs font-bold text-pink-700 dark:text-pink-300">Esta data possui um recesso ou evento bloqueante: {blockReason}</p>
            </div>
          </div>
        )}

        <div className="space-y-4 md:space-y-6">
          {/* ... (campos de texto mantidos) ... */}
          {activeLesson.schedule.classId === 'window' ? (
            <div className="bg-slate-50 dark:bg-slate-800/50 p-8 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 text-center">
              <Palmtree className="mx-auto text-slate-300 mb-3" size={32} />
              <h3 className="text-sm font-black uppercase text-slate-500 mb-1">Horário de Janela</h3>
              <p className="text-xs text-slate-400 max-w-xs mx-auto mb-6">Este horário está marcado como livre na sua grade. Você pode excluí-lo desta visualização se desejar.</p>

              <button
                onClick={() => setShowDeleteOptionsModal(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-black uppercase text-[10px] tracking-tight hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-all shadow-sm"
              >
                <Trash2 size={16} /> Opções de Exclusão
              </button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase mb-2 ml-2">Conteúdo da Aula {isFutureDate && <span className="text-primary">(Planejamento)</span>}</label>
                <textarea value={logForm.subject} onChange={e => setLogForm({ ...logForm, subject: e.target.value })} disabled={isReadOnlyRecess} readOnly={isReadOnlyRecess} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl p-4 md:p-5 font-bold dark:text-white focus:ring-2 focus:ring-primary outline-none text-sm disabled:opacity-60 disabled:cursor-not-allowed" placeholder={isFutureDate ? "Planeje o conteúdo desta aula..." : "O que foi trabalhado hoje?"} rows={4} />
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase mb-2 ml-2">Tarefa de Casa</label>
                  <input value={logForm.homework} onChange={e => setLogForm({ ...logForm, homework: e.target.value })} disabled={isReadOnlyRecess} readOnly={isReadOnlyRecess} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl p-3 md:p-4 font-bold dark:text-white focus:ring-2 focus:ring-primary outline-none text-sm disabled:opacity-60 disabled:cursor-not-allowed" placeholder="Ex: Exercícios pág. 42" />
                </div>
                <div>
                  <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase mb-2 ml-2">Notas Extras</label>
                  <input value={logForm.notes} onChange={e => setLogForm({ ...logForm, notes: e.target.value })} disabled={isReadOnlyRecess} readOnly={isReadOnlyRecess} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl p-3 md:p-4 font-bold dark:text-white focus:ring-2 focus:ring-primary outline-none text-sm disabled:opacity-60 disabled:cursor-not-allowed" placeholder="Observações..." />
                </div>
              </div>
            </>
          )}

          <div>
            <div className="flex flex-wrap items-center gap-3 mb-2 ml-2">
              {activeLesson.type !== 'private' && !isReadOnlyRecess && (
                <button
                  onClick={() => setCopyData(prev => ({ ...prev, isOpen: true, targetDate: getYYYYMMDD(new Date()) }))}
                  className="flex items-center gap-1 text-[9px] md:text-[10px] font-black text-blue-600 uppercase hover:underline mr-auto transition-all"
                >
                  <Copy size={12} /> Copiar para outra turma
                </button>
              )}

              {data.settings.advancedModes?.attendance && activeLesson.type === 'school' && !isReadOnlyRecess && (
                <button
                  onClick={() => setIsAttendanceModalOpen(true)}
                  className="flex items-center gap-1 text-[8px] md:text-[9px] font-black text-indigo-600 dark:text-indigo-400 uppercase bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1.5 rounded-lg border border-indigo-100 dark:border-indigo-800/50 hover:brightness-95 transition-all"
                >
                  <ClipboardCheck size={12} /> Fazer Chamada
                </button>
              )}

              {!isReadOnlyRecess && (
                <button onClick={() => setIsAddingOccurrence(!isAddingOccurrence)} className="flex items-center gap-1 text-[8px] md:text-[9px] font-black text-primary uppercase hover:bg-primary/10 px-2 py-1 rounded-lg transition-colors"><Plus size={12} /> Adicionar Ocorrência</button>
              )}
            </div>

            {/* Lista de Ocorrências */}
            {logForm.occurrences.length > 0 && (
              <div className="space-y-2 mb-4">
                {logForm.occurrences.map((oc, idx) => (
                  <div key={oc.id} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
                    <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-xl shrink-0"><AlertTriangle size={14} /></div>
                    <div className="flex-1">
                      <span className="block text-[9px] font-black uppercase text-red-500 tracking-tight mb-0.5">{oc.type}</span>
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
              <div className="mb-4 flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
                <div className="p-2 bg-indigo-100 dark:bg-indigo-800 text-indigo-600 rounded-xl"><ClipboardCheck size={14} /></div>
                <div>
                  <span className="block text-[9px] font-black uppercase text-indigo-600 dark:text-indigo-300 tracking-tight">Resumo da Chamada</span>
                  <p className="text-[10px] font-bold text-slate-600 dark:text-slate-300">
                    {logForm.attendance.filter(a => a.status === 'absent').length} Faltas, {logForm.attendance.filter(a => a.status === 'justified').length} Justificadas.
                  </p>
                </div>
              </div>
            )}

            {isAddingOccurrence && (
              <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 animate-in fade-in slide-in-from-top-2">
                <div className="grid md:grid-cols-3 gap-3 mb-3">
                  <div className="md:col-span-1"><label className="block text-[8px] font-black text-slate-400 uppercase mb-1 ml-1">Tipo de Ocorrência</label><select value={tempOccurrence.type} onChange={e => setTempOccurrence(prev => ({ ...prev, type: e.target.value }))} className="w-full bg-white dark:bg-slate-700 border-none rounded-xl px-3 py-2 text-xs font-bold outline-none cursor-pointer dark:text-white">{OCCURRENCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                  <div className="md:col-span-2"><label className="block text-[8px] font-black text-slate-400 uppercase mb-1 ml-1">Descrição do Ocorrido</label><textarea value={tempOccurrence.description} onChange={e => setTempOccurrence(prev => ({ ...prev, description: e.target.value }))} className="w-full bg-white dark:bg-slate-700 border-none rounded-xl px-3 py-2 text-xs font-bold outline-none dark:text-white resize-none" placeholder="Ex: Joãozinho não trouxe o material..." rows={4} /></div>
                </div>

                {/* Seletor de Alunos para Ocorrência Individualizada */}
                {classRoster.length > 0 && (
                  <div className="mb-3 bg-white dark:bg-slate-700/50 p-3 rounded-2xl border border-slate-100 dark:border-slate-600/50">
                    <p className="text-[9px] font-black uppercase text-indigo-500 mb-2 flex items-center gap-1"><Users size={12} /> Alunos Envolvidos (Opcional):</p>
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
            <div className={`flex items-center gap-3 p-4 rounded-xl border transition-all animate-in fade-in ${replicateLog ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-900/40' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-800'}`}>
              <Copy size={20} className={replicateLog ? 'text-blue-500' : 'text-slate-400'} />
              <div className="flex-1">
                <span className={`block text-[10px] font-black uppercase tracking-tight mb-0.5 ${replicateLog ? 'text-blue-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`}>Preencher automaticamente aulas em sequência?</span>
                <p className={`text-[9px] font-bold ${replicateLog ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}>Replicar este conteúdo para +{consecutiveSlots.length} aula(s) seguinte(s) desta turma.</p>
              </div>
              <div className="flex bg-white dark:bg-slate-700 rounded-lg p-1 shadow-sm border border-slate-200 dark:border-slate-600">
                <button
                  onClick={() => setReplicateLog(true)}
                  className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase transition-all ${replicateLog ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  Sim
                </button>
                <button
                  onClick={() => setReplicateLog(false)}
                  className={`px-3 py-1.5 rounded-md text-[9px] font-black uppercase transition-all ${!replicateLog ? 'bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-300' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  Não
                </button>
              </div>
            </div>
          )}

          {/* Botão de Exclusão (apenas para aulas extras) */}
          {activeLesson.schedule.shiftId === 'extra' && (
            <>
              {showDeleteConfirmation ? (
                <div className="w-full p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border-2 border-red-200 dark:border-red-800 flex flex-col gap-3">
                  <p className="text-sm font-bold text-red-700 dark:text-red-300 text-center">
                    Tem certeza que deseja excluir esta aula extra/substituição?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        console.log('Confirming delete for extra lesson:', activeLesson.schedule.slotId);
                        const logIdToDelete = activeLesson.schedule.slotId;
                        const updatedLogs = data.logs.filter(l => l.id !== logIdToDelete);
                        console.log('Logs before delete:', data.logs.length);
                        console.log('Logs after delete:', updatedLogs.length);
                        onUpdateData({ logs: updatedLogs });
                        setShowDeleteConfirmation(false);
                        setActiveLesson(null);
                      }}
                      className="flex-1 py-3 bg-red-600 text-white rounded-xl font-black uppercase text-xs tracking-tight shadow-lg hover:bg-red-700 transition-all"
                    >
                      Sim, Excluir
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirmation(false)}
                      className="flex-1 py-3 bg-slate-300 text-slate-700 rounded-xl font-black uppercase text-xs tracking-tight hover:bg-slate-400 transition-all"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    console.log('Delete button clicked for extra lesson:', activeLesson.schedule.slotId);
                    setShowDeleteConfirmation(true);
                  }}
                  className="w-full py-4 md:py-4 bg-red-600 text-white rounded-xl font-black uppercase text-[10px] md:text-xs tracking-tight shadow-xl mt-4 flex items-center justify-center gap-2 hover:bg-red-700 transition-all"
                >
                  <Trash2 size={16} /> Excluir Aula
                </button>
              )}
            </>
          )}

          {activeLesson.schedule.classId !== 'window' && (
            <button
              onClick={handleSaveLog}
              disabled={saveStatus === 'loading' || saveStatus === 'success'}
              className={`w-full py-4 md:py-4 text-white rounded-xl font-black uppercase text-[10px] md:text-xs tracking-tight shadow-xl mt-4 flex items-center justify-center gap-2 transition-all ${saveStatus === 'success'
                ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20'
                : 'bg-primary hover:opacity-90'
                }`}
            >
              {saveStatus === 'success' ? (
                <><CheckCircle2 size={16} /> Salvo com Sucesso!</>
              ) : saveStatus === 'loading' ? (
                <><Loader2 size={16} className="animate-spin" /> Salvando...</>
              ) : (
                <>Salvar Registro</>
              )}
            </button>
          )}
        </div>

        {/* ... (Modal de Chamada e restante do componente mantido) ... */}
        {isAttendanceModalOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            {/* ... existing attendance modal ... */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl p-6 flex flex-col max-h-[85vh]">
              <div className="flex justify-between items-center mb-4 shrink-0">
                <h3 className="text-lg font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                  <ClipboardCheck className="text-indigo-600" /> Lista de Presença
                </h3>
                <button onClick={() => setIsAttendanceModalOpen(false)} className="text-slate-300 hover:text-slate-600"><X /></button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
                {classRoster.length > 0 ? classRoster.map(student => {
                  const currentStatus = logForm.attendance.find(a => a.studentId === student.id)?.status || 'present';

                  return (
                    <div key={student.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
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
                <button onClick={() => setIsAttendanceModalOpen(false)} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-tight shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all">Confirmar Chamada</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Cópia de Aula */}
        {copyData.isOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl p-6 flex flex-col max-h-[90vh]">
              <div className="flex justify-between items-center mb-4 shrink-0">
                <h3 className="text-lg font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                  <Copy className="text-blue-600" /> Copiar Aula
                </h3>
                <button onClick={() => setCopyData(prev => ({ ...prev, isOpen: false, selectedSlots: [] }))} className="text-slate-300 hover:text-slate-600"><X /></button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-4">
                {/* 1. Seleção de Data */}
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Para qual dia?</label>
                  <input
                    type="date"
                    value={copyData.targetDate}
                    onChange={e => setCopyData(prev => ({ ...prev, targetDate: e.target.value, selectedSlots: [] }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 text-xs font-bold outline-none dark:text-white"
                  />
                </div>

                {/* 2. Seleção de Conteúdo */}
                <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-700">
                  <p className="text-[9px] font-black text-slate-400 uppercase mb-2">O que copiar?</p>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 cursor-pointer bg-white dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 shadow-sm">
                      <input type="checkbox" checked={copyData.contentTypes.subject} onChange={e => setCopyData(prev => ({ ...prev, contentTypes: { ...prev.contentTypes, subject: e.target.checked } }))} className="accent-blue-600" />
                      <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase">Conteúdo</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer bg-white dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 shadow-sm">
                      <input type="checkbox" checked={copyData.contentTypes.homework} onChange={e => setCopyData(prev => ({ ...prev, contentTypes: { ...prev.contentTypes, homework: e.target.checked } }))} className="accent-blue-600" />
                      <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase">Tarefa</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer bg-white dark:bg-slate-800 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 shadow-sm">
                      <input type="checkbox" checked={copyData.contentTypes.notes} onChange={e => setCopyData(prev => ({ ...prev, contentTypes: { ...prev.contentTypes, notes: e.target.checked } }))} className="accent-blue-600" />
                      <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 uppercase">Notas</span>
                    </label>
                  </div>
                </div>

                {/* 3. Seleção de Slots */}
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase mb-2 ml-1">Selecione as turmas/horários de destino:</p>
                  <div className="space-y-2">
                    {availableSlotsForCopy.length > 0 ? availableSlotsForCopy.map(slot => (
                      <label key={slot.id} className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all cursor-pointer ${copyData.selectedSlots.includes(slot.id) ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 hover:border-blue-100'}`}>
                        <div className={`w-5 h-5 rounded-lg flex items-center justify-center border-2 transition-all ${copyData.selectedSlots.includes(slot.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>
                          {copyData.selectedSlots.includes(slot.id) && <CheckCircle2 size={12} />}
                        </div>
                        <input
                          type="checkbox"
                          className="hidden"
                          checked={copyData.selectedSlots.includes(slot.id)}
                          onChange={e => {
                            if (e.target.checked) setCopyData(prev => ({ ...prev, selectedSlots: [...prev.selectedSlots, slot.id] }));
                            else setCopyData(prev => ({ ...prev, selectedSlots: prev.selectedSlots.filter(id => id !== slot.id) }));
                          }}
                        />
                        <div className="flex-1">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black uppercase text-slate-700 dark:text-white">{slot.label}</span>
                            {slot.hasContent && <span className="text-[8px] font-bold text-amber-500 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded uppercase">Já possui registro</span>}
                          </div>
                          <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">{slot.time}</p>
                        </div>
                      </label>
                    )) : (
                      <div className="text-center py-8 text-slate-400 text-xs font-bold bg-slate-50 dark:bg-slate-800 rounded-xl border border-dashed border-slate-200">
                        Nenhuma aula encontrada para esta data.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 shrink-0 grid grid-cols-2 gap-3">
                <button onClick={() => setCopyData(prev => ({ ...prev, isOpen: false, selectedSlots: [] }))} className="py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-black uppercase text-[10px] tracking-tight hover:bg-slate-200 transition-all">Cancelar</button>
                <button onClick={handleCopyLesson} disabled={copyData.selectedSlots.length === 0} className="py-3 bg-blue-600 text-white rounded-xl font-black uppercase text-[10px] tracking-tight shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:opacity-50 disabled:shadow-none transition-all">Confirmar Cópia</button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Options Modal */}
        {showDeleteOptionsModal && activeLesson && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md shadow-2xl p-6 flex flex-col animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                  <Trash2 className="text-red-500" /> Excluir Registro
                </h3>
                <button onClick={() => setShowDeleteOptionsModal(false)} className="text-slate-300 hover:text-slate-600"><X /></button>
              </div>

              <p className="text-sm text-slate-600 dark:text-slate-400 mb-8 font-medium">
                O que você deseja fazer com esta aula?
              </p>

              <div className="space-y-3">
                <button
                  onClick={() => {
                    const existingLog = data.logs.find(l =>
                      l.date === activeLesson.date &&
                      ((l.schoolId === activeLesson.institution.id && l.slotId === activeLesson.schedule.slotId) ||
                        (l.id === activeLesson.schedule.slotId))
                    ) || data.logs.find(l => l.date.startsWith(activeLesson.date) && l.schoolId === activeLesson.institution.id && l.slotId === activeLesson.schedule.slotId);

                    const isScheduled = activeLesson.type === 'school' && activeLesson.schedule.shiftId !== 'extra';
                    const isWindow = activeLesson.schedule.classId === 'window';

                    if (existingLog) {
                      // Hard delete the log so the slot becomes "Pending" again
                      const updatedLogs = data.logs.filter(l => l.id !== existingLog.id);
                      onUpdateData({ logs: updatedLogs as any });
                    }

                    setShowDeleteOptionsModal(false);
                    setLogForm({ subject: '', homework: '', notes: '', occurrences: [], attendance: [] }); // Clear local form
                    showSuccess(isWindow ? 'Janela restaurada.' : 'Conteúdo da aula limpo com sucesso.');
                  }}
                  className="w-full p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 group transition-all text-left"
                >
                  <div className="font-black text-slate-700 dark:text-white uppercase text-xs mb-1 group-hover:text-blue-600">{activeLesson.schedule.classId === 'window' ? 'Restaurar Janela' : 'Limpar Conteúdo'}</div>
                  <div className="text-[10px] text-slate-500 font-medium">{activeLesson.schedule.classId === 'window' ? 'Remove qualquer registro e mantém como janela.' : 'Mantém a aula na grade, mas remove texto, chamada e ocorrências.'}</div>
                </button>

                <button
                  onClick={() => {
                    // Logic for "Excluir Aula" (Remove from Grid/Cancel)
                    const existingLog = data.logs.find(l =>
                      l.date === activeLesson.date &&
                      ((l.schoolId === activeLesson.institution.id && l.slotId === activeLesson.schedule.slotId) ||
                        (l.id === activeLesson.schedule.slotId))
                    ) || data.logs.find(l => l.date.startsWith(activeLesson.date) && l.schoolId === activeLesson.institution.id && l.slotId === activeLesson.schedule.slotId);

                    const isScheduled = activeLesson.type === 'school' && activeLesson.schedule.shiftId !== 'extra';
                    let updatedLogs: LessonLog[];

                    if (isScheduled) {
                      // Soft delete: Mark as 'removed'
                      if (existingLog) {
                        updatedLogs = data.logs.map(l => l.id === existingLog.id ? { ...l, status: 'removed', subject: '', homework: '', notes: '', occurrences: [], attendance: [] } : l);
                      } else {
                        // Create new "removed" log
                        const newRemovedLog: LessonLog = {
                          id: crypto.randomUUID(),
                          date: new Date(activeLesson.date + 'T00:00:00').toISOString(),
                          schoolId: activeLesson.institution.id,
                          classId: activeLesson.type === 'school' ? activeLesson.schedule.classId : activeLesson.institution.name,
                          slotId: activeLesson.schedule.slotId,
                          subject: '', homework: '', notes: '', occurrences: [], attendance: [],
                          type: 'regular',
                          status: 'removed'
                        };
                        if (activeLesson.type === 'private') {
                          newRemovedLog.studentId = activeLesson.institution.id;
                          newRemovedLog.schoolId = '';
                        }
                        updatedLogs = [...data.logs, newRemovedLog];
                      }
                    } else {
                      // Hard delete for extra (removes it entirely)
                      if (existingLog) {
                        updatedLogs = data.logs.filter(l => l.id !== existingLog.id);
                      } else {
                        updatedLogs = [...data.logs];
                      }
                    }

                    onUpdateData({ logs: updatedLogs as any });
                    setShowDeleteOptionsModal(false);
                    setActiveLesson(null); // Return to grid
                    showSuccess('Item excluído da visualização.');
                  }}
                  className="w-full p-4 rounded-xl border-2 border-red-100 dark:border-red-900/30 hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 group transition-all text-left"
                >
                  <div className="font-black text-slate-700 dark:text-white uppercase text-xs mb-1 group-hover:text-red-500">Excluir {activeLesson.schedule.classId === 'window' ? 'Janela' : 'Aula'}</div>
                  <div className="text-[10px] text-slate-500 font-medium">Remove este item da grade diária.</div>
                </button>
              </div>
            </div>
          </div>
        )
        }

      </div >
    );
  }

  // Quick Save for Inline Editing
  const handleQuickSave = async (
    newContent: string,
    schedule: ScheduleEntry,
    date: string,
    existingLog?: LessonLog,
    contextId?: string // New parameter from EditableContentField
  ): Promise<string | void> => {
    // 1. Determine the effective Log ID to update
    // Priority: contextId (just created) > existingLog.id (passed prop) > undefined (create new)
    const logIdToUpdate = contextId || existingLog?.id;
    let finalLogId = logIdToUpdate;

    // Optimistic Update / Data Preparation
    let updatedLogs = [...data.logs];

    // Check if we can find the log in the CURRENT data (in case existingLog prop is stale)
    const freshLog = data.logs.find(l =>
      l.id === logIdToUpdate ||
      (l.date === date && l.slotId === schedule.slotId && (l.schoolId === schedule.schoolId || l.studentId === schedule.schoolId) && l.status !== 'removed')
    );

    if (freshLog) {
      // Update existing log (UPSERT STRATEGY: Prefer update if ANY match found)
      updatedLogs = updatedLogs.map(l =>
        l.id === freshLog.id ? { ...l, subject: newContent } : l
      );
      finalLogId = freshLog.id;
    } else {
      // Create new log (for Future/Planned items)
      // Determine IDs
      let shiftId = schedule.shiftId;
      let slotId = schedule.slotId;
      let slotStartTime = '';
      let slotEndTime = '';

      // Find Slot Times (Crucial for Planning)
      if (schedule.shiftId === 'private') {
        const student = data.students.find(s => s.id === schedule.schoolId);
        const pSlot = student?.schedules?.find(s => s.id === schedule.slotId);
        if (pSlot) {
          slotStartTime = pSlot.startTime;
          slotEndTime = pSlot.endTime;
        }
      } else if (schedule.shiftId !== 'extra' && 'shifts' in (data.schools.find(s => s.id === schedule.schoolId) || {})) {
        const school = data.schools.find(s => s.id === schedule.schoolId);
        const shift = school?.shifts.find(s => s.id === schedule.shiftId);
        const slot = shift?.slots.find(s => s.id === schedule.slotId);
        if (slot) {
          slotStartTime = slot.startTime;
          slotEndTime = slot.endTime;
        }
      }

      finalLogId = crypto.randomUUID();
      const newLog: LessonLog = {
        id: finalLogId,
        date,
        schoolId: schedule.shiftId === 'private' ? '' : schedule.schoolId,
        studentId: schedule.shiftId === 'private' ? schedule.schoolId : undefined,
        classId: schedule.classId,
        slotId: slotId,
        subject: newContent,
        homework: '',
        notes: '',
        occurrences: [],
        type: 'regular',
        startTime: slotStartTime,
        endTime: slotEndTime,
        status: 'active'
      };

      updatedLogs.push(newLog);
    }

    // Persist
    onUpdateData({ logs: updatedLogs });

    // Return the ID so the UI can lock onto it
    return finalLogId;
  };

  // ... (Restante do arquivo mantido, renderização do grid) ...
  return (
    <div className="space-y-4 md:space-y-6 max-w-6xl mx-auto pb-20">
      {viewMode === 'day' && pendingLessons.length > 0 && !data.settings.hideUnregisteredClassesOnDiary && (
        <button onClick={() => setShowPendencies(!showPendencies)} className={`w-full flex items-center justify-between p-4 md:p-5 rounded-xl md:rounded-2xl border-2 transition-all shadow-md hover:shadow-lg ${showPendencies ? 'bg-red-600 text-white border-red-700' : 'bg-white dark:bg-slate-900 border-red-100 dark:border-red-900/30'}`}>
          <div className="flex items-center gap-4">
            <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center ${showPendencies ? 'bg-white/20' : 'bg-red-50 dark:bg-red-900/40 text-red-600'}`}>
              <AlertTriangle size={20} className="md:w-6 md:h-6" />
            </div>
            <div className="text-left">
              <span className={`text-[8px] md:text-[10px] font-black uppercase block mb-0.5 md:mb-1 ${showPendencies ? 'text-white/80' : 'text-slate-500'}`}>Atenção Necessária</span>
              <p className={`text-xs md:text-sm font-black uppercase ${showPendencies ? 'text-white' : 'text-red-600'}`}>Você tem {pendingLessons.length} registros pendentes.</p>
            </div>
          </div>
          <ChevronRight className={`transition-transform ${showPendencies ? 'rotate-90' : 'text-slate-300'}`} />
        </button>
      )}

      {viewMode === 'day' && showPendencies && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 animate-in slide-in-from-top-4">
          {pendingLessons.map((item, idx) => (
            <button key={idx} onClick={() => handleOpenLog(item.schedule, item.date)} className="flex items-center gap-3 md:gap-4 p-4 md:p-5 bg-white dark:bg-slate-900 border-2 border-red-50 dark:border-red-900/10 rounded-xl md:rounded-2xl text-left hover:border-red-200 transition-colors group">
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
      <div className="flex bg-white dark:bg-slate-900 p-1 md:p-1.5 rounded-xl md:rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm w-full overflow-hidden">
        {[{ id: 'day', label: 'Diário', icon: History }, { id: 'registered', label: 'Histórico', icon: CheckCircle2 }, { id: 'future', label: 'Planejamento', icon: CalendarDays }].map(tab => (
          <button key={tab.id} onClick={() => setViewMode(tab.id as any)} className={`flex-1 flex items-center justify-center gap-2 px-2 md:px-4 py-2.5 md:py-3 rounded-2xl text-[9px] md:text-[10px] font-black uppercase transition-all ${viewMode === tab.id ? 'bg-primary text-white shadow-lg' : 'text-slate-500'}`}><tab.icon size={14} className="md:w-3.5 md:h-3.5" /> {tab.label}</button>
        ))}
      </div>


      {viewMode !== 'day' && (
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-2">
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

          {/* Stats e Toggle juntos */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-50 dark:border-slate-800">
            {/* Estatísticas */}
            {/* Estatísticas (Compacto) */}
            <div className="flex items-center gap-2 md:gap-3 bg-slate-50 dark:bg-slate-800/60 py-2 px-3 md:px-4 rounded-xl border border-slate-100 dark:border-slate-800">
              <BarChart2 size={14} className="text-slate-400" />
              <div className="flex items-center gap-2 md:gap-3 text-[9px] md:text-[10px] font-black uppercase tracking-wide text-slate-500">
                <div className="flex items-center gap-1">
                  <span>Programadas:</span>
                  <span className="text-slate-800 dark:text-white">{viewMode === 'registered' ? stats.totalPastPlanned : lessonStats.totalGeneralPlanned}</span>
                </div>
                <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600"></div>
                <div className="flex items-center gap-1">
                  <span>{viewMode === 'registered' ? 'Registradas' : 'Planejadas'}:</span>
                  <span className="text-primary">{viewMode === 'registered' ? stats.loggedPast : lessonStats.loggedFuture}</span>
                </div>
              </div>
            </div>

            {/* Filtros de Conteúdo */}
            <div className="flex gap-2 bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl items-center">
              <button
                onClick={() => setShowWithoutContent(!showWithoutContent)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase transition-all ${showWithoutContent ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-sm border border-slate-200 dark:border-slate-600' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <div className={`w-3 h-3 rounded border flex items-center justify-center ${showWithoutContent ? 'bg-primary border-primary' : 'border-slate-300'}`}>
                  {showWithoutContent && <CheckCircle2 size={8} className="text-white" />}
                </div>
                <span>Sem Conteúdo</span>
              </button>
              <button
                onClick={() => setShowWithContent(!showWithContent)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase transition-all ${showWithContent ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-sm border border-slate-200 dark:border-slate-600' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <div className={`w-3 h-3 rounded border flex items-center justify-center ${showWithContent ? 'bg-primary border-primary' : 'border-slate-300'}`}>
                  {showWithContent && <CheckCircle2 size={8} className="text-white" />}
                </div>
                <span>Com Conteúdo</span>
              </button>
            </div>

            {/* Toggle de Visualização */}
            <div className="flex gap-2 items-center">
              {/* BULK EDIT TOGGLE - Separated Group */}
              {((viewMode === 'future' && futureViewType === 'list') || (viewMode === 'registered' && historyViewType === 'list')) && (
                <div className="flex bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl items-center mr-2">
                  <button
                    onClick={() => setIsBulkEditMode(!isBulkEditMode)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase transition-all ${isBulkEditMode ? 'bg-indigo-500 text-white shadow-md ring-2 ring-indigo-200' : 'text-indigo-500 bg-indigo-50 hover:bg-indigo-100'}`}
                  >
                    <Edit3 size={13} /> <span>{isBulkEditMode ? 'Salvar Edição' : 'Modo Edição'}</span>
                  </button>
                </div>
              )}

              {/* View & Sort Options */}
              <div className="flex gap-2 bg-slate-50 dark:bg-slate-800 p-1 rounded-2xl items-center">
                {viewMode === 'future' ? (
                  <>
                    {futureViewType === 'list' && (
                      <>
                        <button
                          onClick={() => setFutureSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase transition-all text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                          title={futureSortOrder === 'asc' ? 'Mais Antigos Primeiro' : 'Mais Recentes Primeiro'}
                        >
                          {futureSortOrder === 'asc' ? <ArrowUpNarrowWide size={14} /> : <ArrowDownWideNarrow size={14} />}
                        </button>
                        <DensitySelector />
                      </>
                    )}
                    <button
                      onClick={() => setFutureViewType('list')}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase transition-all ${futureViewType === 'list' ? 'bg-primary text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <LayoutList size={13} /> <span>Lista</span>
                    </button>
                    <button
                      onClick={() => setFutureViewType('calendar')}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase transition-all ${futureViewType === 'calendar' ? 'bg-primary text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <CalendarDays size={13} /> <span>Calendário</span>
                    </button>
                  </>
                ) : (
                  <>
                    {historyViewType === 'list' && (
                      <>
                        <button
                          onClick={() => setHistorySortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase transition-all text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                          title={historySortOrder === 'asc' ? 'Mais Antigos Primeiro' : 'Mais Recentes Primeiro'}
                        >
                          {historySortOrder === 'asc' ? <ArrowUpNarrowWide size={14} /> : <ArrowDownWideNarrow size={14} />}
                        </button>
                        <DensitySelector />
                      </>
                    )}
                    <button
                      onClick={() => setHistoryViewType('list')}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase transition-all ${historyViewType === 'list' ? 'bg-primary text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <LayoutList size={13} /> <span>Lista</span>
                    </button>
                    <button
                      onClick={() => setHistoryViewType('calendar')}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] md:text-[10px] font-black uppercase transition-all ${historyViewType === 'calendar' ? 'bg-primary text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <CalendarDays size={13} /> <span>Calendário</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )
      }



      <div className="space-y-6">
        {viewMode === 'day' && (
          <div className="w-full">
            {/* Navegação de Dias */}
            <div className="mb-4 md:mb-6 flex items-center justify-between gap-2 md:gap-4">
              <button
                onClick={handlePrevDay}
                disabled={selectedDate <= activeCalendarRange.start}
                className={`p-3 md:p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 transition-colors shadow-sm ${selectedDate <= activeCalendarRange.start ? 'opacity-50 cursor-not-allowed text-slate-300' : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 hover:text-primary'}`}
              >
                <ChevronLeft size={20} />
              </button>

              <div className={`flex-1 flex flex-col items-center justify-center p-3 md:p-4 rounded-xl border-2 transition-all ${isFutureDate ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-100 dark:border-purple-800/50' : selectedDate < getYYYYMMDD(new Date()) ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800/50' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 shadow-sm'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <CalendarDays size={14} className={isFutureDate ? "text-purple-500" : selectedDate < getYYYYMMDD(new Date()) ? "text-amber-500" : "text-slate-400"} />
                  <span className={`text-[9px] font-black uppercase tracking-tight ${isFutureDate ? 'text-purple-600 dark:text-purple-300' : selectedDate < getYYYYMMDD(new Date()) ? 'text-amber-600 dark:text-amber-300' : 'text-slate-400 dark:text-slate-500'}`}>
                    {isFutureDate ? 'Modo Planejamento' : selectedDate < getYYYYMMDD(new Date()) ? 'Modo Histórico' : 'Visualização Diária'}
                  </span>
                </div>
                <h3 className={`text-sm md:text-lg font-black uppercase ${isFutureDate ? 'text-purple-700 dark:text-purple-200' : selectedDate < getYYYYMMDD(new Date()) ? 'text-amber-700 dark:text-amber-200' : 'text-slate-800 dark:text-white'}`}>
                  {new Date(selectedDate + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                </h3>
                {selectedDate !== getYYYYMMDD(new Date()) && (
                  <button onClick={() => setSelectedDate(getYYYYMMDD(new Date()))} className="mt-1 flex items-center gap-1 text-[9px] font-black uppercase text-blue-500 hover:text-blue-600 transition-colors">
                    <RotateCcw size={10} /> Voltar para Hoje
                  </button>
                )}
              </div>

              <button
                onClick={handleNextDay}
                disabled={selectedDate >= activeCalendarRange.end}
                className={`p-3 md:p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 transition-colors shadow-sm ${selectedDate >= activeCalendarRange.end ? 'opacity-50 cursor-not-allowed text-slate-300' : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 hover:text-primary'}`}
              >
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Grid Diário Panorâmico */}
            <div className="flex flex-col md:flex-row gap-4 md:gap-4 w-full">
              {integratedPanoramicColumns.sortedKeys.length > 0 ? integratedPanoramicColumns.sortedKeys.map(key => (
                <div key={key} className="flex-1 w-full space-y-2 md:space-y-3 min-w-0">
                  <div className="flex items-center gap-2 md:gap-3 px-2 py-1.5 md:px-4 md:py-2 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                    <Clock size={12} className="text-primary md:w-3.5 md:h-3.5" />
                    <h3 className="text-[9px] md:text-[10px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-tight">{key}</h3>
                    <span className="ml-auto text-[7px] md:text-[8px] font-black bg-white dark:bg-slate-700 text-slate-500 px-2 py-0.5 rounded-lg">
                      {integratedPanoramicColumns.groupedShifts[key].length} Aulas
                    </span>
                  </div>

                  <div className="space-y-0.5 md:space-y-1 p-0.5">
                    {integratedPanoramicColumns.groupedShifts[key].map((item, idx) => (
                      <div
                        key={idx}
                        role="button"
                        tabIndex={item.slot.type === 'break' || item.isFree ? -1 : 0}
                        style={{ cursor: (item.slot.type === 'break' || item.isFree) ? 'default' : 'pointer' }}
                        onClick={() => {
                          if (item.slot.type === 'break' || item.isFree) return;
                          item.schedule && handleOpenLog(item.schedule, selectedDate);
                        }}
                        onKeyDown={(e) => {
                          if (isBulkEditMode) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            if (item.slot.type === 'break' || item.isFree) return;
                            e.preventDefault();
                            item.schedule && handleOpenLog(item.schedule, selectedDate);
                          }
                        }}
                        className={`w-full flex items-center gap-1.5 md:gap-2 p-1.5 md:p-2 rounded-lg md:rounded-xl border-2 transition-all text-left group relative ${(item as any).isExtra && item.log?.type !== 'regular' ? 'ring-2 ring-indigo-400 dark:ring-indigo-600 ring-offset-1' : ''
                          } ${item.slot.type === 'break' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-900/30' : item.isFree ? 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 opacity-60 grayscale' : item.isActive ? 'bg-primary/5 border-primary shadow-lg scale-[1.02] z-10' : item.isWindow ? 'bg-slate-200 dark:bg-slate-800/80 border-slate-300 dark:border-slate-600 shadow-sm' : item.log ? (isFutureDate ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800 border-dashed' : 'bg-white dark:bg-slate-900 border-green-100 dark:border-green-900/20') : 'bg-white dark:bg-slate-900 border-slate-50 dark:border-slate-800 hover:border-blue-100'}`}
                      >
                        {/* Badge para aulas extras (Exceto Regular) */}
                        {(item as any).isExtra && item.log?.type !== 'regular' && (
                          <span className="absolute top-1 right-1 bg-indigo-500 text-white text-[6px] font-black px-1.5 py-0.5 rounded-full uppercase flex items-center gap-0.5 shadow-md">
                            {item.log?.type === 'extra' ? <><BookPlus size={8} /> Extra</> : <><Replace size={8} /> Subst</>}
                          </span>
                        )}

                        <div className="w-6 h-6 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center text-white font-black text-[10px] md:text-sm shadow-md shrink-0" style={{ backgroundColor: item.inst.color }}>
                          {item.inst.name[0]}
                        </div>
                        <div className="overflow-hidden flex-1 min-w-0">
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <h4 className={`font-black uppercase text-[10px] md:text-xs truncate leading-tight ${item.isActive ? 'text-primary' : item.isWindow ? 'text-slate-600 dark:text-slate-300' : 'text-slate-800 dark:text-white'}`}>{item.label}</h4>
                              {item.isActive && <span className="flex items-center gap-1 bg-primary text-white text-[6px] md:text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tight"><PlayCircle size={8} fill="currentColor" /> Agora</span>}
                            </div>
                            <span className="text-[7px] md:text-[8px] font-black text-slate-400 dark:text-slate-600 uppercase shrink-0">{item.slot.startTime}</span>
                          </div>

                          {isFutureDate && item.log && (
                            <div
                              className="mt-1.5 mb-1 px-1 py-0.5 rounded-lg bg-purple-100 dark:bg-purple-900/40 border border-purple-200 dark:border-purple-800 overflow-visible max-w-full min-w-0"
                              onClick={(e) => isBulkEditMode && e.stopPropagation()}
                            >
                              <p className="text-[7px] md:text-[8px] font-black text-purple-700 dark:text-purple-300 uppercase tracking-tight mb-0.5 ml-1">Planejado:</p>
                              <EditableContentField
                                initialValue={item.log.subject}
                                onSave={(val, ctxId) => handleQuickSave(val, item.schedule, item.date, item.log, ctxId)} // Pass ctxId
                                isBulkEditing={isBulkEditMode}
                              />
                            </div>
                          )}

                          <div className="flex justify-between items-center mt-0.5 md:mt-1">
                            <div className="flex items-center gap-2">
                              {item.slot.type === 'break' ? (
                                <span className="text-[10px] md:text-xs font-black text-slate-500 uppercase flex items-center gap-1">
                                  <Coffee size={12} className="text-amber-600" /> Intervalo
                                </span>
                              ) : (
                                <>
                                  <span className="text-[7px] md:text-[8px] font-bold text-slate-500 truncate max-w-[80px]">{item.inst.name}</span>
                                  <span className="text-[9px] md:text-[11px] font-black text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg uppercase tracking-tight">
                                    {idx + 1}ª Aula
                                  </span>
                                </>
                              )}
                            </div>
                            <div className={`flex items-center gap-1 text-[7px] font-black uppercase ${item.slot.type === 'break' ? 'hidden' : item.isFree ? 'text-slate-500' : item.isWindow ? 'text-slate-500' : item.log ? (isFutureDate ? 'text-purple-500' : 'text-green-500') : (isFutureDate || (selectedDate === getYYYYMMDD(new Date()) && currentTime < (item as any).endTimeMin)) ? 'text-slate-400' : 'text-blue-500'}`}>
                              {item.log ? <CheckCircle2 size={10} /> : null}
                              {
                                item.slot.type === 'break' ? '' :
                                  item.isFree ? 'Livre' :
                                    item.isWindow ? 'Janela' :
                                      item.log ? (isFutureDate ? 'Planejado' : 'OK') :
                                        (isFutureDate || (selectedDate === getYYYYMMDD(new Date()) && currentTime < (item as any).startTimeMin)) ? 'Agendada' :
                                          (selectedDate === getYYYYMMDD(new Date()) && currentTime >= (item as any).startTimeMin && currentTime < (item as any).endTimeMin) ? 'Em aula' :
                                            'Pendente'
                              }
                            </div>
                          </div>
                        </div>
                      </div>
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

            {/* Self-Healing: Remove Duplicate Logs on Mount */}


            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
              {/* OPÇÃO 1: AULA REGULAR (Para reposições ou aulas manuais que DEVEM contar na carga horária) */}
              <button
                onClick={() => handleAddLesson('regular')}
                className="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 hover:bg-slate-50 hover:text-slate-600 hover:border-slate-400 transition-all group"
              >
                <Plus size={18} className="group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-black uppercase tracking-tight">Adicionar Aula Regular</span>
              </button>

              {/* OPÇÃO 2: AULA EXTRA (Para reforço, eventos ou substituições) */}
              <button
                onClick={() => handleAddLesson('extra')}
                className="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 hover:bg-slate-50 hover:text-slate-600 hover:border-slate-400 transition-all group"
              >
                <Plus size={18} className="group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-black uppercase tracking-tight">Aula Extra / Substituição</span>
              </button>
            </div>
          </div>
        )}

        {viewMode === 'future' && futureViewType === 'calendar' && (
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
                // Determine global max date from all calendars
                const globalMax = data.calendars.length > 0
                  ? data.calendars.map(c => c.end).sort().pop()
                  : null;

                const maxDateObj = globalMax ? new Date(globalMax + 'T00:00:00') : new Date(now.getFullYear() + 1, 11, 31);

                for (let i = 0; i < 12; i++) {
                  const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
                  if (d > maxDateObj) break;
                  monthsToShow.push(d);
                }
              }
              const globalLimit = data.calendars.map(c => c.end).sort().pop();
              return monthsToShow.map((m, idx) => <div key={idx}>{renderMiniCalendar(m, globalLimit)}</div>);
            })()}
          </div>
        )}

        {viewMode === 'future' && futureViewType === 'list' && (
          <div className="space-y-8">
            {(() => {
              const futureLessons: any[] = [];
              const now = new Date();
              const todayStr = getYYYYMMDD(now);

              const activeTerm = filterInstId !== 'all' && filterPeriodIdx !== 'all'
                ? data.calendars.find(c => c.schoolId === filterInstId)?.terms[Number(filterPeriodIdx)]
                : null;

              // Calcular todas as aulas futuras
              const globalLimit = data.calendars.map(c => c.end).sort().pop();

              for (let i = 0; i < 365; i++) {
                const checkDate = new Date();
                checkDate.setDate(now.getDate() + i);
                const dateStr = getYYYYMMDD(checkDate);
                const dayOfWeek = checkDate.getDay() as DayOfWeek;

                if (isHoliday(checkDate)) continue;
                if (activeTerm && (dateStr < activeTerm.start || dateStr > activeTerm.end)) continue;
                if (globalLimit && dateStr > globalLimit) break;

                // Get versioned schedules for this date
                const dailySchedules = getSchedulesForDate(data, dateStr);
                dailySchedules.forEach(s => {
                  if (Number(s.dayOfWeek) !== dayOfWeek || s.classId === 'window') return;
                  if (filterInstId !== 'all' && s.schoolId !== filterInstId) return;
                  if (filterClassId !== 'all' && s.classId !== filterClassId) return;

                  const school = data.schools.find(sc => sc.id === s.schoolId);
                  if (!school) return;

                  if (isLessonBlocked(dateStr, s.schoolId, s.shiftId, s.classId)) return;

                  const slot = school.shifts.find(sh => sh.id === s.shiftId)?.slots.find(sl => sl.id === s.slotId);
                  if (!slot) return;

                  const calendar = data.calendars.find(c => c.schoolId === s.schoolId);
                  if (calendar) {
                    if (calendar.start && dateStr < calendar.start) return;
                    if (calendar.end && dateStr > calendar.end) return;
                  }

                  let log = data.logs.find(l => l.date.startsWith(dateStr) && l.slotId === s.slotId && l.schoolId === s.schoolId);

                  // FALLBACK: If Strict Slot ID match fails, try finding by Time/Class Match
                  if (!log) {
                    log = data.logs.find(l =>
                      l.date.startsWith(dateStr) &&
                      l.schoolId === s.schoolId &&
                      l.classId === s.classId &&
                      l.startTime === slot!.startTime
                    );
                  }

                  if (log && log.status === 'removed') return;

                  // Content Filters
                  if (log && !showWithContent) return;
                  if (!log && !showWithoutContent) return;

                  futureLessons.push({
                    schedule: s,
                    log,
                    date: dateStr,
                    institution: school,
                    slot,
                    dayOfWeek
                  });
                });

                if (data.settings.isPrivateTeacher) {
                  data.students.forEach(st => {
                    if (filterInstId !== 'all' && st.id !== filterInstId) return;
                    if (filterClassId !== 'all' && st.name !== filterClassId) return;
                    if (dateStr < st.startDate) return;
                    if (isLessonBlocked(dateStr, st.id)) return;

                    st.schedules.filter(ps => Number(ps.dayOfWeek) === dayOfWeek).forEach(ps => {
                      const log = data.logs.find(l => l.date.startsWith(dateStr) && l.slotId === ps.id && l.studentId === st.id);

                      if (log && log.status === 'removed') return;

                      // Content Filters
                      if (log && !showWithContent) return;
                      if (!log && !showWithoutContent) return;

                      futureLessons.push({
                        schedule: { dayOfWeek, schoolId: st.id, shiftId: 'private', slotId: ps.id, classId: st.name },
                        log,
                        date: dateStr,
                        institution: st,
                        slot: { id: ps.id, startTime: ps.startTime, endTime: ps.endTime, label: 'Particular', type: 'class' as const },
                        dayOfWeek
                      });
                    });
                  });
                }
              }

              // Agrupar por semana
              const groupedByWeek: Record<string, any[]> = {};
              futureLessons.forEach(lesson => {
                const date = new Date(lesson.date + 'T00:00:00');
                const weekStart = getWeekStart(date);
                const weekKey = weekStart.toISOString().split('T')[0];

                if (!groupedByWeek[weekKey]) {
                  groupedByWeek[weekKey] = [];
                }
                groupedByWeek[weekKey].push(lesson);
              });

              // Ordenar semanas e aulas dentro de cada semana
              const sortedWeeks = Object.keys(groupedByWeek).sort((a, b) =>
                futureSortOrder === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
              );

              if (sortedWeeks.length === 0) {
                return (
                  <div className="py-20 text-center">
                    <CalendarRange className="mx-auto mb-2 text-slate-300" size={32} />
                    <p className="text-[10px] font-black uppercase text-slate-500">Nenhuma aula futura encontrada para este período.</p>
                  </div>
                );
              }

              return sortedWeeks.map(weekKey => {
                const weekLessons = groupedByWeek[weekKey].sort((a, b) => {
                  if (a.date !== b.date) {
                    return futureSortOrder === 'asc'
                      ? a.date.localeCompare(b.date)
                      : b.date.localeCompare(a.date);
                  }
                  return parseTimeToMinutes(a.slot.startTime) - parseTimeToMinutes(b.slot.startTime);
                });

                return (
                  <div key={weekKey} className="space-y-4">
                    <div className="flex items-center gap-3">
                      <CalendarRange className="text-primary" size={16} />
                      <h3 className="text-sm font-black uppercase text-slate-600 dark:text-slate-300 tracking-tight">
                        Semana de {formatWeekRange(weekKey)}
                      </h3>
                      <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700"></div>
                      <span className="text-[9px] font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
                        {weekLessons.length} aulas
                      </span>
                    </div>

                    <div className={`grid gap-4 ${getGridClass(gridColumns)}`}>
                      {weekLessons.map((item, idx) => {
                        // Calcular turno e número da aula
                        const startMin = parseTimeToMinutes(item.slot.startTime);
                        let shiftName = 'Particular';
                        let lessonNumber = 1;

                        if (item.schedule.shiftId !== 'private' && 'shifts' in item.institution) {
                          const shift = item.institution.shifts.find(sh => sh.id === item.schedule.shiftId);
                          if (shift) {
                            shiftName = shift.name;
                            // Calcular número da aula dentro do turno
                            const classSlots = shift.slots.filter(s => s.type === 'class');
                            lessonNumber = classSlots.findIndex(s => s.id === item.schedule.slotId) + 1;
                          }
                        } else if (startMin < 720) {
                          shiftName = 'Matutino';
                        } else if (startMin < 1080) {
                          shiftName = 'Vespertino';
                        } else {
                          shiftName = 'Noturno';
                        }

                        return (
                          <button
                            key={idx}
                            onClick={() => handleOpenLog(item.schedule, item.date)}
                            className={`bg-white dark:bg-slate-900 p-5 rounded-xl border-2 transition-all text-left hover:shadow-lg relative overflow-hidden min-w-0 ${item.log ? 'border-purple-200 dark:border-purple-800' : 'border-blue-100 dark:border-blue-900/20 hover:border-blue-200'}`}
                          >
                            {/* Barra colorida da escola */}
                            <div className="absolute top-0 left-0 right-0 h-1" style={{ backgroundColor: item.institution.color }}></div>

                            <div className="flex items-center gap-3 mb-3">
                              <div
                                className="w-12 h-12 rounded-xl flex flex-col items-center justify-center text-white font-black shadow-md border-b-2"
                                style={{
                                  backgroundColor: item.institution.color,
                                  borderColor: item.institution.color,
                                  filter: 'brightness(0.9)'
                                }}
                              >
                                <span className="text-[8px] uppercase">{DAYS_OF_WEEK_NAMES[item.dayOfWeek].slice(0, 3)}</span>
                                <span className="text-xs">{new Date(item.date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                              </div>
                              <div className="flex-1 overflow-hidden">
                                <div className="flex items-center justify-between gap-2">
                                  <h4 className="text-sm font-black uppercase truncate text-slate-800 dark:text-white">{item.schedule.classId}</h4>
                                  <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">
                                    {shiftName === 'Extra' || shiftName === 'Particular' ? item.slot.startTime : `${lessonNumber}ª aula`}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between gap-2 mt-0.5">
                                  <p className="text-[9px] font-bold text-slate-500 uppercase truncate">{item.institution.name}</p>
                                  <p className="text-[9px] font-bold text-slate-400 uppercase truncate">{shiftName}</p>
                                </div>
                              </div>
                            </div>

                            <div
                              className={`p-3 rounded-xl border overflow-visible max-w-full ${item.log ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800 border-dashed'}`}
                              onClick={(e) => {
                                // Prevent opening modal if clicking on editable field
                                if (isBulkEditMode || !item.log) e.stopPropagation();
                              }}
                            >
                              {item.log && <p className="text-[9px] font-black text-purple-600 dark:text-purple-300 uppercase mb-1">Planejado:</p>}
                              <EditableContentField
                                initialValue={item.log?.subject || ''}
                                onSave={(val, ctxId) => handleQuickSave(val, item.schedule, item.date, item.log, ctxId)} // Pass ctxId
                                isBulkEditing={isBulkEditMode}
                                isPlaceholder={!item.log}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        )}

        {viewMode === 'registered' && historyViewType === 'list' && (
          <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            {historyItems.length === 0 ? (
              <div className="py-20 text-center">
                <History className="mx-auto mb-2 text-slate-300" size={32} />
                <p className="text-[10px] font-black uppercase text-slate-500">Nenhum histórico encontrado para este período.</p>
              </div>
            ) : (
              (() => {
                const groupedByWeek: Record<string, any[]> = {};
                historyItems.forEach(lesson => {
                  const date = new Date(lesson.date + 'T00:00:00');
                  const weekStart = getWeekStart(date);
                  const weekKey = weekStart.toISOString().split('T')[0];

                  if (!groupedByWeek[weekKey]) {
                    groupedByWeek[weekKey] = [];
                  }
                  groupedByWeek[weekKey].push(lesson);
                });

                const sortedWeeks = Object.keys(groupedByWeek).sort((a, b) =>
                  historySortOrder === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
                );

                return sortedWeeks.map(weekKey => {
                  const weekLessons = groupedByWeek[weekKey].sort((a, b) => {
                    if (a.date !== b.date) {
                      return historySortOrder === 'asc'
                        ? a.date.localeCompare(b.date)
                        : b.date.localeCompare(a.date);
                    }
                    const timeA = parseTimeToMinutes(a.slot.startTime);
                    const timeB = parseTimeToMinutes(b.slot.startTime);
                    return timeB - timeA;
                  });

                  return (
                    <div key={weekKey} className="space-y-4">
                      <div className="flex items-center gap-3">
                        <History className="text-primary" size={16} />
                        <h3 className="text-sm font-black uppercase text-slate-600 dark:text-slate-300 tracking-tight">
                          Semana de {formatWeekRange(weekKey)}
                        </h3>
                        <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700"></div>
                        <span className="text-[9px] font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
                          {weekLessons.length} aulas
                        </span>
                      </div>

                      <div className={`grid gap-4 ${getGridClass(gridColumns)}`}>
                        {weekLessons.map((item, idx) => {
                          const startMin = parseTimeToMinutes(item.slot.startTime);
                          let shiftName = 'Particular';
                          let lessonNumber = 1;
                          let isOfficialSlot = false;

                          if (item.schedule.shiftId !== 'private' && item.schedule.shiftId !== 'extra' && 'shifts' in item.institution) {
                            const shift = item.institution.shifts.find(sh => sh.id === item.schedule.shiftId);
                            if (shift) {
                              shiftName = shift.name;
                              const classSlots = shift.slots.filter(s => s.type === 'class');
                              lessonNumber = classSlots.findIndex(s => s.id === item.schedule.slotId) + 1;
                              isOfficialSlot = true;
                            } else {
                              // FALLBACK: If shiftId is 'regular' or not found, try to find slot in ANY shift
                              for (const shift of item.institution.shifts) {
                                const classSlots = shift.slots.filter(s => s.type === 'class');
                                const slotIdx = classSlots.findIndex(s => s.id === item.schedule.slotId);
                                if (slotIdx !== -1) {
                                  shiftName = shift.name;
                                  lessonNumber = slotIdx + 1;
                                  isOfficialSlot = true;
                                  break;
                                }
                              }
                            }
                          } else if (item.isExtra || item.schedule.shiftId === 'extra') {
                            let matchFound = false;
                            if ('shifts' in item.institution) {
                              for (const shift of item.institution.shifts) {
                                const slotIdx = shift.slots.filter(s => s.type === 'class').findIndex(s => s.startTime === item.slot.startTime);
                                if (slotIdx !== -1) {
                                  shiftName = shift.name;
                                  lessonNumber = slotIdx + 1;
                                  isOfficialSlot = true;
                                  matchFound = true;
                                  break;
                                }
                              }
                            }
                            if (!matchFound) {
                              if (startMin < 720) shiftName = 'Matutino';
                              else if (startMin < 1080) shiftName = 'Vespertino';
                              else shiftName = 'Noturno';
                            }
                          } else {
                            if (startMin < 720) shiftName = 'Matutino';
                            else if (startMin < 1080) shiftName = 'Vespertino';
                            else shiftName = 'Noturno';
                          }

                          return (
                            <div
                              key={idx}
                              role="button"
                              tabIndex={0}
                              onClick={() => handleOpenLog(item.schedule as any, item.date)}
                              onKeyDown={(e) => {
                                if (isBulkEditMode) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleOpenLog(item.schedule as any, item.date);
                                }
                              }}
                              className={`bg-white dark:bg-slate-900 p-5 rounded-xl border-2 transition-all text-left hover:shadow-lg relative overflow-hidden min-w-0 cursor-pointer ${item.log ? 'border-green-100 dark:border-green-900/20' : 'border-red-50 dark:border-red-900/10'}`}
                            >
                              <div className="absolute top-0 left-0 right-0 h-1" style={{ backgroundColor: item.institution?.color || '#999' }}></div>

                              <div className="flex items-center gap-3 mb-3">
                                <div
                                  className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center text-white font-black shadow-md border-b-2`}
                                  style={{
                                    backgroundColor: item.institution?.color || '#999',
                                    borderColor: item.institution?.color || '#999',
                                    filter: 'brightness(0.9)'
                                  }}
                                >
                                  <span className="text-[8px] uppercase">{DAYS_OF_WEEK_NAMES[item.dayOfWeek].slice(0, 3)}</span>
                                  <span className="text-xs">{new Date(item.date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                                </div>
                                <div className="flex-1 overflow-hidden">
                                  <div className="flex items-center justify-between gap-2">
                                    <h4 className="text-sm font-black uppercase truncate text-slate-800 dark:text-white">
                                      {(() => {
                                        if (item.institution && 'classes' in item.institution) {
                                          const cls = item.institution.classes.find(c => String(c.id) === String(item.schedule.classId));
                                          if (cls) return cls.name;
                                        }
                                        return item.schedule.classId;
                                      })()} {item.isExtra && '(Extra)'}
                                    </h4>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0">
                                      {!isOfficialSlot ? item.slot.startTime : `${lessonNumber}ª aula`}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2 mt-0.5">
                                    <p className="text-[9px] font-bold text-slate-500 uppercase truncate">{item.institution?.name}</p>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase truncate">{shiftName}</p>
                                  </div>
                                </div>
                              </div>

                              <div
                                className={`p-1 mt-2 rounded-xl text-[10px] font-bold italic truncate flex-1 min-w-0 ${item.log ? 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400' : 'bg-red-50/50 dark:bg-red-900/20 text-red-400 dark:text-red-300'}`}
                                onClick={(e) => {
                                  // Prevent opening modal if clicking on editable field OR if in bulk edit mode
                                  if (isBulkEditMode) e.stopPropagation();
                                }}
                              >
                                {
                                  // Always render EditableContentField to allow editing even for pending items
                                  // Pass isPlaceholder=true if no log exists to show "Registro Pendente" when not editing
                                  <EditableContentField
                                    initialValue={item.log?.subject || ''}
                                    onSave={(val, ctxId) => handleQuickSave(val, item.schedule, item.date, item.log, ctxId)} // Pass ctxId
                                    isBulkEditing={isBulkEditMode}
                                    isPlaceholder={!item.log}
                                  />
                                }
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()
            )}
          </div>
        )}

        {viewMode === 'registered' && historyViewType === 'calendar' && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {(() => {
              const now = new Date();
              const todayStr = getYYYYMMDD(now);
              const monthsToShow: Date[] = [];

              // Mostrar todos os meses passados dentro do calendário ativo ou últimos 12 meses
              const activeTerm = filterInstId !== 'all' && filterPeriodIdx !== 'all'
                ? data.calendars.find(c => c.schoolId === filterInstId)?.terms[Number(filterPeriodIdx)]
                : null;

              if (activeTerm && activeTerm.start) {
                const startDate = new Date(activeTerm.start + 'T00:00:00');
                const termEnd = new Date(activeTerm.end + 'T00:00:00');

                // Determine effective end date: min(termEnd, currentMonthEnd/now)
                // We compare month/year to enforce stopping at current month.
                const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const termEndMonth = new Date(termEnd.getFullYear(), termEnd.getMonth(), 1);

                const endDate = termEndMonth > currentMonth ? now : termEnd;

                let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

                while (cursor <= endDate) {
                  monthsToShow.push(new Date(cursor));
                  cursor.setMonth(cursor.getMonth() + 1);
                }
              } else {
                // Default: Earliest Term Start Date -> Now
                // Find the earliest start date among all calendars for the current year
                let earliestStart: Date | null = null;

                if (data.calendars && data.calendars.length > 0) {
                  data.calendars.forEach(cal => {
                    cal.terms.forEach(term => {
                      if (term.start) {
                        const termStart = new Date(term.start + 'T00:00:00');
                        // Consider any term starting in current year
                        if (termStart.getFullYear() === now.getFullYear()) {
                          if (!earliestStart || termStart < earliestStart) {
                            earliestStart = termStart;
                          }
                        }
                      }
                    });
                  });
                }

                // Fallback to Jan 1st if no registered terms found for this year
                const startOfYear = new Date(now.getFullYear(), 0, 1);

                // If we found an earliest start, perform a "Month Floor" (start from the 1st of that month)
                const startRef = earliestStart || startOfYear;
                const effectiveStart = new Date(startRef.getFullYear(), startRef.getMonth(), 1);

                let cursor = effectiveStart;

                // Safety
                if (cursor > now) cursor = now;

                while (cursor <= now) {
                  monthsToShow.push(new Date(cursor));
                  cursor.setMonth(cursor.getMonth() + 1);
                }
              }

              return monthsToShow.map((m, idx) => <div key={idx}>{renderMiniCalendar(m, todayStr)}</div>);
            })()}
          </div>
        )}
      </div>

      {/* Modal de Aula Extra / Substituição REIMPLEMENTADO */}
      {
        isExtraLessonModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-2xl p-6 md:p-8 w-full max-w-xl shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg md:text-xl font-black uppercase text-slate-800 dark:text-white">Registrar Aula Extra</h3>
                <button onClick={() => setIsExtraLessonModalOpen(false)} className="text-slate-300 hover:text-slate-600"><X /></button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => setExtraLessonForm({ ...extraLessonForm, type: 'extra' })} className={`py-4 rounded-xl font-black uppercase text-[10px] tracking-tight border-2 transition-all ${extraLessonForm.type === 'extra' ? 'bg-indigo-50 border-indigo-500 text-indigo-600 shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>Aula Extra</button>
                  <button onClick={() => setExtraLessonForm({ ...extraLessonForm, type: 'substitution' })} className={`py-4 rounded-xl font-black uppercase text-[10px] tracking-tight border-2 transition-all ${extraLessonForm.type === 'substitution' ? 'bg-amber-50 border-amber-500 text-amber-600 shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>Substituição</button>
                </div>

                <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed px-1 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  {extraLessonForm.type === 'extra' ? (
                    <span className="flex gap-2 items-start"><BookPlus size={14} className="text-indigo-500 shrink-0 mt-0.5" /> <span>A <strong>Aula Extra</strong> constará no seu diário de classe e contabiliza como conteúdo da sua disciplina.</span></span>
                  ) : (
                    <span className="flex gap-2 items-start"><Replace size={14} className="text-amber-500 shrink-0 mt-0.5" /> <span>Na <strong>Substituição</strong>, você realiza atividade de outra disciplina. O registro não é inserido no seu diário de classe, servindo apenas para histórico.</span></span>
                  )}
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Data</label>
                    <input type="date" value={extraLessonForm.date} onChange={e => setExtraLessonForm({ ...extraLessonForm, date: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Escola</label>
                    <select value={extraLessonForm.schoolId} onChange={e => setExtraLessonForm({ ...extraLessonForm, schoolId: e.target.value, classId: '', selectedSlotId: 'custom' })} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm">
                      <option value="">Selecione...</option>
                      {data.schools.filter(s => !s.deleted).sort((a, b) => a.name.localeCompare(b.name)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>

                {extraLessonForm.schoolId && (
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Turma</label>
                    <select value={extraLessonForm.classId} onChange={e => setExtraLessonForm({ ...extraLessonForm, classId: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm">
                      <option value="">Selecione...</option>
                      {data.schools.find(s => s.id === extraLessonForm.schoolId)?.classes.map(c => {
                        const cId = typeof c === 'string' ? c : c.id;
                        const cName = typeof c === 'string' ? c : c.name;
                        return <option key={cId} value={cId}>{cName}</option>;
                      })}
                    </select>
                  </div>
                )}

                {extraLessonForm.type === 'substitution' && (
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Disciplina Substituída</label>
                    <input type="text" value={extraLessonForm.substitutionSubject} onChange={e => setExtraLessonForm({ ...extraLessonForm, substitutionSubject: e.target.value })} className="w-full bg-amber-50 dark:bg-amber-900/10 border-none rounded-xl px-4 py-3 font-bold text-amber-700 dark:text-amber-400 text-sm" placeholder="Ex: Matemática, História..." />
                  </div>
                )}

                {extraLessonForm.schoolId && (
                  <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl">
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-tight mb-2">Horário da Aula</label>
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
                      <input type="time" value={extraLessonForm.startTime} onChange={e => setExtraLessonForm({ ...extraLessonForm, startTime: e.target.value, selectedSlotId: 'custom' })} className="flex-1 bg-white dark:bg-slate-700 border-none rounded-xl px-3 py-2 font-bold dark:text-white text-xs text-center" />
                      <span className="text-slate-300 font-bold self-center">às</span>
                      <input type="time" value={extraLessonForm.endTime} onChange={e => setExtraLessonForm({ ...extraLessonForm, endTime: e.target.value, selectedSlotId: 'custom' })} className="flex-1 bg-white dark:bg-slate-700 border-none rounded-xl px-3 py-2 font-bold dark:text-white text-xs text-center" />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Conteúdo Ministrado</label>
                  <textarea value={extraLessonForm.subject} onChange={e => setExtraLessonForm({ ...extraLessonForm, subject: e.target.value })} rows={2} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm" placeholder="O que foi dado na aula..." />
                </div>
              </div>

              <div className="mt-8 flex gap-4">
                <button onClick={() => setIsExtraLessonModalOpen(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-[10px]">Cancelar</button>
                <button onClick={handleSaveExtraLesson} disabled={!extraLessonForm.date || !extraLessonForm.schoolId || !extraLessonForm.classId} className="flex-1 py-4 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-tight shadow-xl shadow-indigo-100 disabled:opacity-50 disabled:shadow-none">Salvar Aula</button>
              </div>
            </div>
          </div>
        )
      }

      {/* Modal de Criação de Aula Regular (Wizard) */}
      {
        showCreateRegularModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl p-6 flex flex-col max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                  <Plus className="text-blue-600" /> Nova Aula Regular
                </h3>
                <button onClick={() => setShowCreateRegularModal(false)} className="text-slate-300 hover:text-slate-600"><X /></button>
              </div>

              <div className="space-y-4">
                {/* 1. Data */}
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Data da Aula</label>
                  <input
                    type="date"
                    value={createRegularForm.date}
                    onChange={e => setCreateRegularForm(prev => ({ ...prev, date: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 text-xs font-bold outline-none dark:text-white"
                  />
                </div>

                {/* 2. Escola */}
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Escola</label>
                  <select
                    value={createRegularForm.schoolId}
                    onChange={e => setCreateRegularForm(prev => ({ ...prev, schoolId: e.target.value, classId: '', shiftId: '', slotId: '' }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 text-xs font-bold outline-none dark:text-white cursor-pointer"
                  >
                    <option value="">Selecione uma escola...</option>
                    {data.schools.filter(s => !s.deleted).sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {/* 3. Turma */}
                {createRegularForm.schoolId && (
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Turma</label>
                    <select
                      value={createRegularForm.classId}
                      onChange={e => setCreateRegularForm(prev => ({ ...prev, classId: e.target.value }))}
                      className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 text-xs font-bold outline-none dark:text-white cursor-pointer"
                    >
                      <option value="">Selecione a turma...</option>
                      {data.schools.find(s => s.id === createRegularForm.schoolId)?.classes.filter(c => typeof c === 'string' || !c.deleted).map(c => {
                        const val = typeof c === 'string' ? c : (c.id || c.name);
                        const label = typeof c === 'string' ? c : c.name;
                        return <option key={val} value={val}>{label}</option>
                      })}
                    </select>
                  </div>
                )}

                {/* 4. Slot (Horário) */}
                {createRegularForm.schoolId && (
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Horário (Slot Oficial)</label>
                    <select
                      value={createRegularForm.slotId ? `${createRegularForm.shiftId}|${createRegularForm.slotId}` : ''}
                      onChange={e => {
                        const [shiftId, slotId] = e.target.value.split('|');
                        setCreateRegularForm(prev => ({ ...prev, shiftId, slotId }));
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 text-xs font-bold outline-none dark:text-white cursor-pointer"
                    >
                      <option value="">Selecione o horário...</option>
                      {data.schools.find(s => s.id === createRegularForm.schoolId)?.shifts.map(shift => (
                        <optgroup key={shift.id} label={shift.name}>
                          {shift.slots.filter(s => s.type === 'class').map(slot => (
                            <option key={slot.id} value={`${shift.id}|${slot.id}`}>
                              {slot.label} ({slot.startTime} - {slot.endTime})
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="mt-8 grid grid-cols-2 gap-3">
                <button onClick={() => setShowCreateRegularModal(false)} className="py-3 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-black uppercase text-[10px] tracking-tight hover:bg-slate-200 transition-all">Cancelar</button>
                <button
                  onClick={handleCreateRegularSkeleton}
                  disabled={!createRegularForm.date || !createRegularForm.schoolId || !createRegularForm.classId || !createRegularForm.slotId}
                  className="py-3 bg-blue-600 text-white rounded-xl font-black uppercase text-[10px] tracking-tight shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:opacity-50 disabled:shadow-none transition-all"
                >
                  Criar Aula
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
};

export default LessonLogger;