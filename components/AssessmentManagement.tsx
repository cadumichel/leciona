import React, { useState, useMemo, useEffect } from 'react';
import { AppData, SchoolEvent, EventType, TimeSlot, DayOfWeek, LessonLog } from '../types';
import { FileCheck, Calendar, Trash2, AlertTriangle, Plus, X, Layers, Clock, ArrowRight, ChevronRight, School as SchoolIcon } from 'lucide-react';
import { isWeekend, isHoliday, getHolidayName, getDayOfWeekFromDate } from '../utils';

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

  // FIX: Sincroniza a escola selecionada com os dados reais
  const activeSchool = useMemo(() => data.schools.find(s => s.id === newEvent.schoolId), [data.schools, newEvent.schoolId]);
  
  // FIX: Se abrir o modal e não tiver escola selecionada (ou ID inválido), seleciona a primeira
  useEffect(() => {
    if (isAdding) {
        // Se schoolId estiver vazio ou não existir mais na lista de escolas
        const isValidSchool = data.schools.some(s => s.id === newEvent.schoolId);
        if (!newEvent.schoolId || !isValidSchool) {
            if (data.schools.length > 0) {
                setNewEvent(prev => ({ ...prev, schoolId: data.schools[0].id }));
            }
        }
    }
  }, [isAdding, data.schools, newEvent.schoolId]);

  // Lógica de validação extraída para evitar dependência de estado stale
  const validateDateLogic = (dateStr: string, schoolId: string, classId: string) => {
    // Usamos T12:00:00 para garantir que a verificação de feriado (que usa new Date) caia no dia correto
    const date = new Date(dateStr + 'T12:00:00');
    let warning = '';
    let invalid = false;

    // Checagem de Feriado
    if (isHoliday(date)) { 
        warning = `Feriado: ${getHolidayName(date)}.`; 
        invalid = true; 
    } else {
        // Checagem de Recesso
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
    
    // Verificação de eventos bloqueantes
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
    // Atualiza estado preservando outros campos
    setNewEvent(prev => ({ ...prev, date: dateStr, slotId: '' }));
  };

  // Handler específico para mudança de turma
  const handleClassChange = (classId: string) => {
    // Valida usando a NOVA turma e a data ATUAL
    const { warning, invalid } = validateDateLogic(newEvent.date!, newEvent.schoolId!, classId);
    setIsInvalidDate(invalid);
    setDateWarning(warning);
    // Atualiza estado preservando a data
    setNewEvent(prev => ({ ...prev, classId, slotId: '' }));
  };

  const handleSaveEvent = () => {
    if (!newEvent.title || !newEvent.classId || !newEvent.slotId || isInvalidDate) return;
    
    // ISO Safe
    const safeDateISO = new Date(newEvent.date + 'T12:00:00').toISOString();

    const eventId = crypto.randomUUID();
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

    const filteredLogs = data.logs.filter(l => 
      !(l.date.split('T')[0] === newEvent.date && l.schoolId === event.schoolId && l.slotId === event.slotId)
    );

    onUpdateData({ 
      events: [...data.events, event],
      logs: [...filteredLogs, newLog] 
    });

    setIsAdding(false);
    setNewEvent({ ...newEvent, title: '', classId: '', slotId: '', description: '' });
  };

  const restrictedAvailableSlots = useMemo(() => {
    if (!activeSchool || !newEvent.date || !newEvent.classId || isInvalidDate) return [];
    
    const dayOfWeek = getDayOfWeekFromDate(newEvent.date);

    const validEntries = data.schedules.filter(s => 
      Number(s.dayOfWeek) === dayOfWeek && 
      s.schoolId === newEvent.schoolId && 
      s.classId === newEvent.classId
    );
    
    const slots: TimeSlot[] = [];
    validEntries.forEach(entry => {
      const shift = activeSchool.shifts.find(sh => sh.id === entry.shiftId);
      const slot = shift?.slots.find(sl => sl.id === entry.slotId);
      if (slot) slots.push(slot);
    });
    return slots;
  }, [activeSchool, newEvent.date, newEvent.classId, data.schedules, isInvalidDate]);

  return (
    <div className="space-y-6 md:space-y-8 pb-20">
      <div className="bg-white dark:bg-slate-900 p-5 md:p-8 rounded-[32px] md:rounded-[40px] border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg md:text-xl font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-3">
             <FileCheck className="text-blue-600 w-5 h-5 md:w-6 md:h-6" /> Avaliações
          </h3>
          <p className="text-[9px] md:text-[10px] text-slate-500 font-black uppercase tracking-widest mt-1">Planeje provas, trabalhos e atividades avaliativas.</p>
        </div>
        <button 
            onClick={() => {
                setIsAdding(true);
                // Reseta form ao abrir para evitar dados presos
                setNewEvent(prev => ({
                    ...prev,
                    title: '',
                    schoolId: data.schools[0]?.id || '',
                    classId: '',
                    slotId: '',
                    description: ''
                }));
            }} 
            className="bg-blue-600 text-white px-6 md:px-8 py-3 md:py-3.5 rounded-2xl font-black uppercase text-[9px] md:text-xs tracking-widest shadow-xl shadow-blue-100 hover:brightness-110 transition-all flex items-center gap-2"
        >
           <Plus size={16} className="md:w-[18px] md:h-[18px]" /> Nova Avaliação
        </button>
      </div>

      {isAdding && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[32px] md:rounded-[40px] p-6 md:p-8 w-full max-w-2xl shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
             <div className="flex justify-between items-center mb-6 md:mb-8"><h3 className="text-lg md:text-xl font-black uppercase">Agendar Avaliação</h3><button onClick={() => setIsAdding(false)} className="text-slate-300 hover:text-slate-600"><X /></button></div>
             
             <div className="space-y-4 md:space-y-6">
                <div className="grid grid-cols-2 gap-4">
                   <button onClick={() => setNewEvent({...newEvent, type: 'test'})} className={`py-4 rounded-xl md:rounded-2xl font-black uppercase text-[9px] md:text-[10px] tracking-widest border-2 transition-all ${newEvent.type === 'test' ? 'bg-red-50 border-red-500 text-red-600 shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>Prova</button>
                   <button onClick={() => setNewEvent({...newEvent, type: 'work'})} className={`py-4 rounded-xl md:rounded-2xl font-black uppercase text-[9px] md:text-[10px] tracking-widest border-2 transition-all ${newEvent.type === 'work' ? 'bg-blue-50 border-blue-500 text-blue-600 shadow-lg' : 'bg-slate-50 border-transparent text-slate-400'}`}>Trabalho</button>
                </div>

                <div>
                  <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Assunto / Título</label>
                  <input type="text" value={newEvent.title} onChange={e => setNewEvent(prev => ({...prev, title: e.target.value}))} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl md:rounded-2xl px-4 md:px-5 py-3 font-bold dark:text-white text-sm" placeholder="Ex: Prova Mensal de História" />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                   <div>
                     <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Escola</label>
                     <select value={newEvent.schoolId} onChange={e => setNewEvent(prev => ({...prev, schoolId: e.target.value, classId: '', slotId: ''}))} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl md:rounded-2xl px-4 md:px-5 py-3 font-bold dark:text-white text-sm">
                        {data.schools.length === 0 && <option value="">Nenhuma escola cadastrada</option>}
                        {data.schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                     </select>
                   </div>
                   <div>
                     <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Turma</label>
                     <select 
                        value={newEvent.classId} 
                        onChange={e => handleClassChange(e.target.value)} 
                        className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl md:rounded-2xl px-4 md:px-5 py-3 font-bold dark:text-white text-sm"
                        disabled={!activeSchool}
                     >
                        <option value="">Selecione...</option>
                        {activeSchool?.classes.map(c => <option key={c} value={c}>{c}</option>)}
                     </select>
                   </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                   <div>
                     <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Data</label>
                     <input type="date" value={newEvent.date} onChange={e => handleDateChange(e.target.value)} className={`w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl md:rounded-2xl px-4 md:px-5 py-3 font-bold dark:text-white text-sm ${isInvalidDate ? 'ring-2 ring-pink-500' : ''}`} />
                     {dateWarning && <p className="text-[8px] md:text-[9px] text-pink-600 font-black uppercase mt-1 ml-1">{dateWarning}</p>}
                   </div>
                   <div>
                     <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Horário (Slot)</label>
                     <select disabled={!newEvent.classId || isInvalidDate} value={newEvent.slotId} onChange={e => setNewEvent(prev => ({...prev, slotId: e.target.value}))} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl md:rounded-2xl px-4 md:px-5 py-3 font-bold dark:text-white disabled:opacity-50 text-sm">
                        <option value="">{restrictedAvailableSlots.length > 0 ? 'Escolha o horário...' : (newEvent.classId ? 'Nenhum horário disponível' : 'Selecione a turma')}</option>
                        {restrictedAvailableSlots.map(s => <option key={s.id} value={s.id}>{s.label} ({s.startTime})</option>)}
                     </select>
                   </div>
                </div>

                <div>
                   <label className="block text-[9px] md:text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 ml-1">Descrição / Observações</label>
                   <textarea value={newEvent.description} onChange={e => setNewEvent(prev => ({...prev, description: e.target.value}))} rows={3} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl md:rounded-2xl px-4 md:px-5 py-3 font-bold dark:text-white text-sm" placeholder="Capítulos, observações para os alunos..." />
                </div>
             </div>

             <div className="mt-8 flex gap-4">
                <button onClick={() => setIsAdding(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-[9px] md:text-[10px]">Cancelar</button>
                <button 
                  onClick={handleSaveEvent} 
                  disabled={!newEvent.title || !newEvent.slotId || isInvalidDate} 
                  className={`flex-1 py-4 rounded-xl md:rounded-2xl font-black uppercase text-[9px] md:text-[10px] tracking-widest transition-all ${(!newEvent.title || !newEvent.slotId || isInvalidDate) ? 'bg-slate-100 text-slate-300' : 'bg-blue-600 text-white shadow-xl shadow-blue-100'}`}
                >
                  Salvar Avaliação
                </button>
             </div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {data.events.filter(e => e.type === 'test' || e.type === 'work').sort((a,b) => a.date.localeCompare(b.date)).map(event => {
          const school = data.schools.find(s => s.id === event.schoolId);
          const color = school?.color || '#3b82f6';

          return (
            <div key={event.id} className="bg-white dark:bg-slate-900 p-5 md:p-6 rounded-[24px] md:rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm relative group hover:shadow-xl transition-all duration-300" style={{ borderColor: color + '30', backgroundColor: color + '05' }}>
               <div className="flex justify-between items-start mb-3 md:mb-4">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl md:rounded-2xl flex items-center justify-center border-b-2" style={{ backgroundColor: color + '15', color: color, borderColor: color + '30' }}>
                     <FileCheck size={20} className="md:w-[22px] md:h-[22px]" />
                  </div>
                  <button onClick={() => onUpdateData({ events: data.events.filter(e => e.id !== event.id) })} className="text-slate-200 hover:text-red-500 transition-colors p-1"><Trash2 size={16} /></button>
               </div>
               <div className="flex-1">
                  <h4 className="text-sm font-black text-slate-800 dark:text-white uppercase truncate mb-1">{event.title}</h4>
                  <div className="flex items-center gap-2 mb-3">
                     <span className="text-[8px] font-black px-2 py-0.5 rounded-lg uppercase" style={{ backgroundColor: color + '20', color: color }}>
                        {event.type === 'test' ? 'Prova' : 'Trabalho'}
                     </span>
                     <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Turma {event.classId}</span>
                  </div>
                  <div className="space-y-1.5">
                     <div className="flex items-center gap-2 text-[9px] md:text-[10px] font-bold text-slate-500">
                        <Calendar size={12} className="text-slate-300" />
                        {/* Display date without timezone shift issue */}
                        <span>{new Date(event.date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</span>
                     </div>
                     <div className="flex items-center gap-2 text-[9px] md:text-[10px] font-bold text-slate-500">
                        <SchoolIcon size={12} className="text-slate-300" />
                        <span className="truncate" style={{ color: color }}>{school?.name}</span>
                     </div>
                  </div>
               </div>
               <div className="mt-3 md:mt-4 pt-3 md:pt-4 border-t border-slate-50 dark:border-slate-800 flex justify-between items-center text-[8px] md:text-[9px] font-black uppercase" style={{ color: color }}>
                  <span>Agendado</span>
                  <ChevronRight size={14} />
               </div>
            </div>
          );
        })}
        {data.events.filter(e => e.type === 'test' || e.type === 'work').length === 0 && (
          <div className="col-span-full py-16 md:py-20 bg-white dark:bg-slate-900 rounded-[32px] md:rounded-[48px] border-2 border-dashed border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center gap-4 text-center">
             <FileCheck size={40} className="md:w-[48px] md:h-[48px] text-slate-400 dark:text-slate-800" />
             <div>
               <p className="text-slate-500 font-black uppercase text-[10px] md:text-xs tracking-widest">Nenhuma avaliação agendada</p>
               <p className="text-slate-400 text-[9px] md:text-[10px] uppercase mt-1">Sua grade de avaliações está livre.</p>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AssessmentManagement;