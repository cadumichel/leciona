import React, { useState, useMemo, useEffect } from 'react';
import { AppData, SchoolEvent, EventType, DayOfWeek, LessonLog } from '../types';
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
  Info
} from 'lucide-react';
import { getDayOfWeekFromDate, getShortWeekDay, getDayMonth } from '../utils';

interface AgendaManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
}

const AgendaManagement: React.FC<AgendaManagementProps> = ({ data, onUpdateData }) => {
  const [activeSchoolId, setActiveSchoolId] = useState<string>('all');
  const [isAddingEvent, setIsAddingEvent] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);

  // Filtra eventos da escola selecionada na visualização principal
  const schoolEvents = useMemo(() => {
    return data.events.filter(e => {
      const isNotAssessment = !['test', 'work'].includes(e.type);
      const matchesSchool = activeSchoolId === 'all' || e.schoolId === activeSchoolId;

      const school = data.schools.find(s => s.id === e.schoolId);
      if (school && school.deleted) return false;

      return isNotAssessment && matchesSchool;
    });
  }, [data.events, activeSchoolId]);

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

  // Atualiza o form quando abre o modal ou muda a escola ativa
  useEffect(() => {
    if (!isAddingEvent) {
      // Se 'all' estiver selecionado, pega a primeira escola como padrão para o formulário
      const firstActive = data.schools.find(s => !s.deleted);
      setEventForm(prev => ({
        ...prev,
        schoolId: activeSchoolId === 'all' ? (firstActive?.id || '') : activeSchoolId
      }));
      setConflictWarning(null);
    }
  }, [activeSchoolId, isAddingEvent, data.schools]);

  // Escola selecionada DENTRO do modal (para popular os selects de turno/turma)
  const formSchool = useMemo(() => data.schools.find(s => s.id === eventForm.schoolId), [data.schools, eventForm.schoolId]);

  // Efeito para detectar conflitos em tempo real
  useEffect(() => {
    setConflictWarning(null);

    // Só verifica se estiver cancelando aulas e tiver data/escola selecionada
    if (!eventForm.blocksClasses || !eventForm.schoolId || !eventForm.date) return;

    const dateStr = eventForm.date;

    // Busca avaliações (Provas/Trabalhos) na mesma data e escola
    const assessments = data.events.filter(e =>
      e.schoolId === eventForm.schoolId &&
      e.date.startsWith(dateStr) &&
      ['test', 'work'].includes(e.type)
    );

    if (assessments.length === 0) return;

    // Verifica sobreposição de escopo
    const conflict = assessments.find(assessment => {
      // 1. Se cancela TUDO, conflita com qualquer prova
      if (eventForm.cancelScope === 'all') return true;

      // 2. Se cancela TURMA, conflita se a prova for nessa turma
      if (eventForm.cancelScope === 'class') {
        return assessment.classId === eventForm.classId;
      }

      // 3. Se cancela TURNO, conflita se a prova estiver num slot desse turno
      if (eventForm.cancelScope === 'shift') {
        const shift = formSchool?.shifts.find(s => s.id === eventForm.shiftId);
        if (assessment.slotId && shift) {
          return shift.slots.some(sl => sl.id === assessment.slotId);
        }
        // Se não conseguir determinar o slot da prova, assume sem conflito ou conflito (depende da rigidez)
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

  const handleSaveEvent = () => {
    if (!eventForm.title || !eventForm.schoolId) return;

    // CORREÇÃO DATA: Usar T12:00:00 para ISO string segura (não volta para o dia anterior)
    const safeDateISO = new Date(eventForm.date + 'T12:00:00').toISOString();
    const dateStr = eventForm.date;

    // --- BLOQUEIO DE SEGURANÇA PARA CONTEÚDOS REGISTRADOS ---
    // Não permitimos cancelar aulas se já houver Diário de Classe (conteúdo) lançado
    if (eventForm.blocksClasses) {
      const logConflict = data.logs.some(l => {
        if (l.schoolId !== eventForm.schoolId || !l.date.startsWith(dateStr)) return false;

        if (eventForm.cancelScope === 'all') return true;

        if (eventForm.cancelScope === 'shift') {
          const shift = formSchool?.shifts.find(s => s.id === eventForm.shiftId);
          const isSlotInShift = shift?.slots.some(sl => sl.id === l.slotId);
          return isSlotInShift;
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

    // Preencher automaticamente logs para eventos de cancelamento
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

    onUpdateData({
      events: [...data.events, newEvent],
      logs: [...data.logs, ...newLogs]
    });

    setIsAddingEvent(false);
    // Reset form
    setEventForm({
      schoolId: activeSchoolId === 'all' ? (data.schools[0]?.id || '') : activeSchoolId,
      type: 'meeting',
      title: '',
      date: new Date().toISOString().split('T')[0],
      blocksClasses: false,
      cancelScope: 'all',
      shiftId: '',
      classId: '',
      description: ''
    });
  };

  const getEventScope = (event: SchoolEvent, school?: any) => {
    if (event.classId) return `Turma ${event.classId}`;
    if (event.slotId) {
      const shift = school?.shifts.find((s: any) => s.id === event.slotId);
      return shift ? `Turno ${shift.name}` : `Turno/Horário Específico`;
    }
    return 'Geral / Dia Todo';
  };

  return (
    <div className="space-y-6 md:space-y-8 pb-20">
      <div className="bg-white dark:bg-slate-900 p-4 md:p-6 rounded-lg md:rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center gap-4 transition-all">
        <div className="flex-1">
          <label className="block text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-tight mb-1.5 flex items-center gap-1"><SchoolIcon size={12} /> Visualizar Agenda de:</label>
          <div className="relative">
            <select value={activeSchoolId} onChange={e => setActiveSchoolId(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg md:rounded-xl px-4 md:px-5 py-3 font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-primary cursor-pointer appearance-none text-sm">
              <option value="all">Todas Instituições</option>
              {data.schools.filter(s => !s.deleted).sort((a, b) => a.name.localeCompare(b.name)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 p-5 md:p-8 rounded-xl md:rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-4 md:space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg md:text-xl font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-3">
            <Calendar className="text-orange-500 w-5 h-5 md:w-6 md:h-6" /> Agenda Escolar
          </h3>
          <button onClick={() => setIsAddingEvent(true)} className="bg-orange-500 text-white px-4 md:px-5 py-2 md:py-2.5 rounded-lg font-black uppercase text-[9px] md:text-[10px] tracking-tight shadow-lg shadow-orange-100 hover:brightness-110 transition-all flex items-center gap-2">
            <Plus size={14} className="md:w-[16px] md:h-[16px]" /> Novo Registro
          </button>
        </div>
        <div className="bg-slate-50 dark:bg-slate-800/50 p-4 md:p-6 rounded-xl md:rounded-2xl border border-slate-100 dark:border-slate-800">
          <div className="grid gap-3 md:gap-4">
            {schoolEvents.length > 0 ? schoolEvents.map(event => {
              const school = data.schools.find(s => s.id === event.schoolId);
              const eventColor = school ? school.color : '#f97316';

              return (
                <div key={event.id} className="bg-white dark:bg-slate-900 p-2.5 md:p-3 rounded-lg md:rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm transition-all flex items-center gap-3 md:gap-4 hover:shadow-md" style={{ borderColor: `${eventColor}40` }}>
                  <div className="w-8 h-8 md:w-10 md:h-10 rounded-md md:rounded-lg flex flex-col items-center justify-center shrink-0" style={{ backgroundColor: `${eventColor}20`, color: eventColor }}>
                    <span className="text-[7px] md:text-[8px] font-black uppercase leading-none mb-0.5">{getShortWeekDay(event.date)}</span>
                    <span className="text-[9px] md:text-[10px] font-black leading-none">{getDayMonth(event.date)}</span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <h4 className="font-black text-slate-800 dark:text-white uppercase text-[10px] md:text-xs truncate mb-0.5">{event.title}</h4>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[8px] md:text-[9px] text-slate-400 font-bold uppercase truncate">{
                        {
                          'meeting': 'Reunião',
                          'festivity': 'Evento',
                          'trip': 'Passeio',
                          'material': 'Material',
                          'other': 'Outro',
                          'test': 'Prova',
                          'work': 'Trabalho'
                        }[event.type] || event.type
                      }</p>
                      {activeSchoolId === 'all' && (
                        <span className="text-[6px] md:text-[7px] font-black bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-md uppercase truncate max-w-[80px] md:max-w-[100px]">
                          {school?.name}
                        </span>
                      )}
                      <span className="text-[6px] md:text-[7px] font-black bg-orange-50 dark:bg-orange-900/30 text-orange-600 px-1.5 py-0.5 rounded-md uppercase">
                        {getEventScope(event, school)}
                      </span>
                      {event.blocksClasses && (
                        <span className="text-[6px] md:text-[7px] font-black bg-red-100 dark:bg-red-900/30 text-red-600 px-1.5 py-0.5 rounded-md uppercase">
                          Cancela Aulas
                        </span>
                      )}
                    </div>
                  </div>
                  {deletingEventId === event.id ? (
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[8px] font-bold text-slate-600 uppercase">Confirmar?</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            onUpdateData({ events: data.events.filter(e => e.id !== event.id) });
                            setDeletingEventId(null);
                          }}
                          className="bg-red-500 text-white px-1.5 py-0.5 rounded text-[9px] font-bold"
                        >
                          Sim
                        </button>
                        <button
                          onClick={() => setDeletingEventId(null)}
                          className="bg-slate-300 text-slate-700 px-1.5 py-0.5 rounded text-[9px] font-bold"
                        >
                          Não
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingEventId(event.id)}
                      className="text-slate-200 hover:text-red-500 p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            }) : (
              <div className="py-10 text-center rounded-xl">
                <CalendarDays className="mx-auto text-slate-200 mb-2" size={32} />
                <p className="text-slate-500 font-bold uppercase text-[9px]">Sem eventos</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {isAddingEvent && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl md:rounded-2xl p-6 md:p-8 w-full max-w-xl shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6 md:mb-8"><h3 className="text-lg md:text-xl font-black uppercase text-slate-800 dark:text-white">Novo Registro Escolar</h3><button onClick={() => setIsAddingEvent(false)} className="text-slate-300 hover:text-slate-600"><X /></button></div>
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
                        <p className="text-[9px] md:text-[10px] font-bold text-red-600 dark:text-red-400 uppercase leading-relaxed">
                          {conflictWarning}
                        </p>
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
                          <button
                            key={scope.id}
                            type="button"
                            onClick={() => setEventForm({ ...eventForm, cancelScope: scope.id as any })}
                            className={`flex flex-col items-center justify-center p-2 rounded-lg border-2 transition-all ${eventForm.cancelScope === scope.id ? 'bg-white dark:bg-slate-800 border-orange-500 text-orange-600 shadow-sm' : 'bg-orange-100/30 dark:bg-orange-900/20 border-transparent text-orange-400'}`}
                          >
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
                          {formSchool?.classes.map(c => <option key={c} value={c}>{c}</option>)}
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
            <div className="mt-8 mb-4 flex gap-4"><button onClick={() => setIsAddingEvent(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-[9px] md:text-[10px]">Cancelar</button><button onClick={handleSaveEvent} className="flex-1 py-4 bg-orange-500 text-white rounded-lg md:rounded-xl font-black uppercase text-[9px] md:text-[10px] shadow-xl shadow-orange-100">Salvar Registro</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgendaManagement;