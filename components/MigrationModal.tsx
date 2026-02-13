import React, { useState, useMemo, useEffect } from 'react';
import {
    PackageX,
    ArrowRight,
    Calendar,
    Check,
    X,
    AlertCircle,
    ArrowLeftRight
} from 'lucide-react';
import { LessonLog, ScheduleEntry, School, AffectedLog, ScheduleChange } from '../types';
import { DAYS_OF_WEEK_NAMES } from '../constants';
import { calculateNewDate } from '../utils/scheduleMigration';

interface MigrationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (mappings: AffectedLog[]) => void;
    migrationData: {
        changes: ScheduleChange[];
        affectedLogs: AffectedLog[];
        orphans: LessonLog[];
    } | null;
    newSchedules: ScheduleEntry[];
    schools: School[];
    activeFrom: string;
}

export const MigrationModal: React.FC<MigrationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    migrationData,
    newSchedules,
    schools,
    activeFrom
}) => {
    const [selectedClassKey, setSelectedClassKey] = useState<string>('');
    const [mappings, setMappings] = useState<AffectedLog[]>([]);
    const [selectedOrphanId, setSelectedOrphanId] = useState<string | null>(null);

    // Initialize mappings with suggestions
    useEffect(() => {
        if (migrationData?.affectedLogs) {
            setMappings(migrationData.affectedLogs);
        }
    }, [migrationData]);

    const classesWithOrphans = useMemo(() => {
        if (!migrationData?.orphans) return [];

        const classes = new Set<string>();
        migrationData.orphans.forEach(log => {
            classes.add(`${log.schoolId}:${log.classId}`);
        });
        return Array.from(classes);
    }, [migrationData]);

    // Select first class by default
    useEffect(() => {
        if (classesWithOrphans.length > 0 && !selectedClassKey) {
            setSelectedClassKey(classesWithOrphans[0]);
        }
    }, [classesWithOrphans]);

    const currentOrphans = useMemo(() => {
        if (!migrationData?.orphans || !selectedClassKey) return [];
        const [schoolId, classId] = selectedClassKey.split(':');
        return migrationData.orphans
            .filter(l => l.schoolId === schoolId && l.classId === classId)
            .sort((a, b) => a.date.localeCompare(b.date));
    }, [migrationData, selectedClassKey]);

    const currentNewSlots = useMemo(() => {
        if (!selectedClassKey) return [];
        const [schoolId, classId] = selectedClassKey.split(':');
        return newSchedules
            .filter(s => s.schoolId === schoolId && s.classId === classId)
            .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    }, [newSchedules, selectedClassKey]);

    const handleLink = (slot: ScheduleEntry) => {
        if (!selectedOrphanId) return;

        const orphan = currentOrphans.find(l => l.id === selectedOrphanId);
        if (!orphan) return;

        // Remove existing mapping for this log if any
        const others = mappings.filter(m => m.log.id !== orphan.id);

        // Calculate new date
        const logDay = new Date(orphan.date).getDay();
        const targetDay = slot.dayOfWeek;
        const newDate = calculateNewDate(orphan.date, logDay, targetDay);

        // Get shifts/times
        const school = schools.find(s => s.id === orphan.schoolId);
        const shift = school?.shifts?.find(sh => sh.id === slot.shiftId);
        const slotDetails = shift?.slots?.find(sl => sl.id === slot.slotId);

        const newMapping: AffectedLog = {
            log: orphan,
            suggestedNewDate: newDate,
            suggestedNewSlotId: slot.slotId,
            suggestedNewTime: {
                startTime: slotDetails?.startTime || orphan.startTime || '',
                endTime: slotDetails?.endTime || orphan.endTime || ''
            }
        };

        setMappings([...others, newMapping]);
        setSelectedOrphanId(null);
    };

    const handleUnlink = (logId: string) => {
        setMappings(mappings.filter(m => m.log.id !== logId));
    };

    if (!isOpen || !migrationData) return null;

    const [activeSchoolId, activeClassId] = selectedClassKey.split(':');
    const activeSchool = schools.find(s => s.id === activeSchoolId);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-start gap-4">
                    <div className="w-12 h-12 rounded-lg bg-indigo-100 dark:bg-indigo-900/20 flex items-center justify-center shrink-0">
                        <ArrowLeftRight className="text-indigo-600" size={24} />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-xl font-black text-slate-800 dark:text-white">Migração de Conteúdo</h3>
                        <p className="text-sm text-slate-500 mt-1">
                            Algumas aulas ficaram sem horário definido. Relacione o conteúdo antigo com os novos horários.
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden flex flex-col md:flex-row">

                    {/* Class Selector (Sidebar or Top) */}
                    <div className="w-full md:w-64 bg-slate-50 dark:bg-slate-900/50 border-r border-slate-100 dark:border-slate-800 p-4 overflow-y-auto">
                        <h4 className="text-xs font-black uppercase text-slate-400 mb-3 tracking-wider">Turmas Afetadas</h4>
                        <div className="space-y-2">
                            {classesWithOrphans.map(key => {
                                const [sId, cId] = key.split(':');
                                const sch = schools.find(s => s.id === sId);
                                const orphansCount = migrationData.orphans.filter(l => l.schoolId === sId && l.classId === cId).length;
                                const mappedCount = mappings.filter(m => m.log.schoolId === sId && m.log.classId === cId).length;
                                const isComplete = mappedCount === orphansCount;

                                return (
                                    <button
                                        key={key}
                                        onClick={() => setSelectedClassKey(key)}
                                        className={`w-full text-left p-3 rounded-lg border transition-all ${selectedClassKey === key
                                            ? 'bg-white dark:bg-slate-800 border-indigo-200 dark:border-indigo-800 shadow-sm ring-1 ring-indigo-500/20'
                                            : 'border-transparent hover:bg-white/50 dark:hover:bg-slate-800/50'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="font-bold text-sm text-slate-700 dark:text-slate-200">{cId}</span>
                                            {isComplete && <Check size={14} className="text-emerald-500" />}
                                        </div>
                                        <div className="flex items-center justify-between text-[10px]">
                                            <span className="text-slate-500 uppercase">{sch?.name}</span>
                                            <span className={`font-medium ${isComplete ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                {mappedCount}/{orphansCount}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Mapping Area */}
                    <div className="flex-1 p-6 overflow-y-auto bg-slate-100/50 dark:bg-black/20">
                        {activeSchool && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full">

                                {/* Left: Orphans */}
                                <div className="flex flex-col gap-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="font-black text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                            <PackageX size={18} className="text-amber-500" />
                                            Conteúdos Originais
                                        </h4>
                                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-bold">
                                            {currentOrphans.length} aulas
                                        </span>
                                    </div>

                                    <div className="space-y-3">
                                        {currentOrphans.map(log => {
                                            const mapping = mappings.find(m => m.log.id === log.id);
                                            const isSelected = selectedOrphanId === log.id;

                                            return (
                                                <div
                                                    key={log.id}
                                                    onClick={() => !mapping && setSelectedOrphanId(log.id)}
                                                    className={`p-4 rounded-lg border transition-all cursor-pointer relative ${mapping
                                                        ? 'bg-emerald-50/50 border-emerald-200 opacity-60'
                                                        : isSelected
                                                            ? 'bg-indigo-50 border-indigo-500 shadow-md scale-[1.02] z-10'
                                                            : 'bg-white border-slate-200 hover:border-indigo-300'
                                                        }`}
                                                >
                                                    <div className="flex justify-between items-start mb-2">
                                                        <span className="text-xs font-bold text-slate-500 uppercase">
                                                            {new Date(log.date).toLocaleDateString('pt-BR')}
                                                        </span>
                                                        {mapping ? (
                                                            <button onClick={(e) => { e.stopPropagation(); handleUnlink(log.id); }} className="text-emerald-600 hover:text-red-500 transition-colors">
                                                                <Check size={16} />
                                                            </button>
                                                        ) : (
                                                            <div className={`w-4 h-4 rounded-full border-2 ${isSelected ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300'}`}></div>
                                                        )}
                                                    </div>
                                                    <p className="text-sm font-medium text-slate-800 line-clamp-2">
                                                        {log.content || "Sem conteúdo registrado"}
                                                    </p>
                                                    {mapping && (
                                                        <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-[1px] rounded-lg">
                                                            <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full flex items-center gap-1">
                                                                Migrado <ArrowRight size={12} />
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Right: New Slots */}
                                <div className="flex flex-col gap-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="font-black text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                            <Calendar size={18} className="text-indigo-500" />
                                            Novos Horários
                                        </h4>
                                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full font-bold">
                                            Disponíveis
                                        </span>
                                    </div>

                                    <div className="space-y-3">
                                        {currentNewSlots.map(slot => {
                                            const relevantMappings = mappings.filter(m => m.suggestedNewSlotId === slot.slotId);
                                            const isTarget = selectedOrphanId && !relevantMappings.find(m => m.log.id === selectedOrphanId); // Can map multiple logs to one slot? Usually not for same date, but technically yes. Let's assume 1-1 for simplicity or allow stacking.
                                            // Let's allow stacking for now visualy but maybe warn.

                                            return (
                                                <div
                                                    key={slot.id}
                                                    onClick={() => isTarget && handleLink(slot)}
                                                    className={`p-4 rounded-lg border-2 border-dashed transition-all ${selectedOrphanId
                                                        ? 'border-indigo-400 bg-indigo-50/50 cursor-pointer hover:bg-indigo-100 hover:border-indigo-600'
                                                        : 'border-slate-200 bg-slate-50'
                                                        }`}
                                                >
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-xs font-black uppercase text-indigo-600">
                                                            {DAYS_OF_WEEK_NAMES[slot.dayOfWeek]}
                                                        </span>
                                                        <span className="text-xs font-medium text-slate-500">
                                                            {schools.find(s => s.id === slot.schoolId)?.shifts?.find(sh => sh.id === slot.shiftId)?.slots?.find(sl => sl.id === slot.slotId)?.startTime}
                                                        </span>
                                                    </div>

                                                    {relevantMappings.length > 0 ? (
                                                        <div className="space-y-2 mt-2">
                                                            {relevantMappings.map(m => (
                                                                <div key={m.log.id} className="bg-emerald-100 text-emerald-800 text-xs p-2 rounded-lg font-medium flex items-center gap-2 animate-in slide-in-from-left-2">
                                                                    <Check size={12} />
                                                                    <span className="truncate flex-1">{new Date(m.log.date).toLocaleDateString()} - {m.log.content?.slice(0, 20)}...</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="h-8 flex items-center justify-center text-slate-300 text-xs italic">
                                                            Arraste ou clique para vincular
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-white dark:bg-slate-900 rounded-b-2xl">
                    <button
                        onClick={onClose}
                        className="px-6 py-3 rounded-lg font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={() => onConfirm(mappings)}
                        className="px-8 py-3 rounded-lg font-bold bg-primary text-white shadow-lg shadow-primary/30 hover:brightness-110 transition-all flex items-center gap-2"
                    >
                        Confirmar Migração ({mappings.length})
                    </button>
                </div>

            </div>
        </div>
    );
};
