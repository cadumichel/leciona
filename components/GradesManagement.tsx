
import React, { useState, useMemo, useEffect } from 'react';
import { AppData, CustomAssessment, GradeEntry, SchoolEvent, GradingConfig } from '../types';

import {
   GraduationCap,
   ChevronDown,
   Plus,
   Settings,
   Calculator,
   Info,
   Trash2,
   Save,
   X,
   FileCheck,
   Calendar
} from 'lucide-react';

interface GradesManagementProps {
   data: AppData;
   onUpdateData: (newData: Partial<AppData>) => void;
}

export default function GradesManagement({ data, onUpdateData }: GradesManagementProps) {
   const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
   const [selectedClassId, setSelectedClassId] = useState<string>('');
   const [selectedTermIndex, setSelectedTermIndex] = useState<number>(0);

   const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
   const [isAddColumnModalOpen, setIsAddColumnModalOpen] = useState(false);

   // Inclui data no formulário de nova coluna
   const [newColumnForm, setNewColumnForm] = useState({ title: '', weight: 1, maxGrade: 10, date: new Date().toISOString().split('T')[0] });
   const [tempCustomFormula, setTempCustomFormula] = useState('');

   // Inicializa a seleção padrão
   useEffect(() => {
      // Proteção defensiva: garantir que data.schools existe
      if (!data?.schools || !Array.isArray(data.schools)) return;

      if (!selectedSchoolId && data.schools.some(s => !s.deleted)) {
         const firstActive = data.schools.find(s => !s.deleted);
         if (firstActive) setSelectedSchoolId(firstActive.id);
      }
   }, [data.schools, selectedSchoolId]);

   useEffect(() => {
      if (selectedSchoolId && data?.schools && Array.isArray(data.schools)) {
         const school = data.schools.find(s => s.id === selectedSchoolId);
         if (school && school.classes && school.classes.length > 0) {
            // Verifica se a turma selecionada ainda existe nesta escola (por ID ou Nome)
            const isValidSelection = school.classes.some(c => {
               const cId = typeof c === 'string' ? c : c.id;
               const cName = typeof c === 'string' ? c : c.name;
               // Suporta ID ou Nome enquanto migra
               return cId === selectedClassId || cName === selectedClassId;
            });

            if (!isValidSelection || !selectedClassId) {
               const firstClass = school.classes[0];
               // PREFER ID for new selections
               setSelectedClassId(typeof firstClass === 'string' ? firstClass : firstClass.id);
            }
         }
      }
   }, [selectedSchoolId, data.schools, selectedClassId]);



   // Derived Data
   const calendar = useMemo(() => data.calendars.find(c => c.schoolId === selectedSchoolId), [data.calendars, selectedSchoolId]);
   const terms = useMemo(() => calendar?.terms || [], [calendar]);
   const currentTerm = terms[selectedTermIndex];

   // Configuração de Média (Ponderada ou Aritmética ou Custom)
   const gradingConfig = useMemo(() => {
      return data.gradingConfigs?.find(gc =>
         gc.schoolId === selectedSchoolId &&
         gc.classId === selectedClassId &&
         gc.termIndex === selectedTermIndex
      ) || { formula: 'arithmetic' as const, customFormula: '' };
   }, [data.gradingConfigs, selectedSchoolId, selectedClassId, selectedTermIndex]);

   // Carrega a fórmula atual no estado temporário ao abrir modal ou mudar config
   useEffect(() => {
      if (gradingConfig.formula === 'custom') {
         setTempCustomFormula(gradingConfig.customFormula || '');
      } else {
         setTempCustomFormula('');
      }
   }, [gradingConfig]);

   // Lista de Alunos da Turma - FILTRADO POR ATIVOS
   const roster = useMemo(() => {
      const record = data.classRecords?.find(r => r.schoolId === selectedSchoolId && r.classId === selectedClassId);
      // Retorna apenas alunos ativos para exibição na grade
      return record ? record.students.filter(s => s.active !== false) : [];
   }, [data.classRecords, selectedSchoolId, selectedClassId]);

   // Avaliações (Agendadas + Personalizadas) ORDENADAS POR DATA
   const columns = useMemo(() => {
      if (!currentTerm) return [];

      // 1. Provas e Trabalhos Agendados dentro do período
      const scheduled = (data.events || []).filter(e =>
         e.schoolId === selectedSchoolId &&
         e.classId === selectedClassId && // NOW EXPECTS UUID MATCH (if migrated)
         ['test', 'work'].includes(e.type) &&
         e.date >= (currentTerm.start || '') &&
         e.date <= (currentTerm.end || '')
      ).map(e => ({
         id: e.id,
         title: e.title,
         type: e.type,
         weight: e.weight ?? 1,
         maxGrade: e.maxGrade ?? 10,
         isCustom: false,
         date: e.date,
         displayDate: new Date(e.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
      }));

      // 2. Colunas Personalizadas para esta turma/bimestre
      const custom = (data.customAssessments || []).filter(c =>
         c.schoolId === selectedSchoolId &&
         c.classId === selectedClassId &&
         c.termIndex === selectedTermIndex
      ).map(c => ({
         id: c.id,
         title: c.title,
         type: 'custom',
         weight: c.weight,
         maxGrade: c.maxGrade ?? 10,
         isCustom: true,
         date: c.date,
         displayDate: new Date(c.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
      }));

      // Ordena cronologicamente
      return [...scheduled, ...custom].sort((a, b) => a.date.localeCompare(b.date));
   }, [data.events, data.customAssessments, selectedSchoolId, selectedClassId, currentTerm, selectedTermIndex]);

   const handleGradeChange = (studentId: string, assessmentId: string, valueStr: string) => {
      const value = parseFloat(valueStr.replace(',', '.'));
      const col = columns.find(c => c.id === assessmentId);
      const max = col?.maxGrade ?? 10;

      if (!isNaN(value) && value > max) {
         alert(`A nota máxima para esta avaliação é ${max}`);
         return;
      }

      // Remove nota anterior se existir
      const otherGrades = data.grades.filter(g => !(g.studentId === studentId && g.assessmentId === assessmentId));

      if (!isNaN(value)) {
         onUpdateData({ grades: [...otherGrades, { id: crypto.randomUUID(), studentId, assessmentId, value }] });
      } else if (valueStr === '') {
         onUpdateData({ grades: otherGrades });
      }
   };

   const getStudentGrade = (studentId: string, assessmentId: string) => {
      const entry = data.grades.find(g => g.studentId === studentId && g.assessmentId === assessmentId);
      return entry ? entry.value : '';
   };

   const calculateAverage = (studentId: string) => {
      if (columns.length === 0) return '-';

      // Lógica para Fórmula Personalizada
      if (gradingConfig.formula === 'custom' && gradingConfig.customFormula) {
         try {
            let formula = gradingConfig.customFormula.toUpperCase();

            // Substitui N1, N2, etc pelos valores
            columns.forEach((col, index) => {
               const varName = `N${index + 1}`;
               const grade = data.grades.find(g => g.studentId === studentId && g.assessmentId === col.id);
               const val = grade ? grade.value : 0; // Se não tiver nota, assume 0
               // Substituição segura usando regex com boundary \b para evitar substituir N1 em N10
               const regex = new RegExp(`\\b${varName}\\b`, 'g');
               formula = formula.replace(regex, val.toString());
            });

            // Avaliação segura simples
            // Remove caracteres perigosos, permite apenas números, operadores básicos e parênteses
            const sanitized = formula.replace(/[^0-9+\-*/().\s]/g, '');
            if (!sanitized.trim()) return '-';

            // eslint-disable-next-line no-new-func
            const result = new Function(`return ${sanitized}`)();
            return isNaN(result) || !isFinite(result) ? 'Erro' : result.toFixed(1);
         } catch (e) {
            return 'Erro';
         }
      }

      let totalWeight = 0;
      let weightedSum = 0;
      let count = 0;
      let sum = 0;

      columns.forEach(col => {
         const grade = data.grades.find(g => g.studentId === studentId && g.assessmentId === col.id);
         if (grade) {
            const w = col.weight || 1;
            weightedSum += grade.value * w;
            totalWeight += w;
            sum += grade.value;
            count++;
         }
      });

      if (gradingConfig.formula === 'weighted') {
         return totalWeight > 0 ? (weightedSum / totalWeight).toFixed(1) : '-';
      } else {
         return count > 0 ? (sum / count).toFixed(1) : '-';
      }
   };

   const handleAddColumn = () => {
      if (!newColumnForm.title) return;

      const newCustom: CustomAssessment = {
         id: crypto.randomUUID(),
         schoolId: selectedSchoolId,
         classId: selectedClassId,
         termIndex: selectedTermIndex,
         title: newColumnForm.title,
         weight: newColumnForm.weight || 1,
         maxGrade: newColumnForm.maxGrade || 10,
         date: newColumnForm.date // Salva a data escolhida
      };

      onUpdateData({ customAssessments: [...data.customAssessments, newCustom] });
      setNewColumnForm({ title: '', weight: 1, maxGrade: 10, date: new Date().toISOString().split('T')[0] });
      setIsAddColumnModalOpen(false);
   };

   const handleUpdateWeight = (id: string, weight: number, isCustom: boolean) => {
      if (isCustom) {
         onUpdateData({
            customAssessments: data.customAssessments.map(c => c.id === id ? { ...c, weight } : c)
         });
      } else {
         onUpdateData({
            events: data.events.map(e => e.id === id ? { ...e, weight } : e)
         });
      }
   };

   const handleUpdateMaxGrade = (id: string, maxGrade: number, isCustom: boolean) => {
      if (isCustom) {
         onUpdateData({
            customAssessments: data.customAssessments.map(c => c.id === id ? { ...c, maxGrade } : c)
         });
      } else {
         onUpdateData({
            events: data.events.map(e => e.id === id ? { ...e, maxGrade } : e)
         });
      }
   };


   const handleDeleteColumn = (id: string) => {
      if (confirm('Tem certeza que deseja remover esta coluna de notas? Todas as notas lançadas nela serão perdidas.')) {
         onUpdateData({
            customAssessments: data.customAssessments.filter(c => c.id !== id),
            grades: data.grades.filter(g => g.assessmentId !== id)
         });
      }
   };

   const handleSaveConfig = (formula: 'arithmetic' | 'weighted' | 'custom') => {
      const newConfig: GradingConfig = {
         id: crypto.randomUUID(),
         schoolId: selectedSchoolId,
         classId: selectedClassId,
         termIndex: selectedTermIndex,
         formula,
         customFormula: formula === 'custom' ? tempCustomFormula : undefined
      };

      // Remove config antiga se houver
      const otherConfigs = data.gradingConfigs.filter(gc =>
         !(gc.schoolId === selectedSchoolId && gc.classId === selectedClassId && gc.termIndex === selectedTermIndex)
      );

      onUpdateData({ gradingConfigs: [...otherConfigs, newConfig] });
   };

   if (!selectedSchoolId || !selectedClassId) {
      return (
         <div className="p-10 text-center bg-white dark:bg-slate-900 rounded-[40px] border-2 border-dashed border-slate-200">
            <p className="text-slate-400 font-bold uppercase text-xs">Selecione uma escola e turma para começar.</p>
         </div>
      );
   }

   if (roster.length === 0) {
      return (
         <div className="p-10 text-center bg-white dark:bg-slate-900 rounded-[40px] border-2 border-dashed border-slate-200 flex flex-col items-center gap-4">
            <div className="bg-orange-50 p-4 rounded-full text-orange-500"><Info size={32} /></div>
            <div>
               <h3 className="text-lg font-black text-slate-700 dark:text-white uppercase mb-2">Turma sem alunos</h3>
               <p className="text-slate-500 text-xs font-medium max-w-md mx-auto">
                  Para usar o diário de notas, você precisa cadastrar os alunos desta turma (e verificar se estão ativos). Vá em
                  <span className="font-bold text-primary"> Ajustes &gt; Turmas </span>.
               </p>
            </div>
         </div>
      );
   }

   return (
      <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-4">
         {/* Header de Seleção */}
         <div className="bg-white dark:bg-slate-900 p-5 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col gap-4">
            <div className="flex items-center gap-3 mb-2">
               <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 rounded-xl"><GraduationCap size={20} /></div>
               <h2 className="text-lg font-black uppercase text-slate-800 dark:text-white tracking-tight">Gestão de Notas</h2>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
               <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Escola</label>
                  <div className="relative">
                     <select value={selectedSchoolId} onChange={e => { setSelectedSchoolId(e.target.value); setSelectedClassId(''); }} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 text-xs font-bold dark:text-white appearance-none cursor-pointer">
                        {(data.schools || []).filter(s => !s.deleted).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                     </select>
                     <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
                  </div>
               </div>
               <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Turma</label>
                  <div className="relative">
                     <select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 text-xs font-bold dark:text-white appearance-none cursor-pointer" disabled={!selectedSchoolId}>
                        <option value="">Selecione...</option>
                        {(data.schools || []).find(s => s.id === selectedSchoolId)?.classes?.map(c => {
                           const className = typeof c === 'string' ? c : c.name;
                           const classValue = typeof c === 'string' ? c : c.id;
                           return <option key={classValue} value={classValue}>{className}</option>;
                        })}
                     </select>
                     <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
                  </div>
               </div>
               <div>
                  <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Período / Bimestre</label>
                  <div className="relative">
                     <select value={selectedTermIndex} onChange={e => setSelectedTermIndex(parseInt(e.target.value))} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 text-xs font-bold dark:text-white appearance-none cursor-pointer">
                        {terms.map((t, idx) => <option key={idx} value={idx}>{t.name}</option>)}
                     </select>
                     <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={14} />
                  </div>
               </div>
            </div>
         </div>

         {/* Toolbar */}
         <div className="flex flex-wrap gap-3">


            <button onClick={() => setIsAddColumnModalOpen(true)} className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-indigo-700 transition shadow-lg shadow-indigo-100">
               <Plus size={16} /> Nova Coluna de Nota
            </button>


            <button onClick={() => setIsConfigModalOpen(true)} className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 px-5 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-slate-50 transition">
               <Settings size={16} /> Configurar Pesos & Média
            </button>
         </div>

         {/* Tabela de Notas */}
         <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
               <table className="w-full text-left border-collapse">
                  <thead>
                     <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700">
                        <th className="p-4 min-w-[200px] sticky left-0 bg-slate-50 dark:bg-slate-800 z-10 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                           Nome do Aluno
                        </th>
                        {columns.map((col, idx) => (
                           <th key={col.id} className="p-4 min-w-[140px] text-[10px] font-black text-slate-500 uppercase tracking-widest text-center relative group">
                              <div className="flex flex-col items-center gap-1">
                                 {/* Identificador N1, N2... */}
                                 <span className="text-[8px] bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 px-1.5 rounded font-black mb-0.5">N{idx + 1}</span>

                                 <span className={col.isCustom ? 'text-indigo-600' : 'text-slate-700 dark:text-slate-300'}>{col.title}</span>

                                 {/* DATA VISÍVEL */}
                                 <div className="flex items-center gap-1 text-[9px] text-slate-400 font-bold bg-slate-100 dark:bg-slate-700/50 px-2 py-0.5 rounded-lg mt-0.5 mb-1">
                                    <Calendar size={10} /> {col.displayDate}
                                 </div>

                                 <div className="flex items-center justify-center gap-1.5 bg-slate-50 dark:bg-slate-800/80 p-1 rounded-lg">
                                    <label className="text-[8px] font-black text-slate-400 uppercase">Max</label>
                                    <input
                                       type="number"
                                       className="w-8 h-4 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded text-[9px] font-bold text-center text-slate-600 dark:text-slate-300 focus:ring-1 focus:ring-indigo-500 outline-none"
                                       value={col.maxGrade}
                                       min="0"
                                       max="100"
                                       onChange={(e) => handleUpdateMaxGrade(col.id, parseFloat(e.target.value), col.isCustom)}
                                    />
                                 </div>

                                 {gradingConfig.formula === 'weighted' && (
                                    <span className="text-[8px] bg-slate-200 dark:bg-slate-700 px-1.5 rounded text-slate-500 mt-1">Peso: {col.weight}</span>
                                 )}
                              </div>
                              {col.isCustom && (
                                 <button onClick={() => handleDeleteColumn(col.id)} className="absolute top-2 right-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Trash2 size={12} />
                                 </button>
                              )}
                           </th>
                        ))}
                        <th className="p-4 min-w-[100px] text-[10px] font-black text-slate-800 dark:text-white uppercase tracking-widest text-center bg-indigo-50/50 dark:bg-indigo-900/10">
                           Média
                        </th>
                     </tr>
                  </thead>
                  <tbody>
                     {roster.map((student, idx) => (
                        <tr key={student.id} className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                           <td className="p-4 sticky left-0 bg-white dark:bg-slate-900 z-10 font-bold text-xs text-slate-700 dark:text-slate-200 border-r border-slate-50 dark:border-slate-800">
                              {idx + 1}. {student.name}
                           </td>
                           {columns.map(col => (
                              <td key={col.id} className="p-3 text-center">
                                 <input
                                    type="text"
                                    inputMode="decimal"
                                    className="w-12 h-10 text-center bg-slate-50 dark:bg-slate-800 rounded-xl border-none font-bold text-slate-700 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none text-xs"
                                    value={getStudentGrade(student.id, col.id)}
                                    onChange={(e) => handleGradeChange(student.id, col.id, e.target.value)}
                                    placeholder="-"
                                 />
                              </td>
                           ))}
                           <td className="p-4 text-center font-black text-sm text-indigo-600 bg-indigo-50/30 dark:bg-indigo-900/10">
                              {calculateAverage(student.id)}
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
         </div>

         {/* Modal Adicionar Coluna */}
         {isAddColumnModalOpen && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-white dark:bg-slate-900 rounded-[32px] w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95">
                  <div className="flex justify-between items-center mb-6">
                     <h3 className="text-lg font-black uppercase text-slate-800 dark:text-white">Nova Coluna de Nota</h3>
                     <button onClick={() => setIsAddColumnModalOpen(false)} className="text-slate-300 hover:text-slate-600"><X /></button>
                  </div>
                  <div className="space-y-4">
                     <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Título da Avaliação</label>
                        <input type="text" value={newColumnForm.title} onChange={e => setNewColumnForm({ ...newColumnForm, title: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm" placeholder="Ex: Participação, Caderno..." />
                     </div>
                     <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Data da Avaliação</label>
                        <input type="date" value={newColumnForm.date} onChange={e => setNewColumnForm({ ...newColumnForm, date: e.target.value })} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm" />
                     </div>
                     <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Nota Máxima</label>
                        <input type="number" step="0.1" value={newColumnForm.maxGrade} onChange={e => setNewColumnForm({ ...newColumnForm, maxGrade: parseFloat(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm" />
                     </div>
                     {gradingConfig.formula === 'weighted' && (
                        <div>
                           <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Peso</label>
                           <input type="number" step="0.1" value={newColumnForm.weight} onChange={e => setNewColumnForm({ ...newColumnForm, weight: parseFloat(e.target.value) })} className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-xl px-4 py-3 font-bold dark:text-white text-sm" />
                        </div>
                     )}
                  </div>
                  <div className="mt-6 flex gap-3">
                     <button onClick={() => setIsAddColumnModalOpen(false)} className="flex-1 py-3 text-[10px] font-black uppercase text-slate-400">Cancelar</button>
                     <button onClick={handleAddColumn} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-indigo-100">Adicionar</button>
                  </div>
               </div>
            </div>
         )}

         {/* Modal Configurar Pesos e Fórmulas */}
         {isConfigModalOpen && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
               <div className="bg-white dark:bg-slate-900 rounded-[32px] w-full max-w-lg p-6 md:p-8 shadow-2xl animate-in zoom-in-95 max-h-[80vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-6">
                     <h3 className="text-lg font-black uppercase text-slate-800 dark:text-white flex items-center gap-2"><Calculator className="text-indigo-500" /> Configuração de Média</h3>
                     <button onClick={() => setIsConfigModalOpen(false)} className="text-slate-300 hover:text-slate-600"><X /></button>
                  </div>

                  <div className="space-y-6">
                     <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl overflow-x-auto">
                        <button onClick={() => handleSaveConfig('arithmetic')} className={`flex-1 py-3 px-2 rounded-lg text-[8px] md:text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${gradingConfig.formula === 'arithmetic' ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-400'}`}>Média Aritmética</button>
                        <button onClick={() => handleSaveConfig('weighted')} className={`flex-1 py-3 px-2 rounded-lg text-[8px] md:text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${gradingConfig.formula === 'weighted' ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-400'}`}>Média Ponderada</button>
                        <button onClick={() => handleSaveConfig('custom')} className={`flex-1 py-3 px-2 rounded-lg text-[8px] md:text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${gradingConfig.formula === 'custom' ? 'bg-white dark:bg-slate-700 text-indigo-600 shadow-sm' : 'text-slate-400'}`}>Fórmula Personalizada</button>
                     </div>

                     {gradingConfig.formula === 'weighted' && (
                        <div className="space-y-3">
                           <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Defina os pesos de cada avaliação:</p>
                           {columns.map((col, idx) => (
                              <div key={col.id} className="flex items-center gap-4 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                                 <div className="flex-1">
                                    <span className="block text-[10px] font-black text-slate-700 dark:text-white uppercase"><span className="text-indigo-500">N{idx + 1}</span> - {col.title}</span>
                                    <span className="text-[9px] font-bold text-slate-400 uppercase">{col.isCustom ? 'Personalizada' : 'Agendada'} ({col.displayDate})</span>
                                 </div>
                                 <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-black text-slate-400 uppercase">Peso:</span>
                                    <input
                                       type="number"
                                       step="0.1"
                                       value={col.weight}
                                       onChange={e => handleUpdateWeight(col.id, parseFloat(e.target.value), col.isCustom)}
                                       className="w-16 bg-white dark:bg-slate-700 rounded-lg px-2 py-1 text-center font-bold text-sm outline-none border border-slate-200 dark:border-slate-600 focus:border-indigo-500"
                                    />
                                 </div>
                              </div>
                           ))}
                        </div>
                     )}

                     {gradingConfig.formula === 'arithmetic' && (
                        <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-2xl border border-blue-100 dark:border-blue-900/20 text-center">
                           <p className="text-[10px] font-bold text-blue-600 uppercase">Na média aritmética, todas as notas têm o mesmo peso.</p>
                           <p className="text-[9px] text-blue-400 mt-2 font-medium">(Soma das Notas) / (Total de Avaliações)</p>
                        </div>
                     )}

                     {gradingConfig.formula === 'custom' && (
                        <div className="space-y-4">
                           <div className="p-4 bg-indigo-50 dark:bg-indigo-900/10 rounded-2xl border border-indigo-100 dark:border-indigo-900/20">
                              <p className="text-[10px] font-black text-indigo-600 uppercase mb-2">Variáveis Disponíveis:</p>
                              <div className="flex flex-wrap gap-2">
                                 {columns.map((col, idx) => (
                                    <span key={col.id} className="text-[9px] font-bold bg-white dark:bg-slate-800 px-2 py-1 rounded text-slate-600 dark:text-slate-300 border border-indigo-200 dark:border-indigo-800">
                                       <strong className="text-indigo-600">N{idx + 1}</strong>: {col.title}
                                    </span>
                                 ))}
                              </div>
                           </div>
                           <div>
                              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 ml-1">Escreva sua fórmula:</label>
                              <textarea
                                 value={tempCustomFormula}
                                 onChange={e => setTempCustomFormula(e.target.value)}
                                 onBlur={() => handleSaveConfig('custom')} // Salva ao sair do campo
                                 className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-2xl p-4 font-mono text-sm dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                 placeholder="Ex: (N1 + N2) / 2 + N3"
                                 rows={3}
                              />
                              <p className="text-[9px] text-slate-400 mt-2 ml-1 font-medium">Use parênteses para agrupar operações.</p>
                           </div>
                        </div>
                     )}
                  </div>

                  <button onClick={() => setIsConfigModalOpen(false)} className="w-full mt-8 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-indigo-100">Concluir</button>
               </div>
            </div>
         )}
      </div>
   );
}
