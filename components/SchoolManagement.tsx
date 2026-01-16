import React, { useState, useEffect } from 'react';
import { AppData, School, Shift, TimeSlot } from '../types';
import { COLORS } from '../constants';
import { Plus, Trash2, Edit3, Save, X, Clock, Coffee, ArrowRight, Wand2, ChevronUp, ChevronDown, Palette, MoreHorizontal } from 'lucide-react';
import { addMinutesToTime, parseTimeToMinutes } from '../utils';
import { migrateClassData } from '../utils/classMigration';

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
  const [deletingSchoolId, setDeletingSchoolId] = useState<string | null>(null);

  // Estados para Renomear Turma
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [tempEditingName, setTempEditingName] = useState('');

  const handleStartEditingClass = (c: any) => {
    const cId = typeof c === 'string' ? c : c.id; // Fallback se for string (legado)
    const cName = typeof c === 'string' ? c : c.name;
    setEditingClassId(cId || cName); // Se for string, usa o próprio nome como ID temporário no UI
    setTempEditingName(cName);
  };

  const handleConfirmRenameClass = (originalClass: any) => {
    if (!tempEditingName.trim()) return;

    const oldName = typeof originalClass === 'string' ? originalClass : originalClass.name;
    if (oldName === tempEditingName) {
      setEditingClassId(null);
      return;
    }

    // Validação de Duplicidade
    if (newSchool.classes?.some(c => (typeof c === 'string' ? c : c.name) === tempEditingName)) {
      alert('Já existe uma turma com este nome nesta escola.');
      return;
    }

    // Se estamos editando uma escola EXISTENTE, precisamos migrar os dados
    if (editingSchoolId) {
      if (confirm(`Ao renomear a turma para "${tempEditingName}", todos os alunos, notas, diários e horários serão atualizados para o novo nome. Confirmar?`)) {
        const migrationUpdates = migrateClassData(data, editingSchoolId, oldName, tempEditingName);

        // Atualiza os dados globais
        onUpdateData(migrationUpdates);

        // Atualiza a escola Localmente
        const updatedClasses = newSchool.classes?.map(c => {
          if (c === originalClass) { // Reference match or value match
            return typeof c === 'string' ? tempEditingName : { ...c, name: tempEditingName };
          }
          return c;
        });
        setNewSchool({ ...newSchool, classes: updatedClasses });
      }
    } else {
      // Apenas atualiza localmente (escola nova)
      const updatedClasses = newSchool.classes?.map(c => {
        if (c === originalClass) {
          return typeof c === 'string' ? tempEditingName : { ...c, name: tempEditingName };
        }
        return c;
      });
      setNewSchool({ ...newSchool, classes: updatedClasses });
    }
    setEditingClassId(null);
  };

  const openEditModal = (school: School) => {
    setEditingSchoolId(school.id);
    const sanitizedClasses = (school.classes || []).map(c =>
      (typeof c === 'string')
        ? { id: crypto.randomUUID(), name: c }
        : c
    );
    setNewSchool({ ...school, classes: sanitizedClasses });
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

    // 1. Validação de Nome Duplicado
    if (newSchool.shifts?.some(s => s.name === name)) {
      alert(`Já existe um turno com o nome "${name}".`);
      return;
    }

    const startTime = type === 'matutino' ? '07:20' : type === 'vespertino' ? '13:30' : '19:00';
    const duration = defaultLessonDuration;
    const breakDuration = 20;

    // Calcular horário de término previsto para verificar sobreposição
    let currentTime = startTime;
    const maxLessons = type === 'noturno' ? 5 : 6;
    let endTime = startTime;

    // Simulação rápida para encontrar o término do turno
    let tempTime = startTime;
    for (let i = 1; i <= maxLessons; i++) {
      tempTime = addMinutesToTime(tempTime, duration);
      if (i === breakAfterLesson && i < maxLessons) {
        tempTime = addMinutesToTime(tempTime, breakDuration);
      }
    }
    endTime = tempTime;

    // 2. Validação de Sobreposição de Horário
    const newStartMin = parseTimeToMinutes(startTime);
    const newEndMin = parseTimeToMinutes(endTime);

    const overlappingShift = newSchool.shifts?.find(s => {
      if (s.slots.length === 0) return false;
      const sStart = Math.min(...s.slots.map(sl => parseTimeToMinutes(sl.startTime)));
      const sEnd = Math.max(...s.slots.map(sl => parseTimeToMinutes(sl.endTime)));

      return (newStartMin < sEnd && newEndMin > sStart);
    });

    if (overlappingShift) {
      alert(`O novo turno conflita com os horários do turno "${overlappingShift.name}".`);
      return;
    }

    // Criação dos Slots (Lógica Original)
    currentTime = startTime;
    const slots: TimeSlot[] = [];

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

    // Validação de Nome Duplicado (Ignorando maiúsculas/minúsculas)
    if (newSchool.shifts?.some(s => s.name.toLowerCase() === tempShiftName.toLowerCase())) {
      alert(`Já existe um turno com o nome "${tempShiftName}".`);
      return;
    }

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

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-slate-500">Cadastre ou edite suas escolas e horários padrão.</p>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-100 font-bold text-xs"
        >
          <Plus size={16} /> Nova Escola
        </button>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-y-auto animate-in zoom-in-95 duration-200">
            <div className="sticky top-0 bg-white px-4 md:px-8 py-4 md:py-6 border-b border-slate-100 flex justify-between items-center z-10">
              <h3 className="text-lg md:text-xl font-bold text-slate-800">
                {editingSchoolId ? 'Editar Escola' : 'Cadastro de Escola'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-2"><X /></button>
            </div>

            <div className="p-4 md:p-6 space-y-4 md:space-y-6">
              <div className="grid md:grid-cols-2 gap-4 md:gap-6 pb-4 md:pb-6 border-b border-slate-100">
                <div className="space-y-3 md:space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Nome da Escola</label>
                    <input
                      type="text"
                      value={newSchool.name}
                      onChange={e => setNewSchool({ ...newSchool, name: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm"
                      placeholder="Ex: Colégio Estadual X"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Cor de Identificação</label>
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setNewSchool({ ...newSchool, color: c })}
                          className={`w-7 h-7 rounded-full border-2 transition-all ${newSchool.color === c ? 'border-slate-800 scale-110 shadow-md ring-2 ring-slate-100' : 'border-transparent hover:scale-105'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <div className="relative group">
                        <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all bg-white cursor-pointer ${!COLORS.includes(newSchool.color || '') ? 'border-slate-800 ring-2 ring-slate-100' : 'border-slate-200 hover:border-slate-400'}`}>
                          <Palette size={14} className="text-slate-400" />
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
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Turmas Atendidas</label>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={tempClass}
                      onChange={e => setTempClass(e.target.value)}
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-xl outline-none text-sm"
                      placeholder="Adicionar uma turma por vez..."
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          if (tempClass) {
                            const newClassObj: SchoolClass = { id: crypto.randomUUID(), name: tempClass };
                            setNewSchool({ ...newSchool, classes: [...(newSchool.classes || []), newClassObj] });
                            setTempClass('');
                          }
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (tempClass) {
                          if (newSchool.classes?.some(c => (typeof c === 'string' ? c : c.name) === tempClass)) {
                            alert('Esta turma já foi adicionada.');
                            return;
                          }
                          const newClassObj: SchoolClass = { id: crypto.randomUUID(), name: tempClass };
                          setNewSchool({ ...newSchool, classes: [...(newSchool.classes || []), newClassObj] });
                          setTempClass('');
                        }
                      }}
                      className="p-2 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors"
                    >
                      <Plus size={18} />
                    </button>
                  </div>

                  <p className="text-[10px] text-slate-400 mt-1 mb-2 italic">Leciona várias disciplinas? Especifique cada uma após a turma: <br /> Ex.: 6º ano A - História, 6º ano A - Geografia</p>

                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 custom-scrollbar">
                    {newSchool.classes?.filter(c => typeof c === 'string' || !c.deleted).map((c, i) => {
                      const cId = typeof c === 'string' ? c : c.id;
                      const cName = typeof c === 'string' ? c : c.name;
                      const isEditing = editingClassId === (cId || cName);

                      return (
                        <span key={i} className={`px-2.5 py-1 ${isEditing ? 'bg-indigo-100 border-indigo-200' : 'bg-slate-100 border-slate-200'} text-slate-700 rounded-lg text-xs font-bold flex items-center gap-1.5 border`}>
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                value={tempEditingName}
                                onChange={e => setTempEditingName(e.target.value)}
                                className="w-24 bg-white px-1 py-0.5 rounded text-xs outline-none border border-indigo-300"
                                onKeyDown={e => e.key === 'Enter' && handleConfirmRenameClass(c)}
                              />
                              <button onClick={() => handleConfirmRenameClass(c)} className="text-green-600 hover:scale-110"><Save size={12} /></button>
                              <button onClick={() => setEditingClassId(null)} className="text-red-400 hover:scale-110"><X size={12} /></button>
                            </div>
                          ) : (
                            <>
                              {cName} {typeof c !== 'string' && c.subject && <span className='font-normal text-slate-500'>- {c.subject}</span>}

                              <button onClick={() => handleStartEditingClass(c)} className="text-slate-400 hover:text-indigo-500 transition-colors ml-1">
                                <Edit3 size={10} />
                              </button>

                              <button onClick={() => {
                                const updatedClasses = newSchool.classes ? [...newSchool.classes] : [];
                                const actualIndex = newSchool.classes?.findIndex(cls => cls === c);
                                if (actualIndex !== undefined && actualIndex !== -1) {
                                  if (typeof updatedClasses[actualIndex] === 'string') {
                                    // Se for string, remove do array (não suporta soft delete)
                                    updatedClasses.splice(actualIndex, 1);
                                  } else {
                                    updatedClasses[actualIndex] = { ...updatedClasses[actualIndex] as SchoolClass, deleted: true, deletedAt: new Date().toISOString() };
                                  }
                                  setNewSchool({ ...newSchool, classes: updatedClasses });
                                }
                              }} className="text-slate-400 hover:text-red-500 transition-colors"><X size={10} /></button>
                            </>
                          )}
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-blue-50/50 p-3 md:p-3.5 rounded-[20px] border border-blue-100 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Wand2 size={14} className="text-blue-600" />
                    <h4 className="font-black text-blue-800 uppercase text-[10px] tracking-widest">Assistente de Criação de Turnos</h4>
                  </div>


                  <div className="flex flex-col md:flex-row gap-4 md:gap-8 items-end justify-between">
                    <div className="flex gap-4 md:gap-6 w-full md:w-auto">
                      <div className="flex-1 md:flex-none min-w-[100px] md:min-w-[120px]">
                        <label className="block text-[8px] md:text-[9px] font-black text-blue-600 uppercase tracking-widest mb-1.5">Duração da aula (min)</label>
                        <input
                          type="number"
                          value={defaultLessonDuration}
                          onChange={e => setDefaultLessonDuration(parseInt(e.target.value) || 45)}
                          className="w-full bg-white border border-blue-100 rounded-lg px-3 py-2 font-bold text-blue-700 text-sm outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      </div>
                      <div className="flex-1 md:flex-none min-w-[100px] md:min-w-[120px]">
                        <label className="block text-[8px] md:text-[9px] font-black text-blue-600 uppercase tracking-widest mb-1.5">Intervalo após:</label>
                        <select
                          value={breakAfterLesson}
                          onChange={e => setBreakAfterLesson(parseInt(e.target.value))}
                          className="w-full bg-white border border-blue-100 rounded-lg px-3 py-2 font-bold text-blue-700 text-sm outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer"
                        >
                          {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}ª aula</option>)}
                        </select>
                      </div>
                    </div>


                    <div className="w-full md:w-auto">
                      <label className="block text-[8px] md:text-[9px] font-black text-blue-600 uppercase tracking-widest mb-1.5 text-left">Adicionar turno:</label>
                      <div className="flex gap-1 md:gap-2 flex-wrap md:justify-start justify-end">
                        <button onClick={() => createStandardShift('matutino')} className="bg-white border border-blue-200 text-blue-600 px-3 md:px-5 py-2.5 rounded-lg text-[9px] md:text-[10px] font-black uppercase hover:bg-blue-600 hover:text-white transition-all whitespace-nowrap shadow-sm flex-1 md:flex-none">Matutino</button>
                        <button onClick={() => createStandardShift('vespertino')} className="bg-white border border-blue-200 text-blue-600 px-3 md:px-5 py-2.5 rounded-lg text-[9px] md:text-[10px] font-black uppercase hover:bg-blue-600 hover:text-white transition-all whitespace-nowrap shadow-sm flex-1 md:flex-none">Vespertino</button>
                        <button onClick={() => createStandardShift('noturno')} className="bg-white border border-blue-200 text-blue-600 px-3 md:px-5 py-2.5 rounded-lg text-[9px] md:text-[10px] font-black uppercase hover:bg-blue-600 hover:text-white transition-all whitespace-nowrap shadow-sm flex-1 md:flex-none">Noturno</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <h4 className="font-bold text-slate-800 flex items-center gap-2 text-base">
                  <Clock className="text-blue-500" size={18} /> Lista de Turnos
                </h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tempShiftName}
                    onChange={e => setTempShiftName(e.target.value)}
                    placeholder="Turno Personalizado..."
                    className="px-2 md:px-3 py-2 text-[9px] md:text-sm tracking-tight border border-slate-200 rounded-xl outline-none w-36 md:w-48 focus:ring-2 focus:ring-blue-400"
                  />
                  <button onClick={addShift} className="bg-slate-800 text-white px-3 py-2 rounded-xl text-xs font-bold hover:bg-slate-700 transition">
                    <span className="md:hidden text-sm">+</span>
                    <span className="hidden md:inline">Add</span>
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {newSchool.shifts?.map(shift => (
                  <div key={shift.id} className="bg-slate-50 p-2 md:p-3 rounded-[20px] border border-slate-200 relative group/shift">
                    <div className="flex justify-between items-center mb-2 md:mb-3 pb-1.5 border-b border-slate-200/60">
                      <span className="font-black text-slate-800 text-xs uppercase tracking-widest pl-2">{shift.name}</span>
                      <div className="flex gap-1 md:gap-1.5">
                        <button onClick={() => addSlot(shift.id, 'class')} className="text-[9px] md:text-[9px] font-bold text-blue-600 bg-blue-100 px-2 md:px-2.5 py-0.5 rounded-lg hover:bg-blue-200 transition-colors">+ Aula</button>
                        <button onClick={() => addSlot(shift.id, 'break')} className="text-[9px] md:text-[9px] font-bold text-amber-600 bg-amber-100 px-2 md:px-2.5 py-0.5 rounded-lg hover:bg-amber-200 transition-colors">+ Interv.</button>
                        <button onClick={() => removeShift(shift.id)} className="text-red-300 hover:text-red-500 p-0.5 transition-colors"><Trash2 size={14} /></button>
                      </div>
                    </div>

                    <div className="space-y-1 md:space-y-1.5">
                      {shift.slots.map((slot, sIdx) => (
                        <div key={slot.id} className="flex flex-wrap items-center gap-1 md:gap-1.5 bg-white p-1 md:p-1.5 rounded-xl border border-slate-100 shadow-sm transition-all hover:border-blue-100 group/slot">
                          <div className="flex flex-col gap-0">
                            <button disabled={sIdx === 0} onClick={() => moveSlot(shift.id, slot.id, 'up')} className="text-slate-300 hover:text-blue-600 disabled:opacity-0 transition-colors"><ChevronUp size={10} /></button>
                            <button disabled={sIdx === shift.slots.length - 1} onClick={() => moveSlot(shift.id, slot.id, 'down')} className="text-slate-300 hover:text-blue-600 disabled:opacity-0 transition-colors"><ChevronDown size={10} /></button>
                          </div>

                          <div className={`px-1.5 md:px-2 py-0.5 rounded-lg text-[8px] md:text-[9px] font-black uppercase tracking-widest min-w-[50px] md:min-w-[55px] text-center ${slot.type === 'class' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                            {slot.type === 'class' ? 'Aula' : 'Interv.'}
                          </div>

                          <input
                            type="text"
                            value={slot.label}
                            onChange={e => updateSlot(shift.id, slot.id, 'label', e.target.value)}
                            className="flex-1 min-w-[50px] md:min-w-[70px] text-[10px] md:text-xs font-black text-slate-700 outline-none border-b border-transparent focus:border-blue-400 bg-transparent py-0.5 uppercase"
                            placeholder="Nome"
                          />

                          <div className="flex items-center gap-0.5 md:gap-1 text-[9px] md:text-[10px] font-bold text-slate-500 bg-slate-50 px-1 md:px-1.5 py-0.5 md:py-1 rounded-lg border border-slate-100">
                            <input
                              type="time"
                              value={slot.startTime}
                              onChange={e => updateSlot(shift.id, slot.id, 'startTime', e.target.value)}
                              className="bg-transparent outline-none cursor-pointer w-[60px] md:w-[70px]"
                            />
                            <ArrowRight size={8} className="text-slate-300" />

                            {slot.type === 'class' ? (
                              <div className="text-blue-600 font-black w-[45px] md:w-[50px] text-center">{slot.endTime}</div>
                            ) : (
                              <div className="flex items-center gap-0.5 w-[45px] md:w-[50px] justify-center">
                                <input
                                  type="number"
                                  className="w-5 md:w-6 bg-transparent border-b border-amber-200 outline-none text-amber-600 text-center font-bold"
                                  onChange={(e) => updateBreakDuration(shift.id, slot.id, e.target.value)}
                                  defaultValue={parseTimeToMinutes(slot.endTime) - parseTimeToMinutes(slot.startTime)}
                                />
                                <span className="text-[8px] md:text-[9px] font-black uppercase">m</span>
                              </div>
                            )}
                          </div>
                          <button onClick={() => removeSlot(shift.id, slot.id)} className="text-slate-200 hover:text-red-500 p-0.5 transition-colors"><X size={12} /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="sticky bottom-0 bg-white px-4 md:px-8 pt-4 pb-12 md:py-6 border-t border-slate-100 flex justify-end gap-3 md:gap-4 z-10 safe-area-bottom">
              <button onClick={() => setIsModalOpen(false)} className="px-4 md:px-6 py-3 text-slate-500 hover:bg-slate-50 rounded-2xl transition font-bold uppercase tracking-widest text-xs">Cancelar</button>
              <button onClick={handleSaveSchool} className="px-6 md:px-10 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-100 transition font-bold uppercase tracking-widest text-xs">Salvar Alterações</button>
            </div>
          </div>
        </div>
      )}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.schools.filter(s => !s.deleted).map(school => (
          <div
            key={school.id}
            onClick={() => openEditModal(school)}
            className="group rounded-2xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-xl hover:border-slate-200 transition-all duration-300 cursor-pointer relative"
            style={{ backgroundColor: school.color + '15' }}
          >
            <div className="h-1.5" style={{ backgroundColor: school.color }} />
            <div className="p-4">
              <div className="flex justify-between items-start mb-3">
                <h4 className="text-base font-black text-slate-800 group-hover:text-black transition-colors">{school.name}</h4>
                <div className="flex gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditModal(school); }}
                    className="p-2 text-slate-500 hover:bg-white/50 rounded-xl transition-all"
                  >
                    <Edit3 size={18} />
                  </button>
                  {deletingSchoolId === school.id ? (
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[9px] font-bold text-slate-600 uppercase">Confirmar exclusão?</span>
                      <p className="text-[8px] text-amber-600 max-w-[200px] text-right mb-1">
                        ⚠️ Isso também removerá todas as avaliações, horários, diários e listas de alunos vinculados a esta escola.
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();

                            // Coletar todos os IDs de assessments relacionados à escola
                            const schoolEventIds = data.events.filter(ev => ev.schoolId === school.id).map(ev => ev.id);
                            const schoolCustomAssessmentIds = data.customAssessments.filter(ca => ca.schoolId === school.id).map(ca => ca.id);
                            const allAssessmentIdsToRemove = new Set([...schoolEventIds, ...schoolCustomAssessmentIds]);

                            // Calcular estatísticas para o usuário
                            const relatedSchedules = data.schedules.filter(s => s.schoolId === school.id).length;
                            const relatedLogs = data.logs.filter(l => l.schoolId === school.id).length;
                            const relatedClassRecords = data.classRecords.filter(cr => cr.schoolId === school.id).length;
                            const relatedEvents = schoolEventIds.length;
                            const relatedCustomAssessments = schoolCustomAssessmentIds.length;
                            const relatedGrades = data.grades.filter(g => allAssessmentIdsToRemove.has(g.assessmentId)).length;
                            const relatedGradingConfigs = data.gradingConfigs.filter(gc => gc.schoolId === school.id).length;
                            const relatedCalendars = data.calendars.filter(c => c.schoolId === school.id).length;

                            const confirmMessage = `ATENÇÃO: Esta ação irá remover permanentemente:\n\n` +
                              `📅 ${relatedSchedules} horário(s) de aula\n` +
                              `📖 ${relatedLogs} registro(s) de diário\n` +
                              `👥 ${relatedClassRecords} lista(s) de alunos\n` +
                              `📝 ${relatedEvents + relatedCustomAssessments} avaliação(ões)\n` +
                              `🎯 ${relatedGrades} nota(s) lançada(s)\n` +
                              `⚙️ ${relatedGradingConfigs} configuração(ões) de média\n` +
                              `📆 ${relatedCalendars} calendário(s) letivo(s)\n\n` +
                              `Esta ação NÃO pode ser desfeita. Confirmar?`;

                            if (!confirm(confirmMessage)) {
                              setDeletingSchoolId(null);
                              return;
                            }

                            // Soft Delete da escola
                            const updatedSchools = data.schools.map(s =>
                              s.id === school.id
                                ? { ...s, deleted: true, deletedAt: new Date().toISOString() }
                                : s
                            );

                            // Hard Delete de dados relacionados (não usam soft delete)
                            const updatedSchedules = data.schedules.filter(s => s.schoolId !== school.id);
                            const updatedLogs = data.logs.filter(l => l.schoolId !== school.id);
                            const updatedClassRecords = data.classRecords.filter(cr => cr.schoolId !== school.id);
                            const updatedEvents = data.events.filter(e => e.schoolId !== school.id);
                            const updatedCustomAssessments = data.customAssessments.filter(ca => ca.schoolId !== school.id);
                            const updatedGrades = data.grades.filter(g => !allAssessmentIdsToRemove.has(g.assessmentId));
                            const updatedGradingConfigs = data.gradingConfigs.filter(gc => gc.schoolId !== school.id);
                            const updatedCalendars = data.calendars.filter(c => c.schoolId !== school.id);

                            // Aplicar todas as mudanças de uma vez
                            onUpdateData({
                              schools: updatedSchools,
                              schedules: updatedSchedules,
                              logs: updatedLogs,
                              classRecords: updatedClassRecords,
                              events: updatedEvents,
                              customAssessments: updatedCustomAssessments,
                              grades: updatedGrades,
                              gradingConfigs: updatedGradingConfigs,
                              calendars: updatedCalendars
                            });

                            setDeletingSchoolId(null);
                          }}
                          className="bg-red-500 text-white px-2 py-1 rounded text-xs font-bold"
                        >
                          Sim
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingSchoolId(null);
                          }}
                          className="bg-slate-300 text-slate-700 px-2 py-1 rounded text-xs font-bold"
                        >
                          Não
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingSchoolId(school.id);
                      }}
                      className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Turmas</span>
                  <span className="font-black text-slate-700 bg-white/60 px-3 py-1 rounded-xl text-xs shadow-sm">{school.classes?.length || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Turnos Ativos</span>
                  <div className="flex gap-1.5">
                    {school.shifts?.map(s => (
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
      </div>
    </div >
  );
};

export default SchoolManagement;