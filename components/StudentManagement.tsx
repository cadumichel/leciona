import React, { useState } from 'react';
import { AppData, Student, PrivateSchedule, DayOfWeek } from '../types';
import { COLORS, DAYS_OF_WEEK_NAMES } from '../constants';
import { Plus, Trash2, Edit3, Save, X, Clock, User, GraduationCap, ChevronRight, Calendar } from 'lucide-react';

interface StudentManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
}

export default function StudentManagement({ data, onUpdateData }: StudentManagementProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(null);
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

  const activeStudentsList = React.useMemo(() => {
    if (!data?.students) return [];
    const uniqueMap = new Map();
    data.students.forEach(s => {
      if (s.id) uniqueMap.set(s.id, s);
    });
    return Array.from(uniqueMap.values());
  }, [data?.students]);

  const openEditModal = (student: Student) => {
    try {
      console.log('Opening edit modal for student:', student);
      setEditingStudentId(student.id);

      // Ensure all fields have defaults and proper types to prevent crashes
      const safeStudent = {
        id: student.id,
        name: student.name || '',
        subject: student.subject || '',
        color: student.color || COLORS[6],
        startDate: student.startDate || new Date().toISOString().split('T')[0],
        schedules: Array.isArray(student.schedules)
          ? student.schedules.map((s: any) => ({
            id: s.id || crypto.randomUUID(),
            dayOfWeek: typeof s.dayOfWeek === 'number' ? s.dayOfWeek : parseInt(String(s.dayOfWeek)) || 0,
            startTime: s.startTime || '14:00',
            endTime: s.endTime || '15:00'
          }))
          : []
      };

      console.log('Safe student data:', safeStudent);
      setNewStudent(safeStudent);
      setIsModalOpen(true);
    } catch (error) {
      console.error('Error opening edit modal:', error);
      alert('Erro ao abrir os detalhes do aluno. Tente excluir e recadastrar este aluno.');
    }
  };

  const handleSaveStudent = () => {
    if (!newStudent.name || !newStudent.subject) {
      alert('Nome e Disciplina são obrigatórios.');
      return;
    }

    if (editingStudentId) {
      const updated = data.students.map(s => s.id === editingStudentId ? { ...(newStudent as Student), id: s.id } : s);
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
    try {
      const schedule: PrivateSchedule = {
        id: crypto.randomUUID(),
        dayOfWeek: 1,
        startTime: '14:00',
        endTime: '15:00'
      };

      const currentSchedules = Array.isArray(newStudent?.schedules) ? newStudent.schedules : [];
      console.log('Adding schedule. Current schedules:', currentSchedules);

      setNewStudent({
        ...newStudent,
        schedules: [...currentSchedules, schedule]
      });

      console.log('Schedule added successfully');
    } catch (error) {
      console.error('Error adding schedule:', error);
      alert('Erro ao adicionar horário. Tente novamente.');
    }
  };

  const updateSchedule = (id: string, field: keyof PrivateSchedule, value: any) => {
    const updated = newStudent.schedules?.map(s => s.id === id ? { ...s, [field]: value } : s);
    setNewStudent({ ...newStudent, schedules: updated });
  };

  const removeSchedule = (id: string) => {
    setNewStudent({ ...newStudent, schedules: newStudent.schedules?.filter(s => s.id !== id) });
  };

  if (!data || !data.students) return null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-slate-500">Gerencie seus alunos particulares e horários de aula.</p>
        <button onClick={openAddModal} className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl hover:bg-indigo-700 transition shadow-lg shadow-indigo-100 font-bold">
          <Plus size={18} /> Novo Aluno
        </button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {activeStudentsList.map(student => (
          <div key={student.id} onClick={() => openEditModal(student)} className="group bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer">
            <div className="h-2" style={{ backgroundColor: student.color }} />
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h4 className="font-black text-slate-800 text-lg uppercase tracking-tight">{student.name}</h4>
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{student.subject}</p>
                </div>
                {deletingStudentId === student.id ? (
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[9px] font-bold text-slate-600 uppercase">Confirmar exclusão?</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log('Confirming delete for:', student.id);
                          onUpdateData({ students: data.students.filter(s => s.id !== student.id) });
                          setDeletingStudentId(null);
                        }}
                        className="bg-red-500 text-white px-2 py-1 rounded text-xs font-bold"
                      >
                        Sim
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingStudentId(null);
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
                      console.log('Delete button clicked for student:', student.id);
                      setDeletingStudentId(student.id);
                    }}
                    className="text-slate-200 hover:text-red-500 transition-colors p-1"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {student.schedules?.slice(0, 3).map(s => (
                  <div key={s.id} className="flex items-center gap-2 text-[10px] font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg">
                    <Clock size={12} className="text-slate-300" />
                    <span>{DAYS_OF_WEEK_NAMES[s.dayOfWeek]?.slice(0, 3)}</span>
                    <span className="text-slate-400">•</span>
                    <span>{s.startTime} - {s.endTime}</span>
                  </div>
                ))}
                {(student.schedules?.length || 0) > 3 && <p className="text-[9px] text-slate-400 font-bold uppercase ml-2">+ {(student.schedules?.length || 0) - 3} outros horários</p>}
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

      {
        isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" style={{ zIndex: 9999 }}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
              <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                  {editingStudentId ? 'Editar Aluno' : 'Novo Aluno Particular'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors p-2 hover:bg-slate-100 rounded-full"><X size={20} /></button>
              </div>

              <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Nome do Aluno</label>
                    <input
                      type="text"
                      value={newStudent?.name || ''}
                      onChange={e => setNewStudent({ ...newStudent, name: e.target.value })}
                      className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                      placeholder="Nome completo"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Matéria / Assunto</label>
                      <input
                        type="text"
                        value={newStudent?.subject || ''}
                        onChange={e => setNewStudent({ ...newStudent, subject: e.target.value })}
                        className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                        placeholder="Ex: Matemática"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Início das Aulas</label>
                      <input
                        type="date"
                        value={newStudent?.startDate || new Date().toISOString().split('T')[0]}
                        onChange={e => setNewStudent({ ...newStudent, startDate: e.target.value })}
                        className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Cor de Identificação</label>
                    <div className="flex flex-wrap gap-2">
                      {COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setNewStudent({ ...newStudent, color: c })}
                          className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${(newStudent?.color || COLORS[6]) === c ? 'ring-2 ring-offset-2 ring-indigo-500 scale-110' : ''}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="text-xs font-black text-slate-500 uppercase flex items-center gap-2"><Clock size={14} /> Horários de Aula</h4>
                      <button onClick={addSchedule} className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition flex items-center gap-1">
                        <Plus size={12} /> Adicionar
                      </button>
                    </div>

                    <div className="space-y-2">
                      {(newStudent?.schedules || []).map((schedule, idx) => (
                        <div key={schedule.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-100 group">
                          <select
                            value={schedule.dayOfWeek}
                            onChange={e => updateSchedule(schedule.id, 'dayOfWeek', parseInt(e.target.value))}
                            className="bg-white border-none rounded-lg text-xs font-bold text-slate-600 py-1.5 pl-2 pr-6 outline-none cursor-pointer"
                          >
                            {Object.entries(DAYS_OF_WEEK_NAMES).map(([key, value]) => (
                              <option key={key} value={key}>{value}</option>
                            ))}
                          </select>
                          <input
                            type="time"
                            value={schedule.startTime}
                            onChange={e => updateSchedule(schedule.id, 'startTime', e.target.value)}
                            className="bg-white border-none rounded-lg text-xs font-bold text-slate-600 py-1.5 px-2 outline-none w-24 text-center"
                          />
                          <span className="text-slate-300 font-bold text-xs">às</span>
                          <input
                            type="time"
                            value={schedule.endTime}
                            onChange={e => updateSchedule(schedule.id, 'endTime', e.target.value)}
                            className="bg-white border-none rounded-lg text-xs font-bold text-slate-600 py-1.5 px-2 outline-none w-24 text-center"
                          />
                          <button onClick={() => removeSchedule(schedule.id)} className="ml-auto text-slate-300 hover:text-red-500 p-1.5"><Trash2 size={14} /></button>
                        </div>
                      ))}
                      {(!newStudent.schedules || newStudent.schedules.length === 0) && (
                        <div className="text-center py-6 text-slate-400 text-xs italic bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                          Nenhum horário definido.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3.5">
                <button onClick={() => setIsModalOpen(false)} className="px-6 py-3 rounded-xl text-slate-500 font-bold text-xs uppercase hover:bg-slate-100 transition">Cancelar</button>
                <button onClick={handleSaveStudent} className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs uppercase shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:scale-105 transition-all flex items-center gap-2">
                  <Save size={16} /> Salvar Aluno
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div>
  );
}
