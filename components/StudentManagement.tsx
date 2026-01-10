
import React, { useState } from 'react';
import { AppData, Student, PrivateSchedule, DayOfWeek } from '../types';
import { COLORS, DAYS_OF_WEEK_NAMES } from '../constants';
import { Plus, Trash2, Edit3, Save, X, Clock, User, GraduationCap, ChevronRight, Calendar } from 'lucide-react';

interface StudentManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
}

// Convert StudentManagement to a default exported function to fix "no default export" error.
export default function StudentManagement({ data, onUpdateData }: StudentManagementProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [newStudent, setNewStudent] = useState<Partial<Student>>({
    name: '',
    subject: '',
    color: COLORS[6],
    startDate: new Date().toISOString().split('T')[0],
    schedules: []
  });

  const openAddModal = () => {
    setEditingStudentId(null);
    setNewStudent({ 
      name: '', 
      subject: '', 
      color: COLORS[6], 
      startDate: new Date().toISOString().split('T')[0],
      schedules: [] 
    });
    setIsModalOpen(true);
  };

  const openEditModal = (student: Student) => {
    setEditingStudentId(student.id);
    setNewStudent({ ...student });
    setIsModalOpen(true);
  };

  const handleSaveStudent = () => {
    if (!newStudent.name || !newStudent.subject) {
      alert('Nome e Disciplina são obrigatórios.');
      return;
    }

    if (editingStudentId) {
      const updated = data.students.map(s => s.id === editingStudentId ? { ...(newStudent as Student) } : s);
      onUpdateData({ students: updated });
    } else {
      const studentToAdd: Student = {
        id: crypto.randomUUID(),
        name: newStudent.name!,
        subject: newStudent.subject!,
        color: newStudent.color || COLORS[0],
        startDate: newStudent.startDate || new Date().toISOString().split('T')[0],
        schedules: newStudent.schedules || []
      };
      onUpdateData({ students: [...data.students, studentToAdd] });
    }
    setIsModalOpen(false);
  };

  const addSchedule = () => {
    const schedule: PrivateSchedule = {
      id: crypto.randomUUID(),
      dayOfWeek: 1,
      startTime: '14:00',
      endTime: '15:00'
    };
    setNewStudent({ ...newStudent, schedules: [...(newStudent.schedules || []), schedule] });
  };

  const updateSchedule = (id: string, field: keyof PrivateSchedule, value: any) => {
    const updated = newStudent.schedules?.map(s => s.id === id ? { ...s, [field]: value } : s);
    setNewStudent({ ...newStudent, schedules: updated });
  };

  const removeSchedule = (id: string) => {
    setNewStudent({ ...newStudent, schedules: newStudent.schedules?.filter(s => s.id !== id) });
  };

  const deleteStudent = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Deseja excluir este aluno?')) {
      onUpdateData({ students: data.students.filter(s => s.id !== id) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-slate-500">Gerencie seus alunos particulares e horários de aula.</p>
        <button onClick={openAddModal} className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl hover:bg-indigo-700 transition shadow-lg shadow-indigo-100 font-bold">
          <Plus size={18} /> Novo Aluno
        </button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {data.students.map(student => (
          <div key={student.id} onClick={() => openEditModal(student)} className="group bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer">
            <div className="h-2" style={{ backgroundColor: student.color }} />
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h4 className="font-black text-slate-800 text-lg uppercase tracking-tight">{student.name}</h4>
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{student.subject}</p>
                </div>
                <button onClick={(e) => deleteStudent(student.id, e)} className="text-slate-200 hover:text-red-500 transition-colors p-1"><Trash2 size={18}/></button>
              </div>
              <div className="space-y-2">
                {student.schedules.slice(0, 3).map(s => (
                  <div key={s.id} className="flex items-center gap-2 text-[10px] font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg">
                    <Clock size={12} className="text-slate-300" />
                    <span>{DAYS_OF_WEEK_NAMES[s.dayOfWeek].slice(0, 3)}</span>
                    <span className="text-slate-400">•</span>
                    <span>{s.startTime} - {s.endTime}</span>
                  </div>
                ))}
                {student.schedules.length > 3 && <p className="text-[9px] text-slate-400 font-bold uppercase ml-2">+ {student.schedules.length - 3} outros horários</p>}
              </div>
            </div>
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-indigo-600">
               <span>Ver Detalhes</span>
               <ChevronRight size={14} />
            </div>
          </div>
        ))}
        {data.students.length === 0 && !isModalOpen && (
           <div onClick={openAddModal} className="col-span-full py-16 text-center border-4 border-dashed border-slate-100 rounded-[40px] hover:border-indigo-100 hover:bg-indigo-50/20 cursor-pointer transition-all flex flex-col items-center">
              <User size={48} className="text-slate-300 mb-4" />
              <p className="text-slate-500 font-bold">Nenhum aluno particular cadastrado.</p>
           </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden animate-in zoom-in-95 flex flex-col">
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center shrink-0">
              <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Ficha do Aluno</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X /></button>
            </div>
            <div className="p-8 space-y-8 overflow-y-auto flex-1">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Nome do Aluno</label>
                  <input type="text" value={newStudent.name} onChange={e => setNewStudent({...newStudent, name: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl px-5 py-3 font-bold" placeholder="Ex: Lucas Mendes" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Disciplina</label>
                  <input type="text" value={newStudent.subject} onChange={e => setNewStudent({...newStudent, subject: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl px-5 py-3 font-bold" placeholder="Ex: Matemática Financeira" />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Data Inicial das Aulas</label>
                  <input type="date" value={newStudent.startDate} onChange={e => setNewStudent({...newStudent, startDate: e.target.value})} className="w-full bg-slate-50 border-none rounded-2xl px-5 py-3 font-bold text-indigo-600" />
                  <p className="text-[9px] text-slate-400 mt-1 uppercase font-bold">* Pendências só contam a partir desta data.</p>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Cor de Identificação</label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setNewStudent({...newStudent, color: c})} className={`w-8 h-8 rounded-full border-2 transition-all ${newStudent.color === c ? 'border-slate-800 scale-110 shadow-md' : 'border-transparent'}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><Clock size={16}/> Grade de Horários Semanais</h4>
                  <button onClick={addSchedule} className="text-indigo-600 font-black text-[10px] uppercase tracking-widest hover:bg-indigo-50 px-4 py-2 rounded-xl transition-all">+ Adicionar Horário</button>
                </div>
                <div className="space-y-3">
                  {newStudent.schedules?.map(s => (
                    <div key={s.id} className="flex flex-wrap items-center gap-3 bg-slate-50 p-4 rounded-3xl border border-slate-100">
                      <select value={s.dayOfWeek} onChange={e => updateSchedule(s.id, 'dayOfWeek', parseInt(e.target.value))} className="bg-white px-3 py-2 rounded-xl text-xs font-bold outline-none cursor-pointer">
                        {Object.entries(DAYS_OF_WEEK_NAMES).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                      </select>
                      <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl">
                        <input type="time" value={s.startTime} onChange={e => updateSchedule(s.id, 'startTime', e.target.value)} className="text-xs font-bold outline-none cursor-pointer" />
                        <span className="text-slate-300">às</span>
                        <input type="time" value={s.endTime} onChange={e => updateSchedule(s.id, 'endTime', e.target.value)} className="text-xs font-bold outline-none cursor-pointer" />
                      </div>
                      <button onClick={() => removeSchedule(s.id)} className="ml-auto text-slate-300 hover:text-red-500 transition-colors p-2"><Trash2 size={16}/></button>
                    </div>
                  ))}
                  {newStudent.schedules?.length === 0 && <p className="text-center py-6 text-xs text-slate-400 italic">Nenhum horário definido ainda.</p>}
                </div>
              </div>
            </div>
            <div className="p-8 border-t border-slate-100 flex gap-4 shrink-0">
               <button onClick={() => setIsModalOpen(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-[10px] tracking-widest">Cancelar</button>
               <button onClick={handleSaveStudent} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-indigo-100">Salvar Aluno</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
