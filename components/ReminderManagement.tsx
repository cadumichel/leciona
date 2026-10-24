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
import { getSafeDate, todayLocal } from '../utils';
import SortOrderButton, { useSortOrder } from './SortOrderButton';

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
  const [sortOrder, toggleSortOrder] = useSortOrder('lembretes', 'desc');

  const [form, setForm] = useState<Partial<Reminder>>({
    category: 'general',
    title: '',
    content: '',
    date: todayLocal(),
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
    }).sort((a, b) => sortOrder === 'asc'
      ? new Date(a.date).getTime() - new Date(b.date).getTime()
      : new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [data.reminders, search, categoryFilter, sortOrder]);

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
      date: form.date || todayLocal(),
      alarmTime: finalAlarmTime,
      alarmTriggered: false,
      schoolId: form.schoolId,
      classId: form.classId,
      studentId: form.studentId
    };

    onUpdateData({ reminders: [...(data.reminders || []), newReminder] });
    setIsModalOpen(false);
    setForm({ category: 'general', title: '', content: '', date: todayLocal(), alarmTime: '' });
  };

  const deleteReminder = (id: string) => {
    onUpdateData({ reminders: data.reminders.filter(r => r.id !== id) });
  };

  return (
    <div className="space-y-3 pb-20">
      {/* Cabeçalho e filtros no mesmo molde de Avaliações e Agenda */}
      <div className="bg-white dark:bg-slate-900 px-4 py-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center justify-between gap-3">
        <h3 className="text-base font-black text-slate-800 dark:text-white uppercase tracking-tight flex items-center gap-2">
          <Lightbulb className="text-blue-600 w-4 h-4" /> Lembretes
        </h3>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center justify-center gap-1.5 bg-blue-600 text-white px-4 py-2.5 rounded-lg font-black uppercase text-[11px] tracking-tight hover:brightness-110 transition shadow-sm shrink-0"
        >
          <Plus size={14} /> Criar Nota
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm p-3 flex flex-col md:flex-row gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            placeholder="Pesquisar lembretes..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 dark:text-white border-none rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold placeholder:text-slate-400 placeholder:font-normal"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="flex-1 md:flex-none bg-slate-50 dark:bg-slate-800 dark:text-white border-none rounded-lg px-3 py-2 text-[10px] font-bold outline-none cursor-pointer"
          >
            <option value="all">Todas Categorias</option>
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <SortOrderButton order={sortOrder} onToggle={toggleSortOrder} className="!px-3 !rounded-lg !text-[10px]" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredReminders.map(r => {
          const cat = CATEGORIES.find(c => c.id === r.category) || CATEGORIES[3];
          const hasAlarm = !!r.alarmTime;
          const school = data.schools.find(s => s.id === r.schoolId);

          // Use school color if available, otherwise category color
          const iconColor = school ? school.color : null;
          const iconStyle = iconColor ? { color: iconColor, backgroundColor: iconColor + '15' } : {};

          return (
            <div key={r.id} className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm p-4 md:p-5 flex flex-col relative group hover:shadow-xl transition-all duration-300 animate-in fade-in" style={iconColor ? { borderLeft: `3px solid ${iconColor}` } : {}}>
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
                <h4 className="font-black text-slate-800 dark:text-white uppercase text-sm mb-1 line-clamp-1">{r.title}</h4>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-tight mb-2">
                  {/* Display Date + Full Weekday Name using getSafeDate */}
                  {getSafeDate(r.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  {' - '}
                  {getSafeDate(r.date).toLocaleDateString('pt-BR', { weekday: 'long' })}
                  {' • '}
                  {cat.label}
                </p>
                {hasAlarm && (
                  <p className="text-[10px] font-black text-amber-600 uppercase mb-3 flex items-center gap-1">
                    <Clock size={10} /> Alerta: {new Date(r.alarmTime!).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                  </p>
                )}
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-4 font-medium mb-4">{r.content}</p>
              </div>

              <div className="pt-4 border-t border-slate-50 dark:border-slate-800 flex items-center gap-2">
                {school && (
                  <span className="flex items-center gap-1 text-[10px] font-black uppercase bg-slate-50 px-2 py-1 rounded-lg text-slate-400" style={iconColor ? { color: iconColor, backgroundColor: iconColor + '10' } : {}}>
                    <SchoolIcon size={10} /> {school.name.slice(0, 10)}...
                  </span>
                )}
                {r.studentId && (
                  <span className="flex items-center gap-1 text-[10px] font-black uppercase bg-indigo-50 px-2 py-1 rounded-lg text-indigo-400">
                    <Users size={10} /> Particular
                  </span>
                )}
                {!r.schoolId && !r.studentId && (
                  <span className="text-[10px] text-slate-300 font-bold uppercase">Geral</span>
                )}
              </div>
            </div>
          );
        })}

        {filteredReminders.length === 0 && (
          <div className="col-span-full py-16 bg-white dark:bg-slate-900 rounded-xl border-2 border-dashed border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center gap-4 text-center">
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
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 md:p-6 w-full max-w-lg shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center gap-2 mb-5">
              <h3 className="text-lg font-black text-slate-800 dark:text-white uppercase tracking-tight truncate">Novo Lembrete</h3>
              <button onClick={() => setIsModalOpen(false)} className="shrink-0 text-slate-400 hover:text-slate-600 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 p-1.5 rounded-full transition-colors"><X size={16} /></button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-tight mb-1.5 ml-1">Assunto / Título</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 dark:text-white border-none rounded-lg px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Título breve da nota..."
                  />
                </div>

                {/* School Selector */}
                <div className="col-span-2">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-tight mb-1.5 ml-1">Vincular a Escola (Opcional)</label>
                  <select
                    value={form.schoolId}
                    onChange={e => setForm({ ...form, schoolId: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 dark:text-white border-none rounded-lg px-3 py-2.5 text-sm font-bold text-slate-700 cursor-pointer outline-none"
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
                    className="w-full bg-slate-50 dark:bg-slate-800 dark:text-white border-none rounded-lg px-3 py-2.5 text-sm font-bold text-slate-700 cursor-pointer outline-none"
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
                    className="w-full bg-slate-50 dark:bg-slate-800 dark:text-white border-none rounded-lg px-3 py-2.5 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg">
                <label className="block text-[10px] font-black text-amber-600 uppercase tracking-tight mb-3 flex items-center gap-2">
                  <Bell size={14} /> Configurar Alerta (Alarme)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="time"
                    value={form.alarmTime}
                    onChange={e => setForm({ ...form, alarmTime: e.target.value })}
                    className="flex-1 bg-white dark:bg-slate-800 border-none rounded-lg px-3 py-2.5 text-sm font-bold text-amber-700 outline-none"
                  />
                  {form.alarmTime && (
                    <button onClick={() => setForm({ ...form, alarmTime: '' })} className="text-amber-400 hover:text-amber-600">
                      <X size={16} />
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-amber-500 mt-2 font-bold uppercase">O Alarme soará na data selecionada acima.</p>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-tight mb-1.5 ml-1">Conteúdo da Nota</label>
                <textarea
                  rows={4}
                  value={form.content}
                  onChange={e => setForm({ ...form, content: e.target.value })}
                  className="w-full bg-slate-50 dark:bg-slate-800 dark:text-white border-none rounded-lg px-3 py-2.5 font-medium text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Descreva aqui os detalhes da ocorrência, observação ou tema futuro..."
                />
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex gap-3">
              <button onClick={() => setIsModalOpen(false)} className="flex-1 py-3 rounded-lg border border-slate-200 dark:border-slate-700 font-black text-slate-500 dark:text-slate-300 uppercase text-[11px] tracking-tight hover:bg-slate-50 dark:hover:bg-slate-800">Descartar</button>
              <button onClick={handleSave} className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-black uppercase text-[11px] tracking-tight shadow-sm hover:brightness-110 transition">Salvar Lembrete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}