import React, { useState, useEffect } from 'react';
import { AppData, School, Shift, TimeSlot } from '../types';
import { COLORS } from '../constants';
import { Plus, Trash2, Edit3, Save, X, Clock, Coffee, ArrowRight, Wand2, ChevronUp, ChevronDown, Palette, MoreHorizontal } from 'lucide-react';
import { addMinutesToTime, parseTimeToMinutes } from '../utils';

interface SchoolManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
}

const SchoolManagement: React.FC<SchoolManagementProps> = ({ data, onUpdateData }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSchoolId, setEditingSchoolId] = useState<string | null>(null);
  const [newSchool, setNewSchool] = useState<Partial<School>>({
    name: '',
    color: COLORS[0],
    classes: [],
    shifts: []
  });

  const [tempClass, setTempClass] = useState('');
  const [tempShiftName, setTempShiftName] = useState('');
  const [defaultLessonDuration, setDefaultLessonDuration] = useState(45);
  const [breakAfterLesson, setBreakAfterLesson] = useState(3);

  const openEditModal = (school: School) => {
    setEditingSchoolId(school.id);
    setNewSchool({ ...school });
    setIsModalOpen(true);
  };

  const openAddModal = () => {
    setEditingSchoolId(null);
    setNewSchool({
      name: '',
      color: COLORS[0],
      classes: [],
      shifts: []
    });
    setIsModalOpen(true);
  };

  const handleSaveSchool = () => {
    if (!newSchool.name || (newSchool.shifts && newSchool.shifts.length === 0)) {
      alert('Por favor, preencha o nome da escola e adicione pelo menos um turno.');
      return;
    }

    if (editingSchoolId) {
      const updatedSchools = data.schools.map(s => 
        s.id === editingSchoolId ? { ...(newSchool as School) } : s
      );
      onUpdateData({ schools: updatedSchools });
    } else {
      const schoolToAdd: School = {
        id: crypto.randomUUID(),
        name: newSchool.name!,
        color: newSchool.color!,
        classes: newSchool.classes || [],
        subjects: [],
        shifts: newSchool.shifts || []
      };
      onUpdateData({ schools: [...data.schools, schoolToAdd] });
    }

    setIsModalOpen(false);
    setEditingSchoolId(null);
  };

  // ... (código dos métodos auxiliares createStandardShift, addShift, etc. mantido igual)
  const createStandardShift = (type: 'matutino' | 'vespertino' | 'noturno') => {
    const name = type === 'matutino' ? 'Matutino' : type === 'vespertino' ? 'Vespertino' : 'Noturno';
    const startTime = type === 'matutino' ? '07:20' : type === 'vespertino' ? '13:30' : '19:00';
    const duration = defaultLessonDuration;
    const breakDuration = 20;
    
    let currentTime = startTime;
    const slots: TimeSlot[] = [];

    const maxLessons = type === 'noturno' ? 5 : 6; 

    for (let i = 1; i <= maxLessons; i++) {
      const classEndTime = addMinutesToTime(currentTime, duration);
      slots.push({
        id: crypto.randomUUID(),
        startTime: currentTime,
        endTime: classEndTime,
        type: 'class',
        label: `${i}ª Aula`
      });
      currentTime = classEndTime;

      if (i === breakAfterLesson && i < maxLessons) {
        const breakEndTime = addMinutesToTime(currentTime, breakDuration);
        slots.push({
          id: crypto.randomUUID(),
          startTime: currentTime,
          endTime: breakEndTime,
          type: 'break',
          label: 'Intervalo'
        });
        currentTime = breakEndTime;
      }
    }

    const newShift: Shift = {
      id: crypto.randomUUID(),
      name,
      slots
    };

    setNewSchool({ ...newSchool, shifts: [...(newSchool.shifts || []), newShift] });
  };

  const addShift = () => {
    if (!tempShiftName) return;
    const newShift: Shift = {
      id: crypto.randomUUID(),
      name: tempShiftName,
      slots: []
    };
    setNewSchool({ ...newSchool, shifts: [...(newSchool.shifts || []), newShift] });
    setTempShiftName('');
  };

  const removeShift = (shiftId: string) => {
    setNewSchool({
      ...newSchool,
      shifts: newSchool.shifts?.filter(s => s.id !== shiftId)
    });
  };

  const addSlot = (shiftId: string, type: 'class' | 'break') => {
    const shift = newSchool.shifts?.find(s => s.id === shiftId);
    if (!shift) return;

    const lastSlot = shift.slots[shift.slots.length - 1];
    const startTime = lastSlot ? lastSlot.endTime : '07:00';
    const duration = type === 'class' ? defaultLessonDuration : 20;
    const endTime = addMinutesToTime(startTime, duration);

    const classCount = shift.slots.filter(s => s.type === 'class').length + 1;
    const newSlot: TimeSlot = {
      id: crypto.randomUUID(),
      startTime,
      endTime,
      type,
      label: type === 'class' ? `${classCount}ª Aula` : 'Intervalo'
    };

    const updatedShifts = newSchool.shifts?.map(s => 
      s.id === shiftId ? { ...s, slots: [...s.slots, newSlot] } : s
    );
    setNewSchool({ ...newSchool, shifts: updatedShifts });
  };

  const cascadeUpdateShift = (shiftId: string, startFromSlotId: string, newStartTime: string) => {
    const updatedShifts = newSchool.shifts?.map(s => {
      if (s.id === shiftId) {
        const newSlots = [...s.slots];
        let currentTime = newStartTime;
        let startUpdating = false;

        for (let i = 0; i < newSlots.length; i++) {
          if (newSlots[i].id === startFromSlotId) startUpdating = true;
          
          if (startUpdating) {
            const slotDuration = parseTimeToMinutes(newSlots[i].endTime) - parseTimeToMinutes(newSlots[i].startTime);
            newSlots[i].startTime = currentTime;
            newSlots[i].endTime = addMinutesToTime(currentTime, slotDuration);
            currentTime = newSlots[i].endTime;
          }
        }
        return { ...s, slots: newSlots };
      }
      return s;
    });
    setNewSchool({ ...newSchool, shifts: updatedShifts });
  };

  const reorderShiftSlots = (shiftId: string) => {
    const updatedShifts = newSchool.shifts?.map(s => {
      if (s.id === shiftId) {
        const slots = [...s.slots];
        // Renumerar as aulas
        let classCounter = 1;
        slots.forEach(sl => {
          if (sl.type === 'class') {
            sl.label = `${classCounter}ª Aula`;
            classCounter++;
          }
        });

        // Recalcular todos os tempos a partir do primeiro slot
        if (slots.length > 0) {
          let currentTime = slots[0].startTime;
          for (let i = 0; i < slots.length; i++) {
            const dur = parseTimeToMinutes(slots[i].endTime) - parseTimeToMinutes(slots[i].startTime);
            slots[i].startTime = currentTime;
            slots[i].endTime = addMinutesToTime(currentTime, dur);
            currentTime = slots[i].endTime;
          }
        }
        return { ...s, slots };
      }
      return s;
    });
    setNewSchool({ ...newSchool, shifts: updatedShifts });
  };

  const moveSlot = (shiftId: string, slotId: string, direction: 'up' | 'down') => {
    const updatedShifts = newSchool.shifts?.map(s => {
      if (s.id === shiftId) {
        const slots = [...s.slots];
        const index = slots.findIndex(sl => sl.id === slotId);
        if (direction === 'up' && index > 0) {
          [slots[index], slots[index - 1]] = [slots[index - 1], slots[index]];
        } else if (direction === 'down' && index < slots.length - 1) {
          [slots[index], slots[index + 1]] = [slots[index + 1], slots[index]];
        }
        return { ...s, slots };
      }
      return s;
    });
    
    setNewSchool({ ...newSchool, shifts: updatedShifts });
    setTimeout(() => reorderShiftSlots(shiftId), 0);
  };

  const updateSlot = (shiftId: string, slotId: string, field: keyof TimeSlot, value: string) => {
    if (field === 'startTime') {
      cascadeUpdateShift(shiftId, slotId, value);
      return;
    }

    const updatedShifts = newSchool.shifts?.map(s => {
      if (s.id === shiftId) {
        return {
          ...s,
          slots: s.slots.map(sl => {
            if (sl.id === slotId) {
              return { ...sl, [field]: value };
            }
            return sl;
          })
        };
      }
      return s;
    });
    setNewSchool({ ...newSchool, shifts: updatedShifts });
  };

  const updateBreakDuration = (shiftId: string, slotId: string, minutes: string) => {
    const updatedShifts = newSchool.shifts?.map(s => {
      if (s.id === shiftId) {
        const slots = s.slots.map(sl => {
          if (sl.id === slotId) {
            return { ...sl, endTime: addMinutesToTime(sl.startTime, parseInt(minutes) || 0) };
          }
          return sl;
        });
        
        const idx = slots.findIndex(sl => sl.id === slotId);
        let currentTime = slots[idx].endTime;
        for (let i = idx + 1; i < slots.length; i++) {
          const dur = parseTimeToMinutes(slots[i].endTime) - parseTimeToMinutes(slots[i].startTime);
          slots[i].startTime = currentTime;
          slots[i].endTime = addMinutesToTime(currentTime, dur);
          currentTime = slots[i].endTime;
        }
        
        return { ...s, slots };
      }
      return s;
    });
    setNewSchool({ ...newSchool, shifts: updatedShifts });
  };

  const removeSlot = (shiftId: string, slotId: string) => {
    const updatedShifts = newSchool.shifts?.map(s => {
      if (s.id === shiftId) {
        return { ...s, slots: s.slots.filter(sl => sl.id !== slotId) };
      }
      return s;
    });
    setNewSchool({ ...newSchool, shifts: updatedShifts });
    setTimeout(() => reorderShiftSlots(shiftId), 0);
  };

  const deleteSchool = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Deseja excluir esta escola? Todos os horários vinculados serão removidos permanentemente.')) {
      onUpdateData({ 
        schools: data.schools.filter(s => s.id !== id),
        schedules: data.schedules.filter(s => s.schoolId !== id),
        logs: data.logs.filter(l => l.schoolId !== id),
        events: data.events.filter(ev => ev.schoolId !== id)
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-slate-500">Cadastre ou edite suas escolas e horários padrão.</p>
        <button 
          onClick={openAddModal}
          className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-100 font-bold"
        >
          <Plus size={18} /> Nova Escola
        </button>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          {/* ... (conteúdo do modal mantido, apenas wrapper se necessário) ... */}
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[95vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <div className="sticky top-0 bg-white px-4 md:px-8 py-4 md:py-6 border-b border-slate-100 flex justify-between items-center z-10">
              <h3 className="text-lg md:text-xl font-bold text-slate-800">
                {editingSchoolId ? 'Editar Escola' : 'Cadastro de Escola'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-2"><X /></button>
            </div>
            
            <div className="p-4 md:p-8 space-y-6 md:space-y-8">
              <div className="grid md:grid-cols-2 gap-6 md:gap-8 pb-6 md:pb-8 border-b border-slate-100">
                <div className="space-y-4 md:space-y-5">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Nome da Escola</label>
                    <input 
                      type="text" 
                      value={newSchool.name}
                      onChange={e => setNewSchool({ ...newSchool, name: e.target.value })}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      placeholder="Ex: Colégio Estadual X"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Cor de Identificação</label>
                    <div className="flex flex-wrap gap-2 items-center">
                      {COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setNewSchool({ ...newSchool, color: c })}
                          className={`w-9 h-9 rounded-full border-2 transition-all ${newSchool.color === c ? 'border-slate-800 scale-110 shadow-md ring-2 ring-slate-100' : 'border-transparent hover:scale-105'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <div className="relative group">
                        <div className={`w-9 h-9 rounded-full border-2 flex items-center justify-center transition-all bg-white cursor-pointer ${!COLORS.includes(newSchool.color || '') ? 'border-slate-800 ring-2 ring-slate-100' : 'border-slate-200 hover:border-slate-400'}`}>
                           <Palette size={16} className="text-slate-400" />
                        </div>
                        <input 
                           type="color" 
                           value={newSchool.color} 
                           onChange={e => setNewSchool({ ...newSchool, color: e.target.value })} 
                           className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Turmas Atendidas</label>
                  <div className="flex gap-2 mb-3">
                    <input 
                      type="text" 
                      value={tempClass}
                      onChange={e => setTempClass(e.target.value)}
                      className="flex-1 px-4 py-3 border border-slate-200 rounded-xl outline-none"
                      placeholder="Adicionar turma..."
                      onKeyDown={e => { if(e.key === 'Enter') { 
                        if(tempClass) {
                          setNewSchool({...newSchool, classes: [...(newSchool.classes || []), tempClass]});
                          setTempClass('');
                        }
                      }}}
                    />
                    <button 
                      onClick={() => {
                        if(tempClass) {
                          setNewSchool({...newSchool, classes: [...(newSchool.classes || []), tempClass]});
                          setTempClass('');
                        }
                      }}
                      className="p-3 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors"
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1">
                    {newSchool.classes?.map((c, i) => (
                      <span key={i} className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-2 border border-slate-200">
                        {c}
                        <button onClick={() => setNewSchool({...newSchool, classes: newSchool.classes?.filter((_, idx) => idx !== i)})} className="text-slate-400 hover:text-red-500 transition-colors"><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-blue-50/50 p-3 md:p-4 rounded-[24px] border border-blue-100 mb-6">
                  <div className="flex items-center gap-2 mb-3">
                     <Wand2 size={16} className="text-blue-600"/>
                     <h4 className="font-black text-blue-800 uppercase text-xs tracking-widest">Assistente de Criação</h4>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 md:gap-4 items-end">
                    <div className="flex-1 min-w-[100px] md:min-w-[120px]">
                      <label className="block text-[8px] md:text-[9px] font-black text-blue-600 uppercase tracking-widest mb-1.5">Duração (min)</label>
                      <input 
                        type="number" 
                        value={defaultLessonDuration} 
                        onChange={e => setDefaultLessonDuration(parseInt(e.target.value) || 45)}
                        className="w-full bg-white border border-blue-100 rounded-lg px-3 py-2 font-bold text-blue-700 text-sm outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </div>
                    <div className="flex-1 min-w-[100px] md:min-w-[120px]">
                      <label className="block text-[8px] md:text-[9px] font-black text-blue-600 uppercase tracking-widest mb-1.5">Intervalo após:</label>
                      <select 
                        value={breakAfterLesson}
                        onChange={e => setBreakAfterLesson(parseInt(e.target.value))}
                        className="w-full bg-white border border-blue-100 rounded-lg px-3 py-2 font-bold text-blue-700 text-sm outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer"
                      >
                        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}ª aula</option>)}
                      </select>
                    </div>
                    
                    <div className="flex gap-1 md:gap-2 flex-wrap">
                       <button onClick={() => createStandardShift('matutino')} className="bg-white border border-blue-200 text-blue-600 px-2 md:px-3 py-2 rounded-lg text-[8px] md:text-[9px] font-black uppercase hover:bg-blue-600 hover:text-white transition-all whitespace-nowrap shadow-sm flex-1 md:flex-none">Matutino</button>
                       <button onClick={() => createStandardShift('vespertino')} className="bg-white border border-blue-200 text-blue-600 px-2 md:px-3 py-2 rounded-lg text-[8px] md:text-[9px] font-black uppercase hover:bg-blue-600 hover:text-white transition-all whitespace-nowrap shadow-sm flex-1 md:flex-none">Vespertino</button>
                       <button onClick={() => createStandardShift('noturno')} className="bg-white border border-blue-200 text-blue-600 px-2 md:px-3 py-2 rounded-lg text-[8px] md:text-[9px] font-black uppercase hover:bg-blue-600 hover:text-white transition-all whitespace-nowrap shadow-sm flex-1 md:flex-none">Noturno</button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 text-lg">
                    <Clock className="text-blue-500" size={20} /> Lista de Turnos
                  </h4>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={tempShiftName}
                      onChange={e => setTempShiftName(e.target.value)}
                      placeholder="Turno..."
                      className="px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none w-28 md:w-32 focus:ring-2 focus:ring-blue-400"
                    />
                    <button onClick={addShift} className="bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-bold hover:bg-slate-700 transition">Add</button>
                  </div>
                </div>

                <div className="space-y-4">
                  {newSchool.shifts?.map(shift => (
                    <div key={shift.id} className="bg-slate-50 p-2 md:p-4 rounded-[24px] border border-slate-200 relative group/shift">
                      <div className="flex justify-between items-center mb-3 md:mb-4 pb-2 border-b border-slate-200/60">
                        <span className="font-black text-slate-800 text-sm uppercase tracking-widest pl-2">{shift.name}</span>
                        <div className="flex gap-1 md:gap-2">
                           <button onClick={() => addSlot(shift.id, 'class')} className="text-[9px] md:text-[10px] font-bold text-blue-600 bg-blue-100 px-2 md:px-3 py-1 rounded-lg hover:bg-blue-200 transition-colors">+ Aula</button>
                           <button onClick={() => addSlot(shift.id, 'break')} className="text-[9px] md:text-[10px] font-bold text-amber-600 bg-amber-100 px-2 md:px-3 py-1 rounded-lg hover:bg-amber-200 transition-colors">+ Interv.</button>
                           <button onClick={() => removeShift(shift.id)} className="text-red-300 hover:text-red-500 p-1 transition-colors"><Trash2 size={16} /></button>
                        </div>
                      </div>
                      
                      <div className="space-y-1 md:space-y-2">
                        {shift.slots.map((slot, sIdx) => (
                          <div key={slot.id} className="flex flex-wrap items-center gap-1 md:gap-2 bg-white p-1.5 md:p-2 rounded-xl border border-slate-100 shadow-sm transition-all hover:border-blue-100 group/slot">
                            <div className="flex flex-col gap-0.5">
                               <button disabled={sIdx === 0} onClick={() => moveSlot(shift.id, slot.id, 'up')} className="text-slate-300 hover:text-blue-600 disabled:opacity-0 transition-colors"><ChevronUp size={12}/></button>
                               <button disabled={sIdx === shift.slots.length - 1} onClick={() => moveSlot(shift.id, slot.id, 'down')} className="text-slate-300 hover:text-blue-600 disabled:opacity-0 transition-colors"><ChevronDown size={12}/></button>
                            </div>
                            
                            <div className={`px-1.5 md:px-2 py-1 rounded-lg text-[8px] md:text-[9px] font-black uppercase tracking-widest min-w-[50px] md:min-w-[60px] text-center ${slot.type === 'class' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                              {slot.type === 'class' ? 'Aula' : 'Interv.'}
                            </div>
                            
                            <input 
                              type="text" 
                              value={slot.label} 
                              onChange={e => updateSlot(shift.id, slot.id, 'label', e.target.value)}
                              className="flex-1 min-w-[60px] md:min-w-[80px] text-xs font-black text-slate-700 outline-none border-b border-transparent focus:border-blue-400 bg-transparent py-0.5 uppercase"
                              placeholder="Nome"
                            />

                            <div className="flex items-center gap-1 md:gap-1.5 text-[10px] md:text-xs font-bold text-slate-500 bg-slate-50 px-1.5 md:px-2 py-1 md:py-1.5 rounded-lg border border-slate-100">
                              <input 
                                type="time" 
                                value={slot.startTime} 
                                onChange={e => updateSlot(shift.id, slot.id, 'startTime', e.target.value)}
                                className="bg-transparent outline-none cursor-pointer w-[50px] md:w-[60px]"
                              />
                              <ArrowRight size={10} className="text-slate-300" />
                              
                              {slot.type === 'class' ? (
                                <div className="text-blue-600 font-black w-[50px] md:w-[60px] text-center">{slot.endTime}</div>
                              ) : (
                                <div className="flex items-center gap-1 w-[50px] md:w-[60px] justify-center">
                                  <input 
                                    type="number" 
                                    className="w-6 md:w-8 bg-transparent border-b border-amber-200 outline-none text-amber-600 text-center font-bold"
                                    onChange={(e) => updateBreakDuration(shift.id, slot.id, e.target.value)}
                                    defaultValue={parseTimeToMinutes(slot.endTime) - parseTimeToMinutes(slot.startTime)}
                                  />
                                  <span className="text-[8px] md:text-[9px] font-black uppercase">m</span>
                                </div>
                              )}
                            </div>
                            <button onClick={() => removeSlot(shift.id, slot.id)} className="text-slate-200 hover:text-red-500 p-1 transition-colors"><X size={14}/></button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white px-4 md:px-8 py-4 md:py-6 border-t border-slate-100 flex justify-end gap-3 md:gap-4 z-10">
              <button onClick={() => setIsModalOpen(false)} className="px-4 md:px-6 py-3 text-slate-500 hover:bg-slate-50 rounded-2xl transition font-bold uppercase tracking-widest text-xs">Cancelar</button>
              <button onClick={handleSaveSchool} className="px-6 md:px-10 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-100 transition font-bold uppercase tracking-widest text-xs">Salvar Alterações</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {data.schools.map(school => (
          <div 
            key={school.id} 
            onClick={() => openEditModal(school)}
            className="group rounded-3xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-xl hover:border-slate-200 transition-all duration-300 cursor-pointer relative"
            style={{ backgroundColor: school.color + '15' }}
          >
            <div className="h-2" style={{ backgroundColor: school.color }} />
            <div className="p-6">
              <div className="flex justify-between items-start mb-5">
                <h4 className="text-lg font-black text-slate-800 group-hover:text-black transition-colors">{school.name}</h4>
                {/* Alterado aqui: Removida a classe opacity-0 para que os ícones fiquem sempre visíveis */}
                <div className="flex gap-1">
                  <button 
                    onClick={(e) => { e.stopPropagation(); openEditModal(school); }}
                    className="p-2 text-slate-500 hover:bg-white/50 rounded-xl transition-all"
                  >
                    <Edit3 size={18}/>
                  </button>
                  <button 
                    onClick={(e) => deleteSchool(school.id, e)}
                    className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                  >
                    <Trash2 size={18}/>
                  </button>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Turmas</span>
                  <span className="font-black text-slate-700 bg-white/60 px-3 py-1 rounded-xl text-xs shadow-sm">{school.classes.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Turnos Ativos</span>
                  <div className="flex gap-1.5">
                    {school.shifts.map(s => (
                      <span key={s.id} className="bg-white/60 text-slate-600 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter shadow-sm">{s.name}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-3 bg-white/40 border-t border-slate-100/50 text-[9px] text-slate-500 font-bold uppercase tracking-widest flex justify-between items-center">
              <span>Configuração Completa</span>
              <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" />
            </div>
          </div>
        ))}
        
        {data.schools.length === 0 && !isModalOpen && (
          <div onClick={openAddModal} className="col-span-full py-20 text-center bg-white rounded-[40px] border-4 border-dashed border-slate-100 hover:border-blue-100 hover:bg-blue-50/20 transition-all cursor-pointer group">
             <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:bg-blue-100 transition-colors">
               <Plus className="text-slate-300 group-hover:text-blue-500" size={32} />
             </div>
             <p className="text-slate-500 font-bold text-lg">Clique aqui para cadastrar sua primeira escola.</p>
             <p className="text-slate-400 text-sm mt-1">Configure turnos, turmas e cores personalizadas.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SchoolManagement;