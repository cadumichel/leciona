import React, { useState } from 'react';
import { AppData, Student, PrivateSchedule, DayOfWeek } from '../types';
import { COLORS, DAYS_OF_WEEK_NAMES } from '../constants';
import { checkTimeOverlap, getNearestClassDate } from '../utils';
import { Plus, Trash2, Edit3, Save, X, Clock, User, GraduationCap, ChevronRight, Calendar, DollarSign, Download, CreditCard, FileText, BookText, History } from 'lucide-react';

interface StudentManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
  onNavigateToLesson: (schedule: any, date: string) => void;
}

export default function StudentManagement({ data, onUpdateData, onNavigateToLesson }: StudentManagementProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'financial'>('general');
  // New state for inline payment registration
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    date: new Date().toISOString().split('T')[0],
    reference: ''
  });



  const [newStudent, setNewStudent] = useState<Partial<Student>>({
    name: '',
    subject: '',
    color: COLORS[6],
    startDate: new Date().toISOString().split('T')[0],
    schedules: []
  });

  const openAddModal = () => {
    setEditingStudentId(null);
    setActiveTab('general');
    setNewStudent({
      name: '',
      subject: '',
      color: COLORS[6],
      startDate: new Date().toISOString().split('T')[0],
      schedules: []
    });
    setIsModalOpen(true);
  };

  // Effect to auto-fill payment amount when switching to financial tab or when monthly fee changes
  React.useEffect(() => {
    if (activeTab === 'financial' && newStudent.paymentConfig?.value && !paymentForm.amount) {
      setPaymentForm(prev => ({
        ...prev,
        amount: String(newStudent.paymentConfig?.value || '')
      }));
    }
  }, [activeTab, newStudent.paymentConfig?.value]); // Depend on tab switch and value change

  const activeStudentsList = React.useMemo(() => {
    if (!data?.students) return [];
    const uniqueMap = new Map();
    data.students.forEach(s => {
      if (s.id) uniqueMap.set(s.id, s);
    });
    return Array.from(uniqueMap.values());
  }, [data?.students]);

  const openEditModal = (student: Student, initialTab: 'general' | 'financial' = 'general') => {
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
          : [],
        paymentConfig: student.paymentConfig || {
          enabled: false,
          model: 'monthly',
          value: 0,
          dueDay: 5
        },
        payments: student.payments || []
      };

      console.log('Safe student data:', safeStudent);
      console.log('Safe student data:', safeStudent);
      setNewStudent(safeStudent);
      // Reset payment form
      setPaymentForm({
        amount: student.paymentConfig?.value ? String(student.paymentConfig.value) : '',
        date: new Date().toISOString().split('T')[0],
        reference: ''
      });
      setActiveTab(initialTab);
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

    // Check for conflicts
    const schedulesToCheck = newStudent.schedules || [];
    for (const schedule of schedulesToCheck) {
      const day = Number(schedule.dayOfWeek);

      // 1. Check against other Private Students
      const privateConflict = data.students.find(s => {
        if (s.id === editingStudentId) return false; // Skip self
        return (s.schedules || []).some(otherSched => {
          if (Number(otherSched.dayOfWeek) !== day) return false;
          return checkTimeOverlap(schedule.startTime, schedule.endTime, otherSched.startTime, otherSched.endTime);
        });
      });

      if (privateConflict) {
        alert(`Conflito de horário detectado!\n\nO horário de ${DAYS_OF_WEEK_NAMES[day]} das ${schedule.startTime} às ${schedule.endTime} choca com uma aula de ${privateConflict.name}.`);
        return;
      }

      // 2. Check against Schools
      const schoolConflict = (data.schedules || []).find(schoolSched => {
        if (Number(schoolSched.dayOfWeek) !== day) return false;

        const school = data.schools.find(s => s.id === schoolSched.schoolId);
        if (!school || school.deleted) return false;

        const shift = school.shifts?.find(sh => sh.id === schoolSched.shiftId);
        const slot = shift?.slots?.find(sl => sl.id === schoolSched.slotId);

        if (!slot) return false;

        return checkTimeOverlap(schedule.startTime, schedule.endTime, slot.startTime, slot.endTime);
      });

      if (schoolConflict) {
        const school = data.schools.find(s => s.id === schoolConflict.schoolId);
        alert(`Conflito de horário detectado!\n\nO horário de ${DAYS_OF_WEEK_NAMES[day]} das ${schedule.startTime} às ${schedule.endTime} choca com uma aula na escola ${school?.name} (Turma: ${schoolConflict.classId}).`);
        return;
      }
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
        startDate: newStudent.startDate || new Date().toISOString().split('T')[0],
        schedules: newStudent.schedules || [],
        paymentConfig: newStudent.paymentConfig, // Include payment config
        payments: newStudent.payments || [] // Include payments if any
      };
      onUpdateData({ students: [...data.students, studentToAdd] });
    }
    setIsModalOpen(false);
  };

  const handleExportPayments = () => {
    if (!newStudent.payments || newStudent.payments.length === 0) {
      alert("Não há pagamentos registrados para exportar.");
      return;
    }

    const csvContent = [
      ["Data", "Valor", "Referência", "Observações"],
      ...newStudent.payments.map(p => [
        p.date,
        p.amount.toString().replace('.', ','),
        p.referenceData || '',
        p.notes || ''
      ])
    ]
      .map(e => e.join(";"))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `pagamentos_${newStudent.name}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const addPayment = () => {
    const amount = parseFloat(paymentForm.amount.replace(',', '.'));
    if (!amount || isNaN(amount) || amount <= 0) {
      alert("Por favor, insira um valor válido.");
      return;
    }

    if (!paymentForm.date) {
      alert("Por favor, selecione uma data.");
      return;
    }

    const newPayment = {
      id: crypto.randomUUID(),
      date: paymentForm.date,
      amount,
      referenceData: paymentForm.reference || '',
      notes: ''
    };

    setNewStudent({
      ...newStudent,
      payments: [...(newStudent.payments || []), newPayment]
    });

    // Reset form but keep date for convenience and auto-fill amount again
    setPaymentForm(prev => ({
      amount: newStudent.paymentConfig?.value ? String(newStudent.paymentConfig.value) : '',
      date: prev.date,
      reference: ''
    }));
  };

  const removePayment = (id: string) => {
    if (confirm("Remover este registro de pagamento?")) {
      setNewStudent({
        ...newStudent,
        payments: (newStudent.payments || []).filter(p => p.id !== id)
      });
    }
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
        <button onClick={openAddModal} className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg hover:bg-indigo-700 transition shadow-lg shadow-indigo-100 font-bold">
          <Plus size={18} /> Novo Aluno
        </button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {activeStudentsList.map(student => (
          <div key={student.id} onClick={() => openEditModal(student)} className="group bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer">
            <div className="h-2" style={{ backgroundColor: student.color }} />
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h4 className="font-black text-slate-800 text-lg uppercase tracking-tight">{student.name}</h4>
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-tight">{student.subject}</p>
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
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 grid grid-cols-2 gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  // Smart Redirect Logic
                  if (student.schedules && student.schedules.length > 0) {
                    const nearestDate = getNearestClassDate(student.schedules);

                    // Find the schedule that corresponds to the nearest date's weekday
                    // specific for correct slot identification
                    const dateObj = new Date(nearestDate + 'T12:00:00');
                    const targetDay = dateObj.getDay();

                    const relevantSchedule = student.schedules.find(s =>
                      (typeof s.dayOfWeek === 'string' ? parseInt(s.dayOfWeek as any) : s.dayOfWeek) === targetDay
                    ) || student.schedules[0];

                    const targetSchedule = {
                      dayOfWeek: relevantSchedule.dayOfWeek,
                      schoolId: student.id,
                      shiftId: 'private',
                      slotId: relevantSchedule.id,
                      classId: student.name
                    };
                    onNavigateToLesson(targetSchedule, nearestDate);
                  } else {
                    alert("Este aluno não possui horários cadastrados.");
                  }
                }}
                className="flex items-center justify-center gap-2 py-2 rounded-lg bg-indigo-50 text-indigo-700 font-black uppercase text-[10px] tracking-wide hover:bg-indigo-100 transition"
              >
                <BookText size={14} /> Diário
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openEditModal(student, 'financial');
                }}
                className="flex items-center justify-center gap-2 py-2 rounded-lg bg-green-50 text-green-700 font-black uppercase text-[10px] tracking-wide hover:bg-green-100 transition"
              >
                <DollarSign size={14} /> Pagamentos
              </button>
            </div>
          </div>
        ))}
        {data.students.length === 0 && !isModalOpen && (
          <div onClick={openAddModal} className="col-span-full py-16 text-center border-4 border-dashed border-slate-100 rounded-[32px] hover:border-indigo-100 hover:bg-indigo-50/20 cursor-pointer transition-all flex flex-col items-center">
            <User size={48} className="text-slate-300 mb-4" />
            <p className="text-slate-500 font-bold">Nenhum aluno particular cadastrado.</p>
          </div>
        )}
      </div>

      {
        isModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" style={{ zIndex: 9999 }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
              <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                  {editingStudentId ? 'Editar Aluno' : 'Novo Aluno Particular'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors p-2 hover:bg-slate-100 rounded-full"><X size={20} /></button>
              </div>

              <div className="flex border-b border-slate-100">
                <button
                  onClick={() => setActiveTab('general')}
                  className={`flex-1 py-3 text-xs font-black uppercase tracking-tight transition-colors ${activeTab === 'general' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/10' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  Dados Gerais
                </button>
                <button
                  onClick={() => setActiveTab('financial')}
                  className={`flex-1 py-3 text-xs font-black uppercase tracking-tight transition-colors ${activeTab === 'financial' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/10' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  Financeiro
                </button>
              </div>

              <div className="p-8 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                {activeTab === 'general' ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-tight mb-2 ml-1">Nome do Aluno</label>
                      <input
                        type="text"
                        value={newStudent?.name || ''}
                        onChange={e => setNewStudent({ ...newStudent, name: e.target.value })}
                        className="w-full bg-slate-50 border-none rounded-lg px-4 py-3 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                        placeholder="Nome completo"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-tight mb-2 ml-1">Matéria / Assunto</label>
                        <input
                          type="text"
                          value={newStudent?.subject || ''}
                          onChange={e => setNewStudent({ ...newStudent, subject: e.target.value })}
                          className="w-full bg-slate-50 border-none rounded-lg px-4 py-3 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                          placeholder="Ex: Matemática"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-tight mb-2 ml-1">Início das Aulas</label>
                        <input
                          type="date"
                          value={newStudent?.startDate || new Date().toISOString().split('T')[0]}
                          onChange={e => setNewStudent({ ...newStudent, startDate: e.target.value })}
                          className="w-full bg-slate-50 border-none rounded-lg px-4 py-3 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-tight mb-2 ml-1">Cor de Identificação</label>
                      <div className="flex flex-wrap gap-2 items-center">
                        {COLORS.map(c => (
                          <button
                            key={c}
                            onClick={() => setNewStudent({ ...newStudent, color: c })}
                            className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${(newStudent?.color || COLORS[6]) === c ? 'ring-2 ring-offset-2 ring-indigo-500 scale-110' : ''}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                        <div className="relative w-8 h-8 rounded-full overflow-hidden transition-transform hover:scale-110 border border-slate-200 ml-1 group cursor-pointer bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500">
                          <input
                            type="color"
                            value={newStudent.color || COLORS[6]}
                            onChange={(e) => setNewStudent({ ...newStudent, color: e.target.value })}
                            className="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] p-0 m-0 border-none cursor-pointer opacity-0"
                            title="Cor Personalizada"
                          />
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <Plus size={14} className="text-white drop-shadow-md" />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h4 className="text-xs font-black text-slate-500 uppercase flex items-center gap-2"><DollarSign size={14} /> Configuração Financeira</h4>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Habilitar cobranças</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newStudent?.paymentConfig?.enabled || false}
                            onChange={(e) => setNewStudent({
                              ...newStudent,
                              paymentConfig: {
                                enabled: e.target.checked,
                                model: newStudent.paymentConfig?.model || 'monthly',
                                value: newStudent.paymentConfig?.value || 0,
                                dueDay: newStudent.paymentConfig?.dueDay || 5
                              }
                            })}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </div>

                      {(newStudent?.paymentConfig?.enabled) && (
                        <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 fade-in mb-6 bg-slate-50 p-4 rounded-xl border border-slate-100/50">
                          <div className="col-span-1">
                            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Modelo</label>
                            <select
                              value={newStudent.paymentConfig?.model}
                              onChange={(e) => setNewStudent({
                                ...newStudent,
                                paymentConfig: { ...newStudent.paymentConfig!, model: e.target.value as any }
                              })}
                              className="w-full bg-white border-none rounded-lg px-3 py-2 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 text-xs uppercase"
                            >
                              <option value="monthly">Mensalidade</option>
                              <option value="per_class">Por Aula</option>
                            </select>
                          </div>
                          <div className="col-span-1">
                            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Valor (R$)</label>
                            <input
                              type="number"
                              value={newStudent.paymentConfig?.value}
                              onChange={(e) => setNewStudent({
                                ...newStudent,
                                paymentConfig: { ...newStudent.paymentConfig!, value: Number(e.target.value) }
                              })}
                              className="w-full bg-white border-none rounded-lg px-3 py-2 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 text-xs"
                            />
                          </div>
                          {newStudent.paymentConfig?.model === 'monthly' && (
                            <div className="col-span-2">
                              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Dia de Vencimento</label>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-500">Todo dia</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="31"
                                  value={newStudent.paymentConfig?.dueDay}
                                  onChange={(e) => setNewStudent({
                                    ...newStudent,
                                    paymentConfig: { ...newStudent.paymentConfig!, dueDay: Number(e.target.value) }
                                  })}
                                  className="w-16 bg-white border-none rounded-lg px-2 py-2 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 text-center text-xs"
                                />
                                <span className="text-xs font-bold text-slate-500">do mês</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
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
                          <div key={schedule.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-100 group">
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
                          <div className="text-center py-6 text-slate-400 text-xs italic bg-slate-50/50 rounded-lg border border-dashed border-slate-200">
                            Nenhum horário definido.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  (!newStudent?.paymentConfig?.enabled) ? (
                    <div className="text-center py-10 flex flex-col items-center">
                      <div className="bg-slate-100 p-4 rounded-full mb-3 text-slate-400">
                        <DollarSign size={24} />
                      </div>
                      <p className="text-sm font-bold text-slate-600 mb-1">Controle Financeiro Desativado</p>
                      <p className="text-xs text-slate-400 max-w-[200px]">Ative o controle financeiro na aba "Dados Gerais" para registrar pagamentos.</p>
                      <button
                        onClick={() => setActiveTab('general')}
                        className="mt-4 text-indigo-600 font-bold text-xs hover:underline"
                      >
                        Ir para Configurações
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-6 animate-in slide-in-from-top-4 fade-in">

                      <div className="pt-4 border-t border-slate-100">
                        <div className="flex justify-between items-center mb-4">
                          <h4 className="text-xs font-black text-slate-500 uppercase flex items-center gap-2">
                            <DollarSign size={14} /> Registrar Pagamento
                          </h4>
                        </div>

                        <div className="grid grid-cols-12 gap-3 mb-6 p-4 bg-slate-100/50 rounded-lg border border-slate-200/50">
                          <div className="col-span-4">
                            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Valor (R$)</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">R$</span>
                              <input
                                type="number"
                                value={paymentForm.amount}
                                onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                                className="w-full bg-white border-none rounded-lg pl-8 pr-3 py-2 font-bold text-slate-700 text-xs outline-none focus:ring-2 focus:ring-green-500/20"
                                placeholder="0,00"
                              />
                            </div>
                          </div>
                          <div className="col-span-4">
                            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Data</label>
                            <input
                              type="date"
                              value={paymentForm.date}
                              onChange={e => setPaymentForm({ ...paymentForm, date: e.target.value })}
                              className="w-full bg-white border-none rounded-lg px-3 py-2 font-bold text-slate-700 text-xs outline-none focus:ring-2 focus:ring-green-500/20"
                            />
                          </div>
                          <div className="col-span-4">
                            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-tight mb-1.5 ml-1">Referência</label>
                            <input
                              type="text"
                              value={paymentForm.reference}
                              onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                              className="w-full bg-white border-none rounded-lg px-3 py-2 font-bold text-slate-700 text-xs outline-none focus:ring-2 focus:ring-green-500/20"
                              placeholder="Ref..."
                            />
                          </div>
                          <div className="col-span-12 flex justify-end">
                            <button
                              onClick={addPayment}
                              className="bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide hover:bg-green-700 transition flex items-center gap-2 shadow-sm shadow-green-200"
                            >
                              <Plus size={14} /> Adicionar Pagamento
                            </button>
                          </div>
                        </div>

                        <div className="flex justify-between items-center mb-4 pt-4 border-t border-slate-100">
                          <h4 className="text-xs font-black text-slate-500 uppercase flex items-center gap-2">
                            <History size={14} /> Histórico
                          </h4>
                          <button onClick={handleExportPayments} className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition flex items-center gap-1" title="Exportar CSV">
                            <Download size={12} /> Exportar
                          </button>
                        </div>

                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                          {(newStudent.payments || [])
                            .sort((a, b) => b.date.localeCompare(a.date))
                            .map(payment => (
                              <div key={payment.id} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-lg shadow-sm">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-600">
                                    <DollarSign size={14} />
                                  </div>
                                  <div>
                                    <p className="text-xs font-black text-slate-700">R$ {payment.amount.toFixed(2)}</p>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                                      {new Date(payment.date + 'T12:00:00').toLocaleDateString('pt-BR')} • {payment.referenceData}
                                    </p>
                                  </div>
                                </div>
                                <button onClick={() => removePayment(payment.id)} className="text-slate-300 hover:text-red-500 transition-colors p-1">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            ))}
                          {(!newStudent.payments || newStudent.payments.length === 0) && (
                            <div className="text-center py-6 text-slate-400 text-xs italic bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                              Nenhum pagamento registrado.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                )}
              </div>

              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3.5">
                <button onClick={() => setIsModalOpen(false)} className="px-6 py-3 rounded-lg text-slate-500 font-bold text-xs uppercase hover:bg-slate-100 transition">Cancelar</button>
                <button onClick={handleSaveStudent} className="px-8 py-3 bg-indigo-600 text-white rounded-lg font-bold text-xs uppercase shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:scale-105 transition-all flex items-center gap-2">
                  <Save size={16} /> Salvar Aluno
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}
