import React, { useState, useMemo } from 'react';
import { AppData, SchoolEvent, EventType, DayOfWeek, LessonLog, Term } from '../types';
import {
  Calendar,
  Plus,
  Trash2,
  X,
  School as SchoolIcon,
  ChevronDown,
  CalendarDays,
  AlertTriangle,
  Clock,
  Users,
  Info,
  Search,
  SlidersHorizontal,
  LayoutGrid,
} from 'lucide-react';
import { getDayOfWeekFromDate, getShortWeekDay, getDayMonth } from '../utils';

interface AgendaManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatMonthHeader(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase());
}

function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function getFridayOfWeek(mondayStr: string): string {
  const d = new Date(mondayStr + 'T12:00:00');
  d.setDate(d.getDate() + 4);
  return d.toISOString().split('T')[0];
}

function fmtShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// ─── Component ────────────────────────────────────────────────────────────────

const AgendaManagement: React.FC<AgendaManagementProps> = ({ data, onUpdateData }) => {

  // ── Modal State ──────────────────────────────────────────────────────────
  const [isAddingEvent, setIsAddingEvent] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  const [eventForm, setEventForm] = useState<{
    schoolId: string;
    type: EventType;
    title: string;
    date: string;
    blocksClasses: boolean;
    cancelScope: 'all' | 'shift' | 'class';
    shiftId: string;
    classId: string;
    description: string;
  }>({
    schoolId: '',
    type: 'meeting',
    title: '',
    date: new Date().toISOString().split('T')[0],
    blocksClasses: false,
    cancelScope: 'all',
    shiftId: '',
    classId: '',
    description: ''
  });

  // ── Filter State ─────────────────────────────────────────────────────────
  const [filterSchoolId, setFilterSchoolId] = useState('all');
  const [filterTermIdx, setFilterTermIdx] = useState('all');
  const [filterType, setFilterType] = useState<'all' | 'meeting' | 'festivity' | 'trip' | 'material' | 'other'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'upcoming' | 'done'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // ── Layout/Grouping State ────────────────────────────────────────────────
  const [cardsPerRow, setCardsPerRow] = useState(1);
  const [groupByWeek, setGroupByWeek] = useState(false);

  // ── Derived data ─────────────────────────────────────────────────────────

  const formSchool = useMemo(() => data.schools.find(s => s.id === eventForm.schoolId), [data.schools, eventForm.schoolId]);

  const agendaEvents = useMemo(() =>
    data.events.filter(e => !['test', 'work'].includes(e.type) && !data.schools.find(s => s.id === e.schoolId)?.deleted),
    [data.events, data.schools]
  );

  const schoolsWithEvents = useMemo(() => {
    const ids = new Set(agendaEvents.map(e => e.schoolId));
    return (data.schools || []).filter(s => ids.has(s.id) && !s.deleted);
  }, [agendaEvents, data.schools]);

  const termsForFilter = useMemo((): (Term & { idx: number })[] => {
    const schoolId = filterSchoolId !== 'all' ? filterSchoolId : null;
    const cal = data.calendars.find(c => !schoolId || c.schoolId === schoolId);
    if (!cal) return [];
    return cal.terms.map((t, i) => ({ ...t, idx: i }));
  }, [filterSchoolId, data.calendars]);

  const today = new Date().toISOString().split('T')[0];

  // ── Filtered list ─────────────────────────────────────────────────────────

  const filteredEvents = useMemo(() => {
    let list = agendaEvents;

    if (filterSchoolId !== 'all') list = list.filter(e => e.schoolId === filterSchoolId);

    if (filterTermIdx !== 'all') {
      const idx = parseInt(filterTermIdx);
      list = list.filter(e => {
        const cal = data.calendars.find(c => c.schoolId === e.schoolId) || data.calendars[0];
        const term = cal?.terms[idx];
        if (!term) return false;
        const d = e.date.split('T')[0];
        return d >= term.start && d <= term.end;
      });
    }

    if (filterType !== 'all') list = list.filter(e => e.type === filterType);

    if (filterStatus !== 'all') {
      list = list.filter(e => {
        const d = e.date.split('T')[0];
        const isDone = d < today;
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
  }, [agendaEvents, filterSchoolId, filterTermIdx, filterType, filterStatus, searchQuery, data.calendars, today]);

  // ── Grouping ─────────────────────────────────────────────────────────────

  type WeekGroup = { weekKey: string; label: string; events: SchoolEvent[] };
  type MonthGroup = { key: string; label: string; weeks: WeekGroup[] };

  const grouped = useMemo((): MonthGroup[] => {
    const months: MonthGroup[] = [];
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

  // ── Conflict detection (real-time) ───────────────────────────────────────

  React.useEffect(() => {
    setConflictWarning(null);
    if (!eventForm.blocksClasses || !eventForm.schoolId || !eventForm.date) return;
    const dateStr = eventForm.date;
    const assessments = data.events.filter(e =>
      e.schoolId === eventForm.schoolId &&
      e.date.startsWith(dateStr) &&
      ['test', 'work'].includes(e.type)
    );
    if (assessments.length === 0) return;
    const conflict = assessments.find(assessment => {
      if (eventForm.cancelScope === 'all') return true;
      if (eventForm.cancelScope === 'class') return assessment.classId === eventForm.classId;
      if (eventForm.cancelScope === 'shift') {
        const shift = formSchool?.shifts.find(s => s.id === eventForm.shiftId);
        if (assessment.slotId && shift) return shift.slots.some(sl => sl.id === assessment.slotId);
        return false;
      }
      return false;
    });
    if (conflict) {
      const typeLabel = conflict.type === 'test' ? 'uma Prova' : 'um Trabalho';
      const scopeLabel = conflict.classId ? `na turma ${conflict.classId}` : '';
      setConflictWarning(`Atenção: Este cancelamento coincide com ${typeLabel} ("${conflict.title}") agendada ${scopeLabel}.`);
    }
  }, [eventForm, data.events, formSchool]);

  // ── Form default school ─────────────────────────────────────────────────

  React.useEffect(() => {
    if (!isAddingEvent) {
      const firstActive = data.schools.find(s => !s.deleted);
      setEventForm(prev => ({
        ...prev,
        schoolId: filterSchoolId === 'all' ? (firstActive?.id || '') : filterSchoolId
      }));
      setConflictWarning(null);
    }
  }, [filterSchoolId, isAddingEvent, data.schools]);

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSaveEvent = () => {
    if (!eventForm.title || !eventForm.schoolId) return;

    const safeDateISO = new Date(eventForm.date + 'T12:00:00').toISOString();
    const dateStr = eventForm.date;

    if (eventForm.blocksClasses) {
      const logConflict = data.logs.some(l => {
        if (l.schoolId !== eventForm.schoolId || !l.date.startsWith(dateStr)) return false;
        if (eventForm.cancelScope === 'all') return true;
        if (eventForm.cancelScope === 'shift') {
          const shift = formSchool?.shifts.find(s => s.id === eventForm.shiftId);
          return !!shift?.slots.some(sl => sl.id === l.slotId);
        }
        if (eventForm.cancelScope === 'class') return l.classId === eventForm.classId;
        return false;
      });
      if (logConflict) {
        alert("ERRO: Não é possível cancelar aulas pois já existem conteúdos registrados no diário para este período. Por favor, remova os registros de aula antes de criar este evento.");
        return;
      }
    }

    const newEvent: SchoolEvent = {
      id: crypto.randomUUID(),
      schoolId: eventForm.schoolId,
      date: safeDateISO,
      type: eventForm.type,
      title: eventForm.title,
      description: eventForm.description || '',
      blocksClasses: eventForm.blocksClasses,
      blocksShift: eventForm.blocksClasses && (eventForm.cancelScope === 'all' || eventForm.cancelScope === 'shift'),
      slotId: eventForm.cancelScope === 'shift' ? eventForm.shiftId : undefined,
      classId: eventForm.cancelScope === 'class' ? eventForm.classId : undefined
    };

    const newLogs: LessonLog[] = [];
    if (newEvent.blocksClasses) {
      const dayOfWeek = getDayOfWeekFromDate(eventForm.date);
      data.schedules.forEach(schedule => {
        if (schedule.schoolId !== eventForm.schoolId || Number(schedule.dayOfWeek) !== dayOfWeek || schedule.classId === 'window') return;
        let shouldFill = false;
        if (eventForm.cancelScope === 'all') shouldFill = true;
        else if (eventForm.cancelScope === 'shift' && schedule.shiftId === eventForm.shiftId) shouldFill = true;
        else if (eventForm.cancelScope === 'class' && schedule.classId === eventForm.classId) shouldFill = true;
        if (shouldFill) {
          newLogs.push({
            id: crypto.randomUUID(),
            date: safeDateISO,
            schoolId: schedule.schoolId,
            classId: schedule.classId,
            slotId: schedule.slotId,
            subject: `Evento: ${newEvent.title}`,
            homework: '',
            notes: 'Aula substituída por evento escolar.'
          });
        }
      });
    }

    onUpdateData({ events: [...data.events, newEvent], logs: [...data.logs, ...newLogs] });
    setIsAddingEvent(false);
    setEventForm({
      schoolId: filterSchoolId === 'all' ? (data.schools[0]?.id || '') : filterSchoolId,
      type: 'meeting', title: '',
      date: new Date().toISOString().split('T')[0],
      blocksClasses: false, cancelScope: 'all', shiftId: '', classId: '', description: ''
    });
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getEventScope = (event: SchoolEvent, school?: any) => {
    if (event.classId) return `Turma ${event.classId}`;
    if (event.slotId) {
      const shift = school?.shifts.find((s: any) => s.id === event.slotId);
      return shift ? `Turno ${shift.name}` : `Turno/Horário Específico`;
    }
    return 'Geral / Dia Todo';
  };

  const EVENT_TYPE_LABELS: Record<string, string> = {
    meeting: 'Reunião', festivity: 'Evento', trip: 'Passeio',
    material: 'Material', other: 'Outro', test: 'Prova', work: 'Trabalho'
  };

  const gridClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
    5: 'grid-cols-5',
    6: 'grid-cols-6',
  }[cardsPerRow] ?? 'grid-cols-1';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 md:space-y-6 pb-20">

      {/* ── Header ── */}
      <div className="bg-white dark:bg-slate-900 p-4 md:p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2">
            <Calendar className="text-orange-500 w-5 h-5" /> Agenda Escolar
          </h3>
          <p className="text-[9px] text-slate-500 font-black uppercase tracking-tight mt-0.5">
            {filteredEvents.length} evento{filteredEvents.length !== 1 ? 's' : ''}{' '}
            {filterSchoolId !== 'all' || filterTermIdx !== 'all' || filterType !== 'all' || filterStatus !== 'all' || searchQuery
              ? 'encontrado' + (filteredEvents.length !== 1 ? 's' : '')
              : 'no total'}
          </p>
        </div>
        <button
          onClick={() => setIsAddingEvent(true)}
          className="bg-orange-500 text-white px-5 py-2.5 rounded-lg font-black uppercase text-[9px] tracking-tight shadow-lg shadow-orange-100 hover:brightness-110 transition-all flex items-center gap-2 self-start sm:self-auto shrink-0"
        >
          <Plus size={15} /> Novo Evento
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
            placeholder="Buscar evento..."
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
            onChange={e => { setFilterSchoolId(e.target.value); setFilterTermIdx('all'); }}
            className="bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-1.5 text-[10px] font-bold dark:text-white flex-1 min-w-[120px]"
          >
            <option value="all">Todas as escolas</option>
            {schoolsWithEvents.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          {/* Event type filter */}
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value as any)}
            className="bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-1.5 text-[10px] font-bold dark:text-white flex-1 min-w-[110px]"
          >
            <option value="all">Todos os tipos</option>
            <option value="meeting">Reunião</option>
            <option value="festivity">Evento</option>
            <option value="trip">Passeio</option>
            <option value="material">Material</option>
            <option value="other">Outro</option>
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

        {/* Layout + Status row */}
        <div className="flex items-center gap-3 pt-1 border-t border-slate-100 dark:border-slate-800 flex-wrap">

          {/* Cards per row */}
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-tight shrink-0">Cards/linha:</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5, 6].map(n => (
                <button
                  key={n}
                  onClick={() => setCardsPerRow(n)}
                  className={`w-6 h-6 rounded text-[9px] font-black transition-all ${cardsPerRow === n
                    ? 'bg-orange-500 text-white shadow-sm'
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
              ? 'bg-orange-500 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-slate-200'
              }`}
          >
            <Calendar size={11} />
            Por semana
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Status filter */}
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
            {([['all', 'Todos'], ['upcoming', 'Agendados'], ['done', 'Realizados']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setFilterStatus(val)}
                className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-tight transition-all ${filterStatus === val
                  ? val === 'done'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : val === 'upcoming'
                      ? 'bg-orange-500 text-white shadow-sm'
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

      {/* ── Grouped Event List ── */}
      {grouped.length === 0 ? (
        <div className="py-16 bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center gap-4 text-center">
          <CalendarDays size={40} className="text-slate-300 dark:text-slate-700" />
          <div>
            <p className="text-slate-500 font-black uppercase text-[10px] tracking-tight">
              {searchQuery || filterSchoolId !== 'all' || filterTermIdx !== 'all' || filterType !== 'all' || filterStatus !== 'all'
                ? 'Nenhum evento encontrado'
                : 'Nenhum evento agendado'}
            </p>
            {(searchQuery || filterSchoolId !== 'all' || filterTermIdx !== 'all' || filterType !== 'all' || filterStatus !== 'all') && (
              <button
                onClick={() => { setSearchQuery(''); setFilterSchoolId('all'); setFilterTermIdx('all'); setFilterType('all'); setFilterStatus('all'); }}
                className="mt-3 text-[9px] font-black text-orange-500 uppercase hover:underline"
              >
                Limpar filtros
              </button>
            )}
          </div>
        </div>
      ) : (
        grouped.map(month => (
          <div key={month.key} className="space-y-3">

            {/* Month header */}
            <div className="flex items-center gap-3">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{month.label}</h4>
              <div className="flex-1 h-px bg-slate-100 dark:bg-slate-800" />
            </div>

            {month.weeks.map(week => (
              <div key={week.weekKey}>

                {/* Week sub-header (when groupByWeek is on) */}
                {groupByWeek && (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[9px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-wider">{week.label}</span>
                    <div className="flex-1 h-px bg-slate-50 dark:bg-slate-800/50" />
                  </div>
                )}

                {/* Cards grid */}
                <div className={`grid gap-3 ${gridClass}`}>
                  {week.events.map(event => {
                    const school = data.schools.find(s => s.id === event.schoolId);
                    const eventColor = school ? school.color : '#f97316';
                    const eventDateStr = event.date.split('T')[0];
                    const isPast = eventDateStr < today;

                    return (
                      <div
                        key={event.id}
                        className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm transition-all flex items-start gap-3 hover:shadow-md relative overflow-hidden"
                        style={{ borderColor: `${eventColor}40` }}
                      >
                        {/* Past indicator strip */}
                        {isPast && (
                          <div className="absolute top-0 left-0 right-0 h-0.5" style={{ backgroundColor: '#94a3b8' }} />
                        )}
                        {!isPast && (
                          <div className="absolute top-0 left-0 right-0 h-0.5" style={{ backgroundColor: eventColor }} />
                        )}

                        {/* Date badge */}
                        <div
                          className="w-10 h-10 rounded-lg flex flex-col items-center justify-center shrink-0"
                          style={{ backgroundColor: `${eventColor}20`, color: eventColor }}
                        >
                          <span className="text-[7px] font-black uppercase leading-none mb-0.5">{getShortWeekDay(event.date)}</span>
                          <span className="text-[10px] font-black leading-none">{getDayMonth(event.date)}</span>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-hidden">
                          <h4 className="font-black text-slate-800 dark:text-white uppercase text-[10px] truncate mb-1">{event.title}</h4>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[8px] text-slate-400 font-bold uppercase">
                              {EVENT_TYPE_LABELS[event.type] || event.type}
                            </span>
                            {filterSchoolId === 'all' && school && (
                              <span className="text-[7px] font-black bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-md uppercase truncate max-w-[100px]">
                                {school.name}
                              </span>
                            )}
                            <span className="text-[7px] font-black bg-orange-50 dark:bg-orange-900/30 text-orange-600 px-1.5 py-0.5 rounded-md uppercase">
                              {getEventScope(event, school)}
                            </span>
                            {event.blocksClasses && (
                              <span className="text-[7px] font-black bg-red-100 dark:bg-red-900/30 text-red-600 px-1.5 py-0.5 rounded-md uppercase">
                                Cancela Aulas
                              </span>
                            )}
                            {/* Status badge */}
                            <span className={`text-[7px] font-black px-1.5 py-0.5 rounded-md uppercase border ${isPast
                                ? 'bg-amber-50 text-amber-600 border-amber-200'
                                : 'bg-blue-50 text-blue-600 border-blue-200'
                              }`}>
                              {isPast ? 'Realizado' : 'Agendado'}
                            </span>
                          </div>
                          {event.description ? (
                            <p className="text-[8px] text-slate-400 mt-1 line-clamp-2">{event.description}</p>
                          ) : null}
                        </div>

                        {/* Delete button */}
                        {deletingEventId === event.id ? (
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-[8px] font-bold text-slate-600 uppercase">Confirmar?</span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => { onUpdateData({ events: data.events.filter(e => e.id !== event.id) }); setDeletingEventId(null); }}
                                className="bg-red-500 text-white px-1.5 py-0.5 rounded text-[9px] font-bold"
                              >Sim</button>
                              <button
                                onClick={() => setDeletingEventId(null)}
                                className="bg-slate-300 text-slate-700 px-1.5 py-0.5 rounded text-[9px] font-bold"
                              >Não</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setDeletingEventId(event.id)} className="text-slate-200 hover:text-red-500 p-1 shrink-0">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))
      )}

      {/* ── Add Event Modal ── */}
      {isAddingEvent && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl md:rounded-2xl p-6 md:p-8 w-full max-w-xl shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6 md:mb-8">
              <h3 className="text-lg md:text-xl font-black uppercase text-slate-800 dark:text-white">Novo Evento Escolar</h3>
              <button onClick={() => setIsAddingEvent(false)} className="text-slate-300 hover:text-slate-600"><X /></button>
            </div>
            <div className="space-y-4 md:space-y-6">

              <div>
                <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Instituição</label>
                <select value={eventForm.schoolId} onChange={e => setEventForm({ ...eventForm, schoolId: e.target.value, shiftId: '', classId: '' })} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg md:rounded-xl px-4 md:px-5 py-3 font-bold dark:text-white outline-none focus:ring-2 focus:ring-primary text-sm">
                  {data.schools.filter(s => !s.deleted).sort((a, b) => a.name.localeCompare(b.name)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Título do Evento</label>
                <input type="text" value={eventForm.title} onChange={e => setEventForm({ ...eventForm, title: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg md:rounded-xl px-4 md:px-5 py-3 font-bold dark:text-white text-sm" placeholder="Ex: Conselho de Classe" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Tipo</label>
                  <select value={eventForm.type} onChange={e => setEventForm({ ...eventForm, type: e.target.value as any })} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg md:rounded-xl px-4 md:px-5 py-3 font-bold dark:text-white text-sm">
                    <option value="meeting">Reunião</option>
                    <option value="festivity">Evento</option>
                    <option value="trip">Passeio</option>
                    <option value="material">Material</option>
                    <option value="other">Outro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Data</label>
                  <input type="date" value={eventForm.date} onChange={e => setEventForm({ ...eventForm, date: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg md:rounded-xl px-4 md:px-5 py-3 font-bold dark:text-white text-sm" />
                </div>
              </div>

              <div className="bg-orange-50 dark:bg-orange-900/10 p-4 md:p-5 rounded-xl border border-orange-100 dark:border-orange-900/30">
                <label className="flex items-center gap-4 cursor-pointer mb-4">
                  <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-900/40 text-orange-600 flex items-center justify-center shrink-0"><AlertTriangle size={20} /></div>
                  <div className="flex-1"><span className="text-[9px] md:text-[10px] font-black uppercase block mb-0.5 dark:text-orange-400">Cancelar Aulas</span><p className="text-[8px] md:text-[9px] font-bold text-orange-600 dark:text-orange-500 uppercase">Impedir registros de aula.</p></div>
                  <input type="checkbox" checked={eventForm.blocksClasses} onChange={e => setEventForm({ ...eventForm, blocksClasses: e.target.checked })} className="w-6 h-6 rounded-lg text-orange-500" />
                </label>

                {eventForm.blocksClasses && (
                  <div className="space-y-4 animate-in slide-in-from-top-2">
                    {conflictWarning && (
                      <div className="bg-white dark:bg-slate-900/80 p-3 rounded-lg border-l-4 border-red-500 flex items-start gap-3 shadow-sm">
                        <Info size={16} className="text-red-500 mt-0.5 shrink-0" />
                        <p className="text-[9px] md:text-[10px] font-bold text-red-600 dark:text-red-400 uppercase leading-relaxed">{conflictWarning}</p>
                      </div>
                    )}
                    <div>
                      <label className="block text-[7px] md:text-[8px] font-black text-orange-700 dark:text-orange-300 uppercase mb-2 ml-1">Abrangência do Cancelamento</label>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { id: 'all', label: 'Dia Todo', icon: CalendarDays },
                          { id: 'shift', label: 'Turno', icon: Clock },
                          { id: 'class', label: 'Turma', icon: Users }
                        ]).map(scope => (
                          <button key={scope.id} type="button" onClick={() => setEventForm({ ...eventForm, cancelScope: scope.id as any })}
                            className={`flex flex-col items-center justify-center p-2 rounded-lg border-2 transition-all ${eventForm.cancelScope === scope.id ? 'bg-white dark:bg-slate-800 border-orange-500 text-orange-600 shadow-sm' : 'bg-orange-100/30 dark:bg-orange-900/20 border-transparent text-orange-400'}`}>
                            <scope.icon size={14} className="mb-1" />
                            <span className="text-[7px] md:text-[8px] font-black uppercase">{scope.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {eventForm.cancelScope === 'shift' && (
                      <div className="animate-in fade-in zoom-in-95">
                        <label className="block text-[7px] md:text-[8px] font-black text-orange-700 dark:text-orange-300 uppercase mb-1 ml-1">Selecione o Turno</label>
                        <select value={eventForm.shiftId} onChange={e => setEventForm({ ...eventForm, shiftId: e.target.value })} className="w-full bg-white dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold text-orange-600 dark:text-orange-400">
                          <option value="">Escolha...</option>
                          {formSchool?.shifts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                    )}
                    {eventForm.cancelScope === 'class' && (
                      <div className="animate-in fade-in zoom-in-95">
                        <label className="block text-[7px] md:text-[8px] font-black text-orange-700 dark:text-orange-300 uppercase mb-1 ml-1">Selecione a Turma</label>
                        <select value={eventForm.classId} onChange={e => setEventForm({ ...eventForm, classId: e.target.value })} className="w-full bg-white dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold text-orange-600 dark:text-orange-400">
                          <option value="">Escolha...</option>
                          {formSchool?.classes.map(c => <option key={typeof c === 'string' ? c : c.id} value={typeof c === 'string' ? c : c.id}>{typeof c === 'string' ? c : c.name}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Descrição (Opcional)</label>
                <textarea value={eventForm.description} onChange={e => setEventForm({ ...eventForm, description: e.target.value })} rows={3} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg md:rounded-xl px-5 py-3 font-bold dark:text-white text-sm" placeholder="Detalhes extras..." />
              </div>
            </div>

            <div className="mt-8 mb-4 flex gap-4">
              <button onClick={() => setIsAddingEvent(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-[9px] md:text-[10px]">Cancelar</button>
              <button onClick={handleSaveEvent} className="flex-1 py-4 bg-orange-500 text-white rounded-lg md:rounded-xl font-black uppercase text-[9px] md:text-[10px] shadow-xl shadow-orange-100">Salvar Evento</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgendaManagement;