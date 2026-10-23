import React, { useState, useMemo, useEffect } from 'react';
import {
    Wand2,
    ArrowRight,
    Calendar,
    Check,
    X,
    Trash2,
    CalendarPlus,
    ArrowLeftRight
} from 'lucide-react';
import { AppData, LessonLog, ScheduleEntry, School, SchoolEvent } from '../types';
import { DAYS_OF_WEEK_NAMES } from '../constants';
import { getClassName } from '../utils/classRefs';
import { ScheduleDecision } from '../utils/scheduleChange';
import { isSameClass, calculateNewDate, calculateSameWeekValidDate } from '../utils/scheduleMigration';

// CONSTANTS & HELPERS

interface MigrationWizardProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (decisions: MigrationDecision[]) => void;
    orphans: LessonLog[];
    orphanEvents?: SchoolEvent[];
    newSchedules: ScheduleEntry[];
    schools: School[];
    activeFrom: string;
    appData: AppData;
    /** Sugestões calculadas pela ordem das aulas (utils/scheduleChange.ts) */
    suggestions?: Record<string, ScheduleDecision>;
    /** Por que um item ficou sem sugestão automática */
    notes?: Record<string, string>;
}

export type MigrationDecisionType = 'MOVE' | 'EXTRA' | 'DELETE';
export type MigrationDecision = ScheduleDecision;

export const MigrationWizard: React.FC<MigrationWizardProps> = ({
    isOpen,
    onClose,
    onConfirm,
    orphans,
    orphanEvents = [],
    newSchedules,
    schools,
    activeFrom,
    appData,
    suggestions,
    notes = {}
}) => {
    const [decisions, setDecisions] = useState<Map<string, MigrationDecision>>(new Map());

    // Merge orphans and orphanEvents for a single generic unified list
    const unifiedOrphans: (LessonLog | SchoolEvent)[] = useMemo(() => {
        return [...orphans, ...orphanEvents].sort((a, b) => a.date.localeCompare(b.date));
    }, [orphans, orphanEvents]);

    // Smart Matching Logic: Run once on mount or when orphans change
    useEffect(() => {
        // Sugestões já calculadas pela ordem das aulas (sem colisões)
        if (suggestions) {
            setDecisions(new Map(unifiedOrphans.map(o => [o.id, suggestions[o.id] || { logId: o.id, type: 'EXTRA' as const }])));
            return;
        }
        const initialDecisions = new Map<string, MigrationDecision>();

        unifiedOrphans.forEach(log => {
            // 1. Find potential slots in the new schedule for this class
            const classSlots = newSchedules
                .filter(s => s.schoolId === log.schoolId && isSameClass(s.classId, log.classId, log.schoolId, schools))
                .sort((a, b) => a.dayOfWeek - b.dayOfWeek);

            if (classSlots.length > 0) {
                // Smart Suggestion: Try to find a slot in the same week
                // Preference: Same day > Next available day in same week > First day of week

                const logDate = new Date(log.date.split('T')[0] + 'T00:00:00');
                const logDay = logDate.getDay();

                // Try to match same day first
                let bestSlot = classSlots.find(s => s.dayOfWeek === logDay);

                // If not, find next available day in the week
                if (!bestSlot) {
                    bestSlot = classSlots.find(s => s.dayOfWeek > logDay);
                }

                // If still not, wrap around to first available (next week logic handled by date calc?) 
                // Actually, we want to stay in the SAME relative week.
                // So if I was Tuesday and now class is Monday, I move to Monday of the SAME week (which is in the past relative to Tuesday? Or future?)
                // Let's assume "Same Week" boundaries (Sun-Sat).
                if (!bestSlot) {
                    bestSlot = classSlots[0];
                }

                if (bestSlot) {
                    const validDate = calculateSameWeekValidDate(log.date, logDay, bestSlot.dayOfWeek, appData, log.schoolId, bestSlot.shiftId, bestSlot.classId);

                    if (validDate) {
                        // Get time info
                        const school = schools.find(s => s.id === log.schoolId);
                        const shift = school?.shifts?.find(sh => sh.id === bestSlot?.shiftId);
                        const slotDetails = shift?.slots?.find(sl => sl.id === bestSlot?.slotId);

                        initialDecisions.set(log.id, {
                            logId: log.id,
                            type: 'MOVE',
                            targetDate: validDate,
                            targetSlotId: bestSlot.slotId,
                            targetTime: {
                                startTime: slotDetails?.startTime || '',
                                endTime: slotDetails?.endTime || ''
                            },
                            targetSlot: bestSlot
                        });
                    } else {
                        // Blocked in the same week, fallback to EXTRA
                        initialDecisions.set(log.id, { logId: log.id, type: 'EXTRA' });
                    }
                } else {
                    // No slots found for this class? Suggest Extra
                    initialDecisions.set(log.id, { logId: log.id, type: 'EXTRA' });
                }
            } else {
                // No slots at all for this class in new schedule -> Extra
                initialDecisions.set(log.id, { logId: log.id, type: 'EXTRA' });
            }
        });

        setDecisions(initialDecisions);
    }, [unifiedOrphans, newSchedules, schools, suggestions]);


    /** A escolha feita na avaliação vale também para o seu registro "Avaliação:" no Diário */
    const withPairedLog = (map: Map<string, MigrationDecision>, id: string) => {
        const ev = orphanEvents.find(e => e.id === id);
        const d = map.get(id);
        if (!ev || !d) return map;
        const paired = orphans.find(l => l.date.split('T')[0] === ev.date.split('T')[0] && l.schoolId === ev.schoolId &&
            l.slotId === ev.slotId && (l.subject || '').startsWith('Avaliação:'));
        if (paired) map.set(paired.id, { ...d, logId: paired.id });
        return map;
    };

    const handleDecisionChange = (logId: string, type: MigrationDecisionType, targetSlot?: ScheduleEntry, isCustom?: boolean, customDate?: string) => {
        const log = unifiedOrphans.find(l => l.id === logId);
        if (!log) return;

        const newDecisions = new Map(decisions);

        if (type === 'DELETE') {
            newDecisions.set(logId, { logId, type: 'DELETE' });
        } else if (type === 'EXTRA') {
            let finalType: MigrationDecisionType = 'EXTRA';
            let finalTargetSlot = undefined;
            let finalTargetSlotId = undefined;
            let finalTargetTime = undefined;

            // Smart Snap Logic for Custom Date
            if (isCustom && customDate) {
                const dateObj = new Date(customDate + 'T00:00:00'); // Ensure stick to day
                const dayOfWeek = dateObj.getDay();

                // Find if there is a slot for this class on this day
                const potentialSlot = newSchedules.find(s =>
                    s.schoolId === log.schoolId &&
                    isSameClass(s.classId, log.classId, log.schoolId, schools) &&
                    Number(s.dayOfWeek) === dayOfWeek
                );

                if (potentialSlot) {
                    finalType = 'MOVE';
                    finalTargetSlot = potentialSlot;
                    finalTargetSlotId = potentialSlot.slotId;

                    const school = schools.find(s => s.id === log.schoolId);
                    const shift = school?.shifts?.find(sh => sh.id === potentialSlot.shiftId);
                    const slotDetails = shift?.slots?.find(sl => sl.id === potentialSlot.slotId);

                    finalTargetTime = {
                        startTime: slotDetails?.startTime || '',
                        endTime: slotDetails?.endTime || ''
                    };
                }
            }

            if (finalType === 'MOVE' && finalTargetSlot) {
                // Refined Smart Snap: Only snap to the dropdown (turn off custom) if the date matches the DEFAULT calculated date
                // Otherwise, keep it as custom so the indentation/input remains visible, avoiding confusion
                const logDate = new Date(log.date.split('T')[0] + 'T00:00:00');
                const defaultDate = calculateNewDate(log.date, logDate.getDay(), finalTargetSlot.dayOfWeek);
                const isExactMatch = defaultDate === customDate;

                newDecisions.set(logId, {
                    logId,
                    type: 'MOVE',
                    targetDate: customDate, // Use the manually selected date
                    targetSlotId: finalTargetSlotId,
                    targetTime: finalTargetTime,
                    targetSlot: finalTargetSlot,
                    isCustomDate: !isExactMatch // Only turn off custom if it matches the default suggestion exactly
                });
            } else {
                newDecisions.set(logId, {
                    logId,
                    type: 'EXTRA',
                    isCustomDate: isCustom,
                    targetDate: isCustom ? (customDate || log.date) : undefined
                });
            }

        } else if (type === 'MOVE' && targetSlot) {
            const logDate = new Date(log.date.split('T')[0] + 'T00:00:00');
            const logDay = logDate.getDay();
            const validDate = calculateSameWeekValidDate(log.date, logDay, targetSlot.dayOfWeek, appData, log.schoolId, targetSlot.shiftId, targetSlot.classId);

            if (validDate) {
                const school = schools.find(s => s.id === log.schoolId);
                const shift = school?.shifts?.find(sh => sh.id === targetSlot.shiftId);
                const slotDetails = shift?.slots?.find(sl => sl.id === targetSlot.slotId);

                newDecisions.set(logId, {
                    logId,
                    type: 'MOVE',
                    targetDate: validDate,
                    targetSlotId: targetSlot.slotId,
                    targetTime: {
                        startTime: slotDetails?.startTime || '',
                        endTime: slotDetails?.endTime || ''
                    },
                    targetSlot
                });
            } else {
                newDecisions.set(logId, { logId, type: 'EXTRA', targetDate: log.date });
            }
        }

        setDecisions(withPairedLog(newDecisions, logId));
    };


    /** "Outra aula neste dia": todos os horários de aula da escola na data, com o que há na grade nova */
    const daySlotsFor = (log: LessonLog | SchoolEvent) => {
        const school = schools.find(s => s.id === log.schoolId);
        const dow = new Date(log.date.split('T')[0] + 'T00:00:00').getDay();
        const dayEntries = newSchedules.filter(s => s.schoolId === log.schoolId && Number(s.dayOfWeek) === dow);
        const shifts = (school?.shifts || []).filter(sh => dayEntries.some(e => e.shiftId === sh.id));
        return (shifts.length ? shifts : school?.shifts || []).flatMap(sh => {
            const classSlots = sh.slots.filter(sl => sl.type === 'class').sort((a, b) => a.startTime.localeCompare(b.startTime));
            return classSlots.map((sl, i) => {
                const entry = dayEntries.find(e => e.shiftId === sh.id && e.slotId === sl.id);
                const what = !entry ? 'Livre'
                    : entry.classId === 'window' ? (entry.activityLabel || 'Janela')
                    : getClassName(appData, log.schoolId, entry.classId, entry.classId);
                return { shift: sh, slot: sl, number: i + 1, what, entry };
            });
        });
    };

    const handleDaySlot = (log: LessonLog | SchoolEvent, slotId: string) => {
        const found = daySlotsFor(log).find(d => d.slot.id === slotId);
        if (!found) return;
        // Aula da própria turma: movimento normal
        if (found.entry && found.entry.classId !== 'window' && isSameClass(found.entry.classId, log.classId, log.schoolId, schools)) {
            handleDecisionChange(log.id, 'MOVE', found.entry);
            return;
        }
        const newDecisions = new Map(decisions);
        newDecisions.set(log.id, {
            logId: log.id,
            type: 'MOVE',
            targetDate: log.date.split('T')[0],
            targetSlotId: slotId,
            targetTime: { startTime: found.slot.startTime, endTime: found.slot.endTime },
            daySlot: true
        });
        setDecisions(withPairedLog(newDecisions, log.id));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-start gap-4">
                    <div className="w-12 h-12 rounded-lg bg-violet-100 dark:bg-violet-900/20 flex items-center justify-center shrink-0">
                        <Wand2 className="text-violet-600" size={24} />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-xl font-black text-slate-800 dark:text-white">Ajustar Planejamento Futuro</h3>
                        <p className="text-sm text-slate-500 mt-1">
                            Identificamos <strong className="text-violet-600">{unifiedOrphans.length} registros (aulas/eventos)</strong> que precisam ser realocados na nova grade.
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                        <X size={20} className="text-slate-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 dark:bg-slate-900">
                    <div className="space-y-4">
                        {unifiedOrphans.map(log => {
                            const isEvent = 'title' in log;
                            const decision = decisions.get(log.id);
                            const logDate = new Date(log.date.split('T')[0] + 'T00:00:00');
                            const school = schools.find(s => s.id === log.schoolId);

                            const className = getClassName(appData, log.schoolId, log.classId);
                            const isAssessment = isEvent && ['test', 'work'].includes((log as SchoolEvent).type);
                            const note = notes[log.id];

                            // Available slots for this class
                            const classSlots = newSchedules
                                .filter(s => s.schoolId === log.schoolId && isSameClass(s.classId, log.classId, log.schoolId, schools))
                                .sort((a, b) => {
                                    const t = (x: ScheduleEntry) => school?.shifts?.find(sh => sh.id === x.shiftId)?.slots?.find(sl => sl.id === x.slotId)?.startTime || '';
                                    return ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7) || t(a).localeCompare(t(b));
                                });

                            return (
                                <div key={log.id} className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col md:flex-row gap-4 items-center">
                                    {/* Origin */}
                                    <div className="flex-1 w-full">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[10px] font-black uppercase text-slate-400">{school?.name}</span>
                                            <span className="text-[10px] font-black bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                                {className}
                                            </span>
                                            {isEvent && (
                                                <span className="text-[10px] font-black bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                                                    {isAssessment ? 'Avaliação' : 'Evento'}
                                                </span>
                                            )}
                                        </div>
                                        <h4 className="font-bold text-slate-700 dark:text-slate-200 text-sm">
                                            {isEvent ? (log as SchoolEvent).title : ((log as LessonLog).content || (log as LessonLog).subject || (log as LessonLog).homework || (log as LessonLog).notes || 'Sem conteúdo registrado')}
                                        </h4>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            Original: {new Date(log.date.split('T')[0] + 'T00:00:00').toLocaleDateString()} ({DAYS_OF_WEEK_NAMES[new Date(log.date.split('T')[0] + 'T00:00:00').getDay()]}{(() => {
                                                const t = school?.shifts?.flatMap(sh => sh.slots).find(sl => sl.id === log.slotId)?.startTime;
                                                return t ? `, ${t}` : '';
                                            })()})
                                        </p>
                                        {note && <p className="text-[11px] font-bold text-amber-600 mt-1">⚠️ {note} Escolha o que fazer.</p>}
                                    </div>

                                    <ArrowRight className="text-slate-300 hidden md:block" />

                                    {/* Destination Control */}
                                    <div className="flex-1 w-full">
                                        <div className="flex flex-col gap-2">
                                            <select
                                                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm px-3 py-2 font-medium outline-none focus:ring-2 ring-violet-500/20"
                                                value={decision?.isCustomDate ? 'CUSTOM' : decision?.daySlot ? `DAY:${decision.targetSlotId}` : (decision?.type === 'MOVE' ? decision?.targetSlot?.id : decision?.type)}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    if (val.startsWith('DAY:')) {
                                                        handleDaySlot(log, val.slice(4));
                                                    } else if (val === 'EXTRA') {
                                                        handleDecisionChange(log.id, 'EXTRA');
                                                    } else if (val === 'DELETE') {
                                                        handleDecisionChange(log.id, 'DELETE');
                                                    } else if (val === 'CUSTOM') {
                                                        handleDecisionChange(log.id, 'EXTRA', undefined, true);
                                                    } else {
                                                        const slot = classSlots.find(s => s.id === val);
                                                        if (slot) handleDecisionChange(log.id, 'MOVE', slot);
                                                    }
                                                }}
                                            >
                                                <optgroup label="Mover para nova grade">
                                                    {classSlots.map((slot, idx) => {
                                                        // Preview the projected valid date
                                                        const validDate = calculateSameWeekValidDate(log.date, logDate.getDay(), slot.dayOfWeek, appData, log.schoolId, slot.shiftId, slot.classId);
                                                        const slotTime = school?.shifts?.find(sh => sh.id === slot.shiftId)?.slots?.find(sl => sl.id === slot.slotId);
                                                        const isSmartMatch = decision?.type === 'MOVE' && decision.targetSlot?.id === slot.id; // Visual cue?

                                                        if (!validDate) {
                                                            return (
                                                                <option key={slot.id} value={slot.id} disabled className="text-slate-400 bg-slate-100">
                                                                    🚫 {DAYS_OF_WEEK_NAMES[slot.dayOfWeek]} - Bloqueado (Feriado/Evento)
                                                                </option>
                                                            );
                                                        }

                                                        return (
                                                            <option key={slot.id} value={slot.id}>
                                                                {isSmartMatch ? '✨ ' : ''}
                                                                {DAYS_OF_WEEK_NAMES[slot.dayOfWeek]} - {new Date(validDate + 'T00:00:00').toLocaleDateString()} ({slotTime?.label ? `${slotTime.label}, ` : ''}{slotTime?.startTime})
                                                            </option>
                                                        );
                                                    })}
                                                </optgroup>
                                                <optgroup label={`Outra aula neste dia (${DAYS_OF_WEEK_NAMES[logDate.getDay()]}, ${logDate.toLocaleDateString('pt-BR').slice(0, 5)})`}>
                                                    {daySlotsFor(log).map(d => (
                                                        <option key={`DAY:${d.slot.id}`} value={`DAY:${d.slot.id}`}>
                                                            {d.number}ª aula, {d.slot.startTime} · {d.what}
                                                        </option>
                                                    ))}
                                                </optgroup>
                                                <optgroup label="Outras ações">
                                                    <option value="EXTRA">{isEvent ? 'Manter na data, sem aula' : 'Manter como aula extra (mesma data e horário)'}</option>
                                                    <option value="CUSTOM">Escolher outra data...</option>
                                                    <option value="DELETE">{isAssessment ? 'Excluir a avaliação' : isEvent ? 'Excluir o evento' : 'Excluir o registro'}</option>
                                                </optgroup>
                                            </select>

                                            {decision?.isCustomDate && (
                                                <div className="animate-in slide-in-from-top-2">
                                                    <input
                                                        type="date"
                                                        value={decision.targetDate ? decision.targetDate.split('T')[0] : ''} // Ensure format YYYY-MM-DD
                                                        onChange={(e) => handleDecisionChange(log.id, 'EXTRA', undefined, true, e.target.value)}
                                                        className="w-full bg-white dark:bg-slate-800 border border-violet-200 dark:border-violet-900 rounded-lg text-sm px-3 py-2 font-bold text-violet-700 dark:text-violet-300 outline-none focus:ring-2 ring-violet-500"
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        {/* Status Feedback */}
                                        <div className="mt-2 text-[10px] font-bold">
                                            {decision?.type === 'MOVE' && (
                                                <span className="text-emerald-600 flex items-center gap-1">
                                                    <Check size={10} /> Será movido para {new Date(decision.targetDate! + 'T00:00:00').toLocaleDateString()}{decision.daySlot && decision.targetTime?.startTime ? `, ${decision.targetTime.startTime}` : ''}
                                                </span>
                                            )}
                                            {decision?.type === 'EXTRA' && (
                                                <span className="text-amber-600 flex items-center gap-1">
                                                    <CalendarPlus size={10} />
                                                    {decision.targetDate && decision.targetDate !== log.date
                                                        ? `Ficará como Extra em ${new Date(decision.targetDate + 'T00:00:00').toLocaleDateString()}`
                                                        : (isEvent ? 'Fica na mesma data, sem aula' : 'Fica como aula extra (mesma data)')
                                                    }
                                                </span>
                                            )}
                                            {decision?.type === 'DELETE' && (
                                                <span className="text-red-500 flex items-center gap-1">
                                                    <Trash2 size={10} /> Será excluído permanentemente
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
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
                        onClick={() => onConfirm(Array.from(decisions.values()))}
                        className="px-8 py-3 rounded-lg font-bold bg-violet-600 text-white shadow-lg shadow-violet-600/30 hover:brightness-110 transition-all flex items-center gap-2"
                    >
                        <Wand2 size={18} />
                        Aplicar Ajustes
                    </button>
                </div>

            </div>
        </div>
    );
};
