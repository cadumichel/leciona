import { LessonLog, ScheduleEntry, DayOfWeek, School, AppData, SchoolEvent } from '../types';

export interface ScheduleChange {
    classId: string;
    schoolId: string;
    oldSlot: {
        dayOfWeek: DayOfWeek;
        shiftId: string;
        slotId: string;
        startTime?: string;
        endTime?: string;
    };
    newSlot: {
        dayOfWeek: DayOfWeek;
        shiftId: string;
        slotId: string;
        startTime?: string;
        endTime?: string;
    };
}

export interface AffectedLog {
    log: LessonLog;
    suggestedNewDate: string;
    suggestedNewSlotId?: string;
    suggestedNewTime: { startTime: string; endTime: string };
}

export interface AffectedEvent {
    event: SchoolEvent;
    suggestedNewDate: string;
    suggestedNewSlotId?: string;
}

/**
 * Detect which classes changed slots between two schedule versions
 */
export function detectScheduleChanges(
    oldSchedules: ScheduleEntry[],
    newSchedules: ScheduleEntry[],
    schools: School[]
): ScheduleChange[] {
    const changes: ScheduleChange[] = [];

    // Group schedules by class for comparison
    const groupSchedules = (schedules: ScheduleEntry[]) => {
        const map = new Map<string, ScheduleEntry[]>();
        schedules.forEach(s => {
            if (s.classId === 'window') return;
            const key = `${s.schoolId}:${s.classId}`;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(s);
        });
        return map;
    };

    const oldGroups = groupSchedules(oldSchedules);
    const newGroups = groupSchedules(newSchedules);

    // Analyze each class
    newGroups.forEach((newSlots, key) => {
        const oldSlots = oldGroups.get(key);
        if (!oldSlots) return; // New class added, not a migration

        console.log(`Analyzing Class ${key}:`, {
            old: oldSlots.map(s => `${s.dayOfWeek}-${s.slotId}`),
            new: newSlots.map(s => `${s.dayOfWeek}-${s.slotId}`)
        });

        // Sort slots to try to match them logically (e.g. 1st lesson -> 1st lesson)
        // Sort by Day then Time
        const sortSlots = (slots: ScheduleEntry[]) => {
            return [...slots].sort((a, b) => {
                if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
                return (a.slotId || '').localeCompare(b.slotId || '');
            });
        };

        const sortedOld = sortSlots(oldSlots);
        const sortedNew = sortSlots(newSlots);

        // If counts differ, we simply match sequentially up to the smaller count
        // This assumes the user wants to migrate existing lessons to available slots
        const matchCount = Math.min(sortedOld.length, sortedNew.length);

        for (let i = 0; i < matchCount; i++) {
            const oldEntry = sortedOld[i];
            const newEntry = sortedNew[i];

            const positionChanged =
                oldEntry.dayOfWeek !== newEntry.dayOfWeek ||
                oldEntry.shiftId !== newEntry.shiftId ||
                oldEntry.slotId !== newEntry.slotId;

            if (positionChanged) {
                // Get time info from school shifts
                const school = schools.find(s => s.id === newEntry.schoolId);
                const oldShift = school?.shifts?.find(sh => sh.id === oldEntry.shiftId);
                const newShift = school?.shifts?.find(sh => sh.id === newEntry.shiftId);
                const oldSlotDetails = oldShift?.slots?.find(sl => sl.id === oldEntry.slotId);
                const newSlotDetails = newShift?.slots?.find(sl => sl.id === newEntry.slotId);

                changes.push({
                    classId: newEntry.classId,
                    schoolId: newEntry.schoolId,
                    oldSlot: {
                        dayOfWeek: oldEntry.dayOfWeek,
                        shiftId: oldEntry.shiftId,
                        slotId: oldEntry.slotId,
                        startTime: oldSlotDetails?.startTime,
                        endTime: oldSlotDetails?.endTime
                    },
                    newSlot: {
                        dayOfWeek: newEntry.dayOfWeek,
                        shiftId: newEntry.shiftId,
                        slotId: newEntry.slotId,
                        startTime: newSlotDetails?.startTime,
                        endTime: newSlotDetails?.endTime
                    }
                });
            }
        }
    });

    return changes;
}

/**
 * Calculate new date for a log when moving to a different day of week
 * Stays in the same week if possible
 */
export const calculateNewDate = (originalDate: string, oldDay: number, newDay: number): string => {
    let y, m, d;

    // Handle DD/MM/YYYY
    if (originalDate.includes('/')) {
        [d, m, y] = originalDate.split('/').map(Number);
    } else {
        // Handle YYYY-MM-DD or ISO
        const datePart = originalDate.split('T')[0];
        [y, m, d] = datePart.split('-').map(Number);
    }

    // Validate parsing
    if (!y || !m || !d || isNaN(y) || isNaN(m) || isNaN(d)) {
        console.error("Invalid date format:", originalDate);
        return new Date().toISOString().split('T')[0];
    }

    // Format strings securely for ISO 8601
    const yearStr = String(y);
    const monthStr = String(m).padStart(2, '0');
    const dayStr = String(d).padStart(2, '0');
    const date = new Date(`${yearStr}-${monthStr}-${dayStr}T00:00:00`);

    // Safety check
    if (isNaN(date.getTime())) return new Date().toISOString().split('T')[0];

    const currentDay = date.getDay();
    // Calculate difference
    const diff = newDay - currentDay;

    // Create new date instance
    const newDateObj = new Date(date);
    newDateObj.setDate(date.getDate() + diff);

    const yearOut = newDateObj.getFullYear();
    const monthOut = String(newDateObj.getMonth() + 1).padStart(2, '0');
    const dayOut = String(newDateObj.getDate()).padStart(2, '0');

    return `${yearOut}-${monthOut}-${dayOut}`;
};

/**
 * Find all future logs affected by schedule changes
 * Maps logs sequentially when a class has multiple lessons per week
 */
export function findAffectedLogs(
    logs: LessonLog[],
    changes: ScheduleChange[],
    activeFrom: string,
    schools: School[]
): AffectedLog[] {
    const affected: AffectedLog[] = [];

    // Group changes by school and class to handle multiple lessons together
    const changesByClass = new Map<string, ScheduleChange[]>();
    changes.forEach(change => {
        const key = `${change.schoolId}:${change.classId}`;
        if (!changesByClass.has(key)) {
            changesByClass.set(key, []);
        }
        changesByClass.get(key)!.push(change);
    });

    // Process each class's changes
    changesByClass.forEach((classChanges, classKey) => {
        const [schoolId, classId] = classKey.split(':');

        // Find all future logs for this class
        const classLogs = logs.filter(log =>
            log.date.split('T')[0] >= activeFrom &&
            log.schoolId === schoolId &&
            log.classId === classId &&
            log.status !== 'removed' &&
            log.type !== 'extra' // Don't migrate manual extra lessons
        );

        console.log(`Class Logs for ${classKey}:`, classLogs.length, 'ActiveFrom:', activeFrom);

        // Group logs by week and sort by time
        const weekGroups = groupLogsByWeek(classLogs, activeFrom);

        // For each week, map logs sequentially to new schedule
        weekGroups.forEach((weekLogs, weekKey) => {
            // Sort logs by date and time within the week
            const sortedLogs = (weekLogs as LessonLog[]).sort((a, b) => {
                if (a.date !== b.date) return a.date.localeCompare(b.date);
                return (a.startTime || '').localeCompare(b.startTime || '');
            });

            // Sort new changes by day and time
            const sortedChanges = [...classChanges].sort((a, b) => {
                if (a.newSlot.dayOfWeek !== b.newSlot.dayOfWeek) {
                    return a.newSlot.dayOfWeek - b.newSlot.dayOfWeek;
                }
                return (a.newSlot.startTime || '').localeCompare(b.newSlot.startTime || '');
            });

            // Map each log sequentially to corresponding new slot
            sortedLogs.forEach((log, index) => {
                // Find which old slot this log belongs to
                const logDayOfWeek = new Date(log.date.split('T')[0] + 'T00:00:00').getDay() as DayOfWeek;
                const matchingChange = classChanges.find(c =>
                    c.oldSlot.dayOfWeek === logDayOfWeek &&
                    (c.oldSlot.slotId === log.slotId || c.oldSlot.startTime === log.startTime)
                );

                if (!matchingChange) return;

                // Use sequential mapping: find this log's position in old schedule
                const oldSlotIndex = sortedChanges.findIndex(c =>
                    c.oldSlot.dayOfWeek === matchingChange.oldSlot.dayOfWeek &&
                    c.oldSlot.slotId === matchingChange.oldSlot.slotId
                );

                if (oldSlotIndex === -1 || oldSlotIndex >= sortedChanges.length) return;

                // Map to same position in new schedule
                const newChange = sortedChanges[oldSlotIndex];

                // Calculate new date
                const newDate = calculateNewDate(
                    log.date,
                    matchingChange.oldSlot.dayOfWeek,
                    newChange.newSlot.dayOfWeek
                );

                affected.push({
                    log,
                    suggestedNewDate: newDate,
                    suggestedNewSlotId: newChange.newSlot.slotId,
                    suggestedNewTime: {
                        startTime: newChange.newSlot.startTime || log.startTime || '',
                        endTime: newChange.newSlot.endTime || log.endTime || ''
                    }
                });
            });
        });
    });

    return affected;
}

/**
 * Group logs by week number relative to activeFrom
 */
function groupLogsByWeek(
    logs: (LessonLog | SchoolEvent)[],
    activeFrom: string
): Map<string, (LessonLog | SchoolEvent)[]> {
    const weekGroups = new Map<string, (LessonLog | SchoolEvent)[]>();
    const fromDate = new Date(activeFrom + 'T00:00:00');

    logs.forEach(log => {
        const logDate = new Date(log.date.split('T')[0] + 'T00:00:00');
        const diffDays = Math.floor((logDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
        const weekNumber = Math.floor(diffDays / 7);
        const weekKey = `week_${weekNumber}`;

        if (!weekGroups.has(weekKey)) {
            weekGroups.set(weekKey, []);
        }
        weekGroups.get(weekKey)!.push(log);
    });

    return weekGroups;
}

/**
 * Find logs that don't match any slot in the current schedule (orphans)
 */
function findOrphanLogs(
    logs: LessonLog[],
    schedules: ScheduleEntry[],
    activeFrom: string
): LessonLog[] {
    return logs.filter(log => {
        if (log.date.split('T')[0] < activeFrom) return false;
        if (log.status === 'removed') return false;
        if (log.type === 'extra') return false;

        // Check if log matches any schedule entry
        const matchesSchedule = schedules.some(s =>
            s.schoolId === log.schoolId &&
            s.classId === log.classId &&
            s.slotId === log.slotId &&
            Number(s.dayOfWeek) === new Date(log.date.split('T')[0] + 'T00:00:00').getDay()
        );

        return !matchesSchedule;
    });
}

/**
 * Find events that don't match any slot in the current schedule (orphans)
 */
function findOrphanEvents(
    events: SchoolEvent[],
    schedules: ScheduleEntry[],
    activeFrom: string
): SchoolEvent[] {
    return events.filter(event => {
        if (!event.classId || !event.slotId) return false; // Global events or all-day events don't get migrated
        if (event.date.split('T')[0] < activeFrom) return false;

        // Check if event matches any schedule entry
        const matchesSchedule = schedules.some(s =>
            s.schoolId === event.schoolId &&
            s.classId === event.classId &&
            s.slotId === event.slotId &&
            Number(s.dayOfWeek) === new Date(event.date.split('T')[0] + 'T00:00:00').getDay()
        );

        return !matchesSchedule;
    });
}

/**
 * Main function to detect migration opportunities based on orphan logs
 * and new schedule slots.
 */
export function analyzeMigration(
    currentSchedules: ScheduleEntry[], // The state BEFORE this update (not used for diff anymore, but for context if needed)
    newSchedules: ScheduleEntry[],     // The state AFTER this update
    logs: LessonLog[],
    events: SchoolEvent[],
    activeFrom: string,
    schools: School[]
): { changes: ScheduleChange[]; affectedLogs: AffectedLog[]; affectedEvents: AffectedEvent[]; orphans: LessonLog[]; orphanEvents: SchoolEvent[] } {

    // 0. Figure out which schools actually had schedule changes
    const modifiedSchoolIds = new Set<string>();
    const allSchoolIds = new Set([...currentSchedules.map(s => s.schoolId), ...newSchedules.map(s => s.schoolId)]);

    allSchoolIds.forEach(schoolId => {
        const oldForSchool = currentSchedules.filter(s => s.schoolId === schoolId);
        const newForSchool = newSchedules.filter(s => s.schoolId === schoolId);

        // Simple check: if lengths differ, it's modified
        if (oldForSchool.length !== newForSchool.length) {
            modifiedSchoolIds.add(schoolId);
            return;
        }

        // Deep check: any slot changed?
        const hasChanges = oldForSchool.some(oldSlot => {
            const matchingNewSlot = newForSchool.find(newSlot =>
                newSlot.dayOfWeek === oldSlot.dayOfWeek &&
                newSlot.shiftId === oldSlot.shiftId &&
                newSlot.slotId === oldSlot.slotId &&
                newSlot.classId === oldSlot.classId
            );
            return !matchingNewSlot;
        });

        if (hasChanges) {
            modifiedSchoolIds.add(schoolId);
        }
    });

    console.log('[MigrationAnalyzer] Modified schools:', Array.from(modifiedSchoolIds));

    // Filter logs and events to ONLY those belonging to schools that were modified
    const filteredLogs = logs.filter(log => modifiedSchoolIds.has(log.schoolId));
    const filteredEvents = events.filter(event => modifiedSchoolIds.has(event.schoolId!));

    // 1. Find all future logs that are improperly scheduled according to newSchedules
    // ONLY among the schools that were actually touched
    const orphans = findOrphanLogs(filteredLogs, newSchedules, activeFrom);
    const orphanEvents = findOrphanEvents(filteredEvents, newSchedules, activeFrom);

    if (orphans.length === 0 && orphanEvents.length === 0) {
        return { changes: [], affectedLogs: [], affectedEvents: [], orphans: [], orphanEvents: [] };
    }

    const affectedLogs: AffectedLog[] = [];
    const affectedEvents: AffectedEvent[] = [];
    const changes: ScheduleChange[] = []; // We construct synthetic changes for UI display

    // 2. Group orphans by class
    const orphansByClass = new Map<string, LessonLog[]>();
    orphans.forEach(log => {
        const key = `${log.schoolId}:${log.classId}`;
        if (!orphansByClass.has(key)) orphansByClass.set(key, []);
        orphansByClass.get(key)!.push(log);
    });

    // 3. For each class with orphans, look for AVAILABLE new slots
    orphansByClass.forEach((classLogs, key) => {
        const [schoolId, classId] = key.split(':');

        // Find slots for this class in the NEW schedule
        const newClassSlots = newSchedules
            .filter(s => s.schoolId === schoolId && s.classId === classId && s.classId !== 'window')
            .sort((a, b) => {
                if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
                return (a.slotId || '').localeCompare(b.slotId || '');
            });

        if (newClassSlots.length === 0) return; // No slots to migrate to

        // Group orphans by week
        const weekGroups = groupLogsByWeek(classLogs, activeFrom);

        weekGroups.forEach((weekLogs, weekKey) => {
            // Sort logs chronologically
            const sortedLogs = (weekLogs as LessonLog[]).sort((a, b) => {
                if (a.date !== b.date) return a.date.localeCompare(b.date);
                return (a.startTime || '').localeCompare(b.startTime || '');
            });

            // Map sequentially to new slots
            // We only map if we have orphan logs and target slots
            // If we have more logs than slots, extras remain orphans (unfortunately)
            const matchCount = Math.min(sortedLogs.length, newClassSlots.length);

            for (let i = 0; i < matchCount; i++) {
                const log = sortedLogs[i];
                const targetSlot = newClassSlots[i];

                // Calculate NEW DATE for this specific target slot
                // We need to find the date in the same week as the log, but on the target day
                const logDay = new Date(log.date.split('T')[0] + 'T00:00:00').getDay();
                const targetDay = targetSlot.dayOfWeek;

                const newDate = calculateNewDate(log.date, logDay, targetDay);

                // Get time details
                const school = schools.find(s => s.id === schoolId);
                const targetShift = school?.shifts?.find(sh => sh.id === targetSlot.shiftId);
                const targetSlotDetails = targetShift?.slots?.find(sl => sl.id === targetSlot.slotId);

                affectedLogs.push({
                    log,
                    suggestedNewDate: newDate,
                    suggestedNewSlotId: targetSlot.slotId, // <--- Add slotId
                    suggestedNewTime: {
                        startTime: targetSlotDetails?.startTime || log.startTime || '',
                        endTime: targetSlotDetails?.endTime || log.endTime || ''
                    }
                });

                // Create a synthetic "Change" object for the UI to display "From -> To"
                // We infer the "Old Slot" from the log itself
                // Avoid duplicates in changes array
                const changeKey = `${log.schoolId}:${log.classId}:${logDay}->${targetDay}`;
                const existingChange = changes.find(c =>
                    c.schoolId === log.schoolId &&
                    c.classId === log.classId &&
                    c.oldSlot.dayOfWeek === logDay &&
                    c.newSlot.dayOfWeek === targetDay
                );

                if (!existingChange) {
                    changes.push({
                        schoolId,
                        classId,
                        oldSlot: {
                            dayOfWeek: logDay as DayOfWeek,
                            shiftId: 'unknown',
                            slotId: log.slotId, // Best guess
                            startTime: log.startTime,
                            endTime: log.endTime
                        },
                        newSlot: {
                            dayOfWeek: targetDay,
                            shiftId: targetSlot.shiftId,
                            slotId: targetSlot.slotId,
                            startTime: targetSlotDetails?.startTime,
                            endTime: targetSlotDetails?.endTime
                        }
                    });
                }
            }
        });
    });

    // 4. Do the exact same for Orphan Events
    const orphanEventsByClass = new Map<string, SchoolEvent[]>();
    orphanEvents.forEach(event => {
        if (!event.classId) return;
        const key = `${event.schoolId}:${event.classId}`;
        if (!orphanEventsByClass.has(key)) orphanEventsByClass.set(key, []);
        orphanEventsByClass.get(key)!.push(event);
    });

    orphanEventsByClass.forEach((classEvents, key) => {
        const [schoolId, classId] = key.split(':');

        const newClassSlots = newSchedules
            .filter(s => s.schoolId === schoolId && s.classId === classId && s.classId !== 'window')
            .sort((a, b) => {
                if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
                return (a.slotId || '').localeCompare(b.slotId || '');
            });

        if (newClassSlots.length === 0) return;

        const weekGroups = groupLogsByWeek(classEvents, activeFrom);

        weekGroups.forEach((weekEvents, weekKey) => {
            const sortedEvents = (weekEvents as SchoolEvent[]).sort((a, b) => {
                return a.date.localeCompare(b.date);
            });

            const matchCount = Math.min(sortedEvents.length, newClassSlots.length);

            for (let i = 0; i < matchCount; i++) {
                const event = sortedEvents[i];
                const targetSlot = newClassSlots[i];

                const eventDay = new Date(event.date.split('T')[0] + 'T00:00:00').getDay();
                const targetDay = targetSlot.dayOfWeek;

                const newDate = calculateNewDate(event.date, eventDay, targetDay);

                affectedEvents.push({
                    event,
                    suggestedNewDate: newDate,
                    suggestedNewSlotId: targetSlot.slotId,
                });
            }
        });
    });

    console.log('--- Orphan Migration Analysis ---');
    console.log('Orphans Found:', orphans.length);
    console.log('Migratable Logs:', affectedLogs.length);

    return {
        changes,
        affectedLogs,
        affectedEvents,
        orphans, // <--- Export orphans for manual migration UI
        orphanEvents
    };
}
