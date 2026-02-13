import React, { useState, useMemo } from 'react';
import { AppData, Reminder } from '../types';
import {
  Plus,
  Trash2,
  X,
  Search,
  Filter,
  UserCircle,
  AlertTriangle,
  Lightbulb,
  MessageSquare,
  ChevronRight,
  School as SchoolIcon,
  Users,
  Bell,
  Clock
} from 'lucide-react';
import { getSafeDate } from '../utils';

interface ReminderManagementProps {
  data: AppData;
  onUpdateData: (newData: Partial<AppData>) => void;
}

const CATEGORIES = [
  { id: 'occurrence', label: 'Ocorrência', icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50' },
  { id: 'observation', label: 'Obs. de Aluno', icon: UserCircle, color: 'text-blue-500', bg: 'bg-blue-50' },
  { id: 'topic', label: 'Temas Futuros', icon: Lightbulb, color: 'text-amber-500', bg: 'bg-amber-50' },
  { id: 'general', label: 'Geral', icon: MessageSquare, color: 'text-slate-500', bg: 'bg-slate-50' }
] as const;

export default function ReminderManagement({ data, onUpdateData }: ReminderManagementProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const [form, setForm] = useState<Partial<Reminder>>({
    category: 'general',
    title: '',
    content: '',
    date: new Date().toISOString().split('T')[0],
    alarmTime: '',
    schoolId: '',
    classId: '',
    studentId: ''
  });

  const filteredReminders = useMemo(() => {
    return (data.reminders || []).filter(r => {
      const matchSearch = r.title.toLowerCase().includes(search.toLowerCase()) ||
        r.content.toLowerCase().includes(search.toLowerCase());
      const matchCat = categoryFilter === 'all' || r.category === categoryFilter;

      const school = data.schools.find(s => s.id === r.schoolId);
      if (school && school.deleted) return false;

      return matchSearch && matchCat;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data.reminders, search, categoryFilter]);

  const handleSave = () => {
    if (!form.title || !form.content) return;

    let finalAlarmTime = form.alarmTime;
    // If only time was provided, combine it with the selected date
    if (form.alarmTime && form.alarmTime.length === 5) {
      finalAlarmTime = `${form.date}T${form.alarmTime}:00`;
    }

    const newReminder: Reminder = {
      id: crypto.randomUUID(),
      title: form.title,
      content: form.content,
      category: form.category as any,
      date: form.date || new Date().toISOString().split('T')[0],
      alarmTime: finalAlarmTime,
      alarmTriggered: false,
      schoolId: form.schoolId,
      classId: form.classId,
      studentId: form.studentId
    };

    onUpdateData({ reminders: [...(data.reminders || []), newReminder] });
    setIsModalOpen(false);
    setForm({ category: 'general', title: '', content: '', date: new Date().toISOString().split('T')[0], alarmTime: '' });
  };

  const deleteReminder = (id: string) => {
    onUpdateData({ reminders: data.reminders.filter(r => r.id !== id) });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex-1 w-full relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
          <input
            type="text"
            placeholder="Pesquisar lembretes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 shadow-sm font-medium"
          />
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="flex-1 md:flex-none bg-white border border-slate-100 rounded-xl px-4 py-3 text-xs font-black uppercase tracking-tight outline-none cursor-pointer shadow-sm"
          >
            <option value="all">Todas Categorias</option>
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl font-black uppercase text-[10px] tracking-tight hover:bg-blue-700 transition shadow-lg shadow-blue-100"
          >
            <Plus size={18} /> Criar Nota
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredReminders.map(r => {
          const cat = CATEGORIES.find(c => c.id === r.category) || CATEGORIES[3];
          const hasAlarm = !!r.alarmTime;
          const school = data.schools.find(s => s.id === r.schoolId);

          // Use school color if available, otherwise category color
          const iconColor = school ? school.color : null;
          const iconStyle = iconColor ? { color: iconColor, backgroundColor: iconColor + '15' } : {};

          return (
            <div key={r.id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-6 flex flex-col relative group hover:shadow-xl transition-all duration-300 animate-in fade-in" style={iconColor ? { borderLeft: `3px solid ${iconColor}` } : {}}>
              <div className="flex justify-between items-start mb-4">
                <div className={`p-2 rounded-lg ${!iconColor ? `${cat.bg} ${cat.color}` : ''}`} style={iconStyle}>
                  <cat.icon size={20} />
                </div>
                <div className="flex gap-2">
                  {hasAlarm && (
                    <div className={`p-2 rounded-lg ${r.alarmTriggered ? 'bg-slate-100 text-slate-400' : 'bg-amber-50 text-amber-500 animate-pulse'}`}>
                      <Bell size={16} />
                    </div>
                  )}
                  <button
                    onClick={() => deleteReminder(r.id)}
                    className="bg-red-50 hover:bg-red-500 text-red-500 hover:text-white transition-all p-2.5 rounded-lg hover:scale-110 shadow-sm hover:shadow-md"
                    title="Excluir lembrete"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              <div className="flex-1">
                <h4 className="font-black text-slate-800 uppercase text-sm mb-1 line-clamp-1">{r.title}</h4>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-tight mb-2">
                  {/* Display Date + Full Weekday Name using getSafeDate */}
                  {getSafeDate(r.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  {' - '}
                  {getSafeDate(r.date).toLocaleDateString('pt-BR', { weekday: 'long' })}
                  {' • '}
                  {cat.label}
                </p>
                {hasAlarm && (
                  <p className="text-[9px] font-black text-amber-600 uppercase mb-3 flex items-center gap-1">
                    <Clock size={10} /> Alerta: {new Date(r.alarmTime!).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                  </p>
                )}
                <p className="text-xs text-slate-600 leading-relaxed line-clamp-4 font-medium mb-4">{r.content}</p>
              </div>

              <div className="pt-4 border-t border-slate-50 flex items-center gap-2">
                {school && (
                  <span className="flex items-center gap-1 text-[9px] font-black uppercase bg-slate-50 px-2 py-1 rounded-lg text-slate-400" style={iconColor ? { color: iconColor, backgroundColor: iconColor + '10' } : {}}>
                    <SchoolIcon size={10} /> {school.name.slice(0, 10)}...
                  </span>
                )}
                {r.studentId && (
                  <span className="flex items-center gap-1 text-[9px] font-black uppercase bg-indigo-50 px-2 py-1 rounded-lg text-indigo-400">
                    <Users size={10} /> Particular
                  </span>
                )}
                {!r.schoolId && !r.studentId && (
                  <span className="text-[9px] text-slate-300 font-bold uppercase">Geral</span>
                )}
              </div>
            </div>
          );
        })}

        {filteredReminders.length === 0 && (
          <div className="col-span-full py-20 bg-white rounded-2xl border-2 border-dashed border-slate-100 flex flex-col items-center justify-center gap-4 text-center">
            <Lightbulb size={48} className="text-slate-300" />
            <div>
              <p className="text-slate-500 font-black uppercase text-xs tracking-tight">Nenhum lembrete encontrado</p>
              <p className="text-slate-400 text-[10px] uppercase mt-1">Sua lâmpada de ideias está apagada no momento.</p>
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-xl shadow-2xl animate-in zoom-in-95 overflow-hidden">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Novo Lembrete</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-300 hover:text-slate-600"><X /></button>
            </div>

            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-tight mb-1.5 ml-1">Assunto / Título</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    className="w-full bg-slate-50 border-none rounded-xl px-5 py-3 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Título breve da nota..."
                  />
                </div>

                {/* School Selector */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-tight mb-1.5 ml-1">Vincular a Escola (Opcional)</label>
                  <select
                    value={form.schoolId}
                    onChange={e => setForm({ ...form, schoolId: e.target.value })}
                    className="w-full bg-slate-50 border-none rounded-xl px-5 py-3 font-bold text-slate-700 cursor-pointer outline-none"
                  >
                    <option value="">Geral (Sem vínculo)</option>
                    {data.schools.filter(s => !s.deleted).sort((a, b) => a.name.localeCompare(b.name)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-tight mb-1.5 ml-1">Categoria</label>
                  <select
                    value={form.category}
                    onChange={e => setForm({ ...form, category: e.target.value as any })}
                    className="w-full bg-slate-50 border-none rounded-2xl px-5 py-3 font-bold text-slate-700 cursor-pointer outline-none"
                  >
                    {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-tight mb-1.5 ml-1">Data</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={e => setForm({ ...form, date: e.target.value })}
                    className="w-full bg-slate-50 border-none rounded-xl px-5 py-3 font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="bg-amber-50 p-6 rounded-xl border border-amber-100">
                <label className="block text-[10px] font-black text-amber-600 uppercase tracking-tight mb-3 flex items-center gap-2">
                  <Bell size={14} /> Configurar Alerta (Alarme)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="time"
                    value={form.alarmTime}
                    onChange={e => setForm({ ...form, alarmTime: e.target.value })}
                    className="flex-1 bg-white border-none rounded-lg px-4 py-2 font-bold text-amber-700 outline-none"
                  />
                  {form.alarmTime && (
                    <button onClick={() => setForm({ ...form, alarmTime: '' })} className="text-amber-400 hover:text-amber-600">
                      <X size={16} />
                    </button>
                  )}
                </div>
                <p className="text-[9px] text-amber-500 mt-2 font-bold uppercase">O Alarme soará na data selecionada acima.</p>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-tight mb-1.5 ml-1">Conteúdo da Nota</label>
                <textarea
                  rows={4}
                  value={form.content}
                  onChange={e => setForm({ ...form, content: e.target.value })}
                  className="w-full bg-slate-50 border-none rounded-xl px-6 py-4 font-medium text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Descreva aqui os detalhes da ocorrência, observação ou tema futuro..."
                />
              </div>
            </div>

            <div className="mt-8 flex gap-4">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-[10px] tracking-tight">Descartar</button>
              <button onClick={handleSave} className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-black uppercase text-[10px] tracking-tight shadow-xl shadow-blue-100 hover:bg-blue-700 transition">Salvar Lembrete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}