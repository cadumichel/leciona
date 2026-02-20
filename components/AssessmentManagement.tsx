import React, { useState, useMemo, useEffect } from 'react';
import { AppData, SchoolEvent, EventType, TimeSlot, DayOfWeek, LessonLog } from '../types';
import { FileCheck, Calendar, Trash2, AlertTriangle, Plus, X, Layers, Clock, ArrowRight, ChevronRight, School as SchoolIcon, Copy, CheckCircle2, Pencil } from 'lucide-react';
import { isWeekend, isHoliday, getHolidayName, getDayOfWeekFromDate, getSafeDate } from '../utils';
import { getSchedulesForDate } from '../utils/schedule';

interface AssessmentManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
}

const AssessmentManagement: React.FC<AssessmentManagementProps> = ({ data, onUpdateData }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newEvent, setNewEvent] = useState<Partial<SchoolEvent>>({
    type: 'test',
    title: '',
    date: new Date().toISOString().split('T')[0],
    schoolId: '',
    classId: '',
    slotId: '',
    description: ''
  });

  const [dateWarning, setDateWarning] = useState('');
  const [isInvalidDate, setIsInvalidDate] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  // New: save-success animation state
  const [saveSuccess, setSaveSuccess] = useState(false);

  // FIX: Sincroniza a escola selecionada com os dados reais
  const activeSchool = useMemo(() => (data.schools || []).find(s => s.id === newEvent.schoolId), [data.schools, newEvent.schoolId]);

  // FIX: Se abrir o modal e não tiver escola selecionada (ou ID inválido), seleciona a primeira
  useEffect(() => {
    if (isAdding) {
      const isValidSchool = (data.schools || []).some(s => s.id === newEvent.schoolId && !s.deleted);
      if (!newEvent.schoolId || !isValidSchool) {
        const firstActive = (data.schools || []).find(s => !s.deleted);
        if (firstActive) {
          setNewEvent(prev => ({ ...prev, schoolId: firstActive.id }));
        }
      }
    }
  }, [isAdding, data.schools, newEvent.schoolId]);

  // Reset save success when form changes
  useEffect(() => {
    setSaveSuccess(false);
  }, [newEvent.title, newEvent.classId, newEvent.slotId, newEvent.date, newEvent.schoolId]);

  // Lógica de validação extraída para evitar dependência de estado stale
  const validateDateLogic = (dateStr: string, schoolId: string, classId: string) => {
    const date = getSafeDate(dateStr);
    let warning = '';
    let invalid = false;

    if (isHoliday(date)) {
      warning = `Feriado: ${getHolidayName(date)}.`;
      invalid = true;
    } else {
      const calendar = data.calendars.find(c => c.schoolId === schoolId);
      if (calendar) {
        if (calendar.midYearBreak.start && dateStr >= calendar.midYearBreak.start && dateStr <= calendar.midYearBreak.end) {
          warning = 'Data em período de recesso.';
          invalid = true;
        } else if (calendar.extraRecesses?.some(r => r.date === dateStr)) {
          warning = 'Data em período de recesso.';
          invalid = true;
        }
      }
    }

    if (!invalid) {
      const blockingEvent = data.events.find(e =>
        e.schoolId === schoolId &&
        e.date.startsWith(dateStr) &&
        e.blocksClasses &&
        (!e.classId || e.classId === classId)
      );

      if (blockingEvent) {
        warning = `Conflito: Evento "${blockingEvent.title}" cancela aulas.`;
        invalid = true;
      }
    }

    return { warning, invalid };
  };

  // Handler específico para mudança de data
  const handleDateChange = (dateStr: string) => {
    const { warning, invalid } = validateDateLogic(dateStr, newEvent.schoolId!, newEvent.classId!);
    setIsInvalidDate(invalid);
    setDateWarning(warning);
    setNewEvent(prev => ({ ...prev, date: dateStr, slotId: '' }));
  };

  // Handler específico para mudança de turma
  const handleClassChange = (classId: string) => {
    const { warning, invalid } = validateDateLogic(newEvent.date!, newEvent.schoolId!, classId);
    setIsInvalidDate(invalid);
    setDateWarning(warning);
    setNewEvent(prev => ({ ...prev, classId, slotId: '' }));
  };

  const handleSaveEvent = () => {
    if (!newEvent.title || !newEvent.classId || !newEvent.slotId || isInvalidDate) return;

    const safeDateISO = getSafeDate(newEvent.date!).toISOString();

    const eventId = newEvent.id || crypto.randomUUID();

    let currentLogs = [...data.logs];
    let currentEvents = [...data.events];

    if (newEvent.id) {
      const originalEvent = data.events.find(e => e.id === newEvent.id);
      if (originalEvent) {
        currentEvents = currentEvents.filter(e => e.id !== newEvent.id);
        const oldDateISO = originalEvent.date;
        currentLogs = currentLogs.filter(l =>
          !(l.date === oldDateISO && l.schoolId === originalEvent.schoolId && l.slotId === originalEvent.slotId)
        );
      }
    }

    const event: SchoolEvent = {
      id: eventId,
      title: newEvent.title!,
      date: safeDateISO,
      schoolId: newEvent.schoolId!,
      classId: newEvent.classId!,
      slotId: newEvent.slotId,
      type: newEvent.type as 'test' | 'work',
      description: newEvent.description || '',
      blocksClasses: false
    };

    const newLog: LessonLog = {
      id: crypto.randomUUID(),
      date: safeDateISO,
      schoolId: event.schoolId,
      classId: event.classId!,
      slotId: event.slotId!,
      subject: `Avaliação: ${event.title}`,
      homework: '',
      notes: event.description || ''
    };

    currentLogs = currentLogs.filter(l =>
      !(l.date.split('T')[0] === newEvent.date && l.schoolId === event.schoolId && l.slotId === event.slotId)
    );

    onUpdateData({
      events: [...currentEvents, event],
      logs: [...currentLogs, newLog]
    });

    // Show green success animation, keep modal open
    setSaveSuccess(true);
    // Update newEvent.id if this was a new save (so subsequent saves are updates)
    if (!newEvent.id) {
      setNewEvent(prev => ({ ...prev, id: eventId }));
    }

    // Auto-reset success state after 2.5s
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const restrictedAvailableSlots = useMemo(() => {
    if (!activeSchool || !newEvent.date || !newEvent.classId || isInvalidDate) return [];

    const dayOfWeek = getDayOfWeekFromDate(newEvent.date);

    const selectedClassObj = activeSchool?.classes.find(c => (typeof c === 'string' ? c : c.id) === newEvent.classId);
    if (!selectedClassObj) return [];

    const className = typeof selectedClassObj === 'string' ? selectedClassObj : selectedClassObj.name;
    const classId = typeof selectedClassObj === 'string' ? selectedClassObj : selectedClassObj.id;

    const validEntries = getSchedulesForDate(data, newEvent.date).filter(s =>
      Number(s.dayOfWeek) === dayOfWeek &&
      s.schoolId === newEvent.schoolId &&
      (s.classId === classId || s.classId === className)
    );

    const slots: TimeSlot[] = [];
    validEntries.forEach(entry => {
      if (!activeSchool?.shifts || !Array.isArray(activeSchool.shifts)) return;
      const shift = activeSchool.shifts.find(sh => sh.id === entry.shiftId);
      const slot = shift?.slots.find(sl => sl.id === entry.slotId);
      if (slot) slots.push(slot);
    });
    return slots;
  }, [activeSchool, newEvent.date, newEvent.classId, data.schedules, isInvalidDate]);

  // --- Copy Feature State & Logic ---
  const [copyData, setCopyData] = useState({
    isOpen: false,
    targetDate: '',
    targetSchoolId: '',
    targetClassId: '',
    targetSlotId: '',
  });

  // Auto-set school when opening copy modal
  useEffect(() => {
    if (copyData.isOpen && !copyData.targetSchoolId && (data.schools || []).length > 0) {
      setCopyData(prev => ({ ...prev, targetSchoolId: data.schools[0].id }));
    }
  }, [copyData.isOpen, data.schools]);

  const copyTargetSchool = useMemo(() => (data.schools || []).find(s => s.id === copyData.targetSchoolId), [data.schools, copyData.targetSchoolId]);

  const availableSlotsForCopy = useMemo(() => {
    if (!copyTargetSchool || !copyData.targetDate || !copyData.targetClassId) return [];

    const { invalid } = validateDateLogic(copyData.targetDate, copyData.targetSchoolId, copyData.targetClassId);
    if (invalid) return [];

    const dayOfWeek = getDayOfWeekFromDate(copyData.targetDate);
    const targetClassObj = copyTargetSchool?.classes.find(c => (typeof c === 'string' ? c : c.id) === copyData.targetClassId);
    if (!targetClassObj) return [];

    const className = typeof targetClassObj === 'string' ? targetClassObj : targetClassObj.name;
    const classId = typeof targetClassObj === 'string' ? targetClassObj : targetClassObj.id;

    const validEntries = getSchedulesForDate(data, copyData.targetDate).filter(s =>
      Number(s.dayOfWeek) === dayOfWeek &&
      s.schoolId === copyData.targetSchoolId &&
      (s.classId === classId || s.classId === className)
    );

    const slots: TimeSlot[] = [];
    validEntries.forEach(entry => {
      if (!copyTargetSchool?.shifts || !Array.isArray(copyTargetSchool.shifts)) return;
      const shift = copyTargetSchool.shifts.find(sh => sh.id === entry.shiftId);
      const slot = shift?.slots.find(sl => sl.id === entry.slotId);
      if (slot) slots.push(slot);
    });
    return slots;
  }, [copyTargetSchool, copyData.targetDate, copyData.targetClassId, data.schedules]);

  const handleCopyAssessment = () => {
    if (!newEvent.title || !copyData.targetDate || !copyData.targetClassId || !copyData.targetSlotId) return;

    const safeDateISO = getSafeDate(copyData.targetDate).toISOString();

    const eventId = crypto.randomUUID();
    const event: SchoolEvent = {
      id: eventId,
      title: newEvent.title,
      date: safeDateISO,
      schoolId: copyData.targetSchoolId,
      classId: copyData.targetClassId,
      slotId: copyData.targetSlotId,
      type: newEvent.type as 'test' | 'work',
      description: newEvent.description || '',
      blocksClasses: false
    };

    const newLog: LessonLog = {
      id: crypto.randomUUID(),
      date: safeDateISO,
      schoolId: event.schoolId,
      classId: event.classId!,
      slotId: event.slotId!,
      subject: `Avaliação: ${event.title}`,
      homework: '',
      notes: event.description || ''
    };

    const filteredLogs = data.logs.filter(l =>
      !(l.date.split('T')[0] === copyData.targetDate && l.schoolId === event.schoolId && l.slotId === event.slotId)
    );

    onUpdateData({
      events: [...data.events, event],
      logs: [...filteredLogs, newLog]
    });

    setCopyData(prev => ({ ...prev, isOpen: false, targetDate: '', targetClassId: '', targetSlotId: '' }));
  };

  return (
    <div className="space-y-6 md:space-y-8 pb-20">
      <div className="bg-white dark:bg-slate-900 p-5 md:p-8 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg md:text-xl font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-3">
            <FileCheck className="text-blue-600 w-5 h-5 md:w-6 md:h-6" /> Avaliações
          </h3>
          <p className="text-[9px] md:text-[10px] text-slate-500 font-black uppercase tracking-tight mt-1">Planeje provas, trabalhos e atividades avaliativas.</p>
        </div>
        <button
          onClick={() => {
            setIsAdding(true);
            setSaveSuccess(false);
            setNewEvent(prev => ({
              ...prev,
              id: undefined,
              title: '',
              schoolId: (data.schools || [])[0]?.id || '',
              classId: '',
              slotId: '',
              description: ''
            }));
          }}
          className="bg-blue-600 text-white px-6 md:px-8 py-3 md:py-3.5 rounded-lg font-black uppercase text-[9px] md:text-xs tracking-tight shadow-xl shadow-blue-100 hover:brightness-110 transition-all flex items-center gap-2"
        >
          <Plus size={16} className="md:w-[18px] md:h-[18px]" /> Nova Avaliação
        </button>
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          {/* Compact modal: max-w-lg, no overflow-y-auto, tighter padding */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 w-full max-w-lg shadow-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-base font-black uppercase">{newEvent.id ? 'Editar Avaliação' : 'Agendar Avaliação'}</h3>
              <button onClick={() => setIsAdding(false)} className="text-slate-300 hover:text-slate-600"><X /></button>
            </div>

            <div className="space-y-3">
              {/* Type selector */}
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
                    {(data.schools || []).length === 0 && <option value="">Nenhuma escola cadastrada</option>}
                    {(data.schools || []).filter(s => !s.deleted).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Turma</label>
                  <select
                    value={newEvent.classId}
                    onChange={e => handleClassChange(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2.5 font-bold dark:text-white text-sm"
                    disabled={!activeSchool}
                  >
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

              {/* Description — 2 rows to keep modal compact */}
              <div>
                <label className="block text-[9px] font-black text-slate-500 uppercase tracking-tight mb-1 ml-1">Descrição / Observações</label>
                <textarea value={newEvent.description} onChange={e => setNewEvent(prev => ({ ...prev, description: e.target.value }))} rows={2} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-4 py-2.5 font-bold dark:text-white text-sm resize-none" placeholder="Capítulos, observações..." />
              </div>
            </div>

            <div className="mt-4 flex gap-3">
              <button
                onClick={() => setCopyData(prev => ({
                  ...prev,
                  isOpen: true,
                  // Pre-fill with source assessment values
                  targetDate: newEvent.date || '',
                  targetSchoolId: newEvent.schoolId || (data.schools[0]?.id || ''),
                  targetClassId: newEvent.classId || '',
                  targetSlotId: newEvent.slotId || '',
                }))}
                className="flex-none py-3 px-4 rounded-lg font-black uppercase text-[9px] tracking-tight bg-slate-50 text-blue-600 hover:bg-blue-50 transition-colors border-2 border-slate-100 hover:border-blue-100"
                title="Copiar para outra turma"
              >
                <Copy size={16} />
              </button>
              <button onClick={() => setIsAdding(false)} className="flex-1 py-3 font-black text-slate-400 uppercase text-[9px]">Cancelar</button>
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
                {saveSuccess ? (
                  <>
                    <CheckCircle2 size={14} className="animate-in zoom-in-50 duration-300" />
                    Salvo!
                  </>
                ) : (
                  'Salvar Avaliação'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdding && copyData.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl p-5 flex flex-col">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <div>
                <h3 className="text-base font-black uppercase text-slate-800 dark:text-white flex items-center gap-2">
                  <Copy className="text-blue-600" size={18} /> Copiar Avaliação
                </h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">
                  Você está copiando: <span className="text-blue-600">"{newEvent.title || 'Sem título'}"</span>
                </p>
              </div>
              <button onClick={() => setCopyData(prev => ({ ...prev, isOpen: false }))} className="text-slate-300 hover:text-slate-600"><X /></button>
            </div>

            <div className="space-y-3">
              {/* School Select (if multiple exist) */}
              {(data.schools || []).length > 1 && (
                <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Escola de Destino</label>
                  <select
                    value={copyData.targetSchoolId}
                    onChange={e => setCopyData(prev => ({ ...prev, targetSchoolId: e.target.value, targetClassId: '', targetSlotId: '' }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-4 py-2.5 text-xs font-bold outline-none dark:text-white"
                  >
                    {(data.schools || []).filter(s => !s.deleted).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              {/* Class Select */}
              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Para qual turma?</label>
                <select
                  value={copyData.targetClassId}
                  onChange={e => setCopyData(prev => ({ ...prev, targetClassId: e.target.value, targetSlotId: '' }))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-4 py-2.5 text-xs font-bold outline-none dark:text-white"
                >
                  <option value="">Selecione a turma...</option>
                  {(copyTargetSchool?.classes || []).filter(c => typeof c === 'string' || !c.deleted).sort((a, b) => (typeof a === 'string' ? a : a.name).localeCompare(typeof b === 'string' ? b : b.name)).map(c => {
                    const cId = typeof c === 'string' ? c : c.id;
                    const cName = typeof c === 'string' ? c : c.name;
                    return <option key={cId} value={cId}>{cName}</option>;
                  })}
                </select>
              </div>

              {/* Date Select */}
              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Para qual dia?</label>
                <input
                  type="date"
                  value={copyData.targetDate}
                  onChange={e => setCopyData(prev => ({ ...prev, targetDate: e.target.value, targetSlotId: '' }))}
                  className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-4 py-2.5 text-xs font-bold outline-none dark:text-white"
                />
              </div>

              {/* Slot Select */}
              <div>
                <label className="block text-[9px] font-black text-slate-400 uppercase mb-1 ml-1">Horário (Slot)</label>
                <select
                  value={copyData.targetSlotId}
                  onChange={e => setCopyData(prev => ({ ...prev, targetSlotId: e.target.value }))}
                  disabled={!copyData.targetDate || !copyData.targetClassId}
                  className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-4 py-2.5 text-xs font-bold outline-none dark:text-white disabled:opacity-50"
                >
                  <option value="">
                    {availableSlotsForCopy.length > 0 ? 'Selecione o horário...' : (copyData.targetClassId && copyData.targetDate ? 'Nenhum horário disponível neste dia' : 'Aguardando seleção...')}
                  </option>
                  {availableSlotsForCopy.map(s => <option key={s.id} value={s.id}>{s.label} ({s.startTime})</option>)}
                </select>
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <button onClick={() => setCopyData(prev => ({ ...prev, isOpen: false }))} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-lg font-black uppercase text-[9px] tracking-tight hover:bg-slate-200 transition-all">Cancelar</button>
              <button
                onClick={handleCopyAssessment}
                disabled={!copyData.targetSlotId || !newEvent.title}
                className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-black uppercase text-[9px] tracking-tight shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:opacity-50 disabled:shadow-none transition-all"
              >
                Confirmar Cópia
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 md:gap-3">
        {data.events.filter(e => e.type === 'test' || e.type === 'work').sort((a, b) => a.date.localeCompare(b.date)).map(event => {
          const school = data.schools.find(s => s.id === event.schoolId);
          const color = school?.color || '#3b82f6';

          return (
            <div
              key={event.id}
              onClick={() => {
                setSaveSuccess(false);
                setNewEvent({
                  id: event.id,
                  title: event.title,
                  date: event.date.split('T')[0],
                  schoolId: event.schoolId,
                  classId: event.classId,
                  slotId: event.slotId,
                  type: event.type,
                  description: event.description
                });
                setIsAdding(true);
              }}
              className="bg-white dark:bg-slate-900 p-2 md:p-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm relative group hover:shadow-md transition-all duration-300 cursor-pointer hover:border-blue-200 dark:hover:border-blue-800 flex items-center gap-3 md:gap-4"
              style={{ borderColor: color + '30', backgroundColor: color + '05' }}
            >
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg flex items-center justify-center border-b-2 shrink-0" style={{ backgroundColor: color + '15', color: color, borderColor: color + '30' }}>
                <FileCheck size={18} className="md:w-[20px] md:h-[20px]" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h4 className="text-xs md:text-sm font-black text-slate-800 dark:text-white uppercase truncate">{event.title}</h4>
                  <span className="text-[7px] md:text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase shrink-0" style={{ backgroundColor: color + '20', color: color }}>
                    {event.type === 'test' ? 'Prova' : 'Trabalho'}
                  </span>
                  {event.classId && (() => {
                    const schoolClass = school?.classes.find(c =>
                      (typeof c === 'string' ? c : c.id) === event.classId ||
                      (typeof c === 'string' ? c : c.name) === event.classId
                    );
                    const className = schoolClass ? (typeof schoolClass === 'string' ? schoolClass : schoolClass.name) : event.classId;
                    return <span className="text-[7px] md:text-[8px] font-black text-slate-400 uppercase tracking-tight shrink-0 border border-slate-100 dark:border-slate-700 px-1 rounded">Turma {className}</span>;
                  })()}
                </div>

                <div className="flex items-center gap-3 text-[9px] md:text-[10px] font-bold text-slate-500">
                  <div className="flex items-center gap-1">
                    <Calendar size={10} className="text-slate-300" />
                    <span className="truncate">
                      {getSafeDate(event.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} • {getSafeDate(event.date).toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 3)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 truncate">
                    <SchoolIcon size={10} className="text-slate-300" />
                    <span className="truncate" style={{ color: color }}>{school?.name}</span>
                  </div>
                </div>
              </div>

              {deletingEventId === event.id ? (
                <div className="flex items-center gap-2 pr-2" onClick={e => e.stopPropagation()}>
                  <span className="text-[8px] font-bold text-slate-600 uppercase hidden md:inline">Confirmar?</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateData({ events: data.events.filter(e => e.id !== event.id) });
                      setDeletingEventId(null);
                    }}
                    className="bg-red-500 text-white px-2 py-1 rounded text-[9px] font-bold hover:bg-red-600"
                  >
                    Sim
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingEventId(null); }}
                    className="bg-slate-200 text-slate-600 px-2 py-1 rounded text-[9px] font-bold hover:bg-slate-300"
                  >
                    Não
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSaveSuccess(false);
                      setNewEvent({
                        id: event.id,
                        title: event.title,
                        date: event.date.split('T')[0],
                        schoolId: event.schoolId,
                        classId: event.classId,
                        slotId: event.slotId,
                        type: event.type,
                        description: event.description
                      });
                      setIsAdding(true);
                    }}
                    className="p-2 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                    title="Editar"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingEventId(event.id); }}
                    className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                    title="Excluir"
                  >
                    <Trash2 size={14} />
                  </button>
                  <div className="text-slate-200 pl-1">
                    <ChevronRight size={14} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {data.events.filter(e => e.type === 'test' || e.type === 'work').length === 0 && (
          <div className="py-16 md:py-20 bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center gap-4 text-center">
            <FileCheck size={40} className="md:w-[48px] md:h-[48px] text-slate-400 dark:text-slate-800" />
            <div>
              <p className="text-slate-500 font-black uppercase text-[10px] md:text-xs tracking-tight">Nenhuma avaliação agendada</p>
              <p className="text-slate-400 text-[9px] md:text-[10px] uppercase mt-1">Sua grade de avaliações está livre.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AssessmentManagement;