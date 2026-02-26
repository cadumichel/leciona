import { LessonLog, ScheduleEntry, DayOfWeek } from '../types';

interface ScheduleGroup {
    schoolId: string;
    classId: string;
    oldSchedules: ScheduleEntry[];
    newSchedules: ScheduleEntry[];
}

/**
 * Migrates planned lesson logs when a new schedule version is created.
 * Maps logs sequentially from old schedule slots to new schedule slots.
 * 
 * @param oldSchedules - Schedules from the previous version
 * @param newSchedules - Schedules from the new version
 * @param activeFrom - Date when new version becomes active (YYYY-MM-DD)
 * @param logs - All lesson logs
 * @returns Updated logs with migrated future lessons
 */
export function migrateLogsForNewVersion(
    oldSchedules: ScheduleEntry[],
    newSchedules: ScheduleEntry[],
    activeFrom: string,
    logs: LessonLog[]
): LessonLog[] {
    // Group schedules by school + class
    const groups = detectScheduleChanges(oldSchedules, newSchedules);

    // Clone logs to avoid mutation
    let updatedLogs = [...logs];

    // For each changed group, migrate logs
    groups.forEach(group => {
        updatedLogs = migrateLogsForGroup(group, activeFrom, updatedLogs);
    });

    return updatedLogs;
}

/**
 * Detect which classes had schedule changes
 */
function detectScheduleChanges(
    oldSchedules: ScheduleEntry[],
    newSchedules: ScheduleEntry[]
): ScheduleGroup[] {
    const groups: Map<string, ScheduleGroup> = new Map();

    // Build map of old schedules
    oldSchedules.forEach(schedule => {
        if (schedule.classId === 'window') return;

        const key = `${schedule.schoolId}|${schedule.classId}`;
        if (!groups.has(key)) {
            groups.set(key, {
                schoolId: schedule.schoolId,
                classId: schedule.classId,
                oldSchedules: [],
                newSchedules: []
            });
        }
        groups.get(key)!.oldSchedules.push(schedule);
    });

    // Add new schedules
    newSchedules.forEach(schedule => {
        if (schedule.classId === 'window') return;

        const key = `${schedule.schoolId}|${schedule.classId}`;
        if (!groups.has(key)) {
            groups.set(key, {
                schoolId: schedule.schoolId,
                classId: schedule.classId,
                oldSchedules: [],
                newSchedules: []
            });
        }
        groups.get(key)!.newSchedules.push(schedule);
    });

    // Filter only groups with actual changes
    return Array.from(groups.values()).filter(group => {
        return hasScheduleChanges(group.oldSchedules, group.newSchedules);
    });
}

/**
 * Check if schedules changed (different days or times)
 */
function hasScheduleChanges(
    oldSchedules: ScheduleEntry[],
    newSchedules: ScheduleEntry[]
): boolean {
    if (oldSchedules.length !== newSchedules.length) return true;

    // Compare sorted schedules
    const oldSorted = [...oldSchedules].sort((a, b) =>
        `${a.dayOfWeek}${a.slotId}`.localeCompare(`${b.dayOfWeek}${b.slotId}`)
    );
    const newSorted = [...newSchedules].sort((a, b) =>
        `${a.dayOfWeek}${a.slotId}`.localeCompare(`${b.dayOfWeek}${b.slotId}`)
    );

    for (let i = 0; i < oldSorted.length; i++) {
        if (oldSorted[i].dayOfWeek !== newSorted[i].dayOfWeek ||
            oldSorted[i].slotId !== newSorted[i].slotId) {
            return true;
        }
    }

    return false;
}

/**
 * Migrate logs for a specific class group
 */
function migrateLogsForGroup(
    group: ScheduleGroup,
    activeFrom: string,
    logs: LessonLog[]
): LessonLog[] {
    // Find future logs for this class
    const futureLogs = logs.filter(log => {
        const logDate = log.date.substring(0, 10); // Extract YYYY-MM-DD
        return logDate >= activeFrom &&
            log.schoolId === group.schoolId &&
            log.classId === group.classId &&
            log.type !== 'extra' && // Don't migrate manual extra lessons
            log.status !== 'removed';
    });

    if (futureLogs.length === 0) return logs;

    // Group logs by week
    const weekGroups = groupLogsByWeek(futureLogs, activeFrom);

    // Migrate each week
    const migratedLogs = logs.map(log => {
        const weekKey = getWeekKey(log.date, activeFrom);
        const weekLogs = weekGroups.get(weekKey);

        if (!weekLogs || !weekLogs.includes(log)) return log;

        // Find position in old schedule
        const oldIndex = findLogPosition(log, group.oldSchedules);
        if (oldIndex === -1) return log; // Can't determine position

        // Map to new schedule
        const newSchedule = group.newSchedules[oldIndex];
        if (!newSchedule) {
            // More old slots than new slots - keep as orphan
            console.warn(`Log orphaned: ${log.id} - old schedule has more slots than new`);
            return log;
        }

        // Calculate new date based on new day of week
        const newDate = calculateNewDate(log.date, newSchedule.dayOfWeek, activeFrom);

        // Migrate the log
        return {
            ...log,
            date: newDate,
            slotId: newSchedule.slotId,
            // Keep all other properties (subject, homework, notes, occurrences, attendance)
        };
    });

    return migratedLogs;
}

/**
 * Group logs by week number relative to activeFrom
 */
function groupLogsByWeek(
    logs: LessonLog[],
    activeFrom: string
): Map<string, LessonLog[]> {
    const groups = new Map<string, LessonLog[]>();

    logs.forEach(log => {
        const weekKey = getWeekKey(log.date, activeFrom);
        if (!groups.has(weekKey)) {
            groups.set(weekKey, []);
        }
        groups.get(weekKey)!.push(log);
    });

    // Sort logs within each week by date/time
    groups.forEach(weekLogs => {
        weekLogs.sort((a, b) => a.date.localeCompare(b.date));
    });

    return groups;
}

/**
 * Get week identifier for a date
 */
function getWeekKey(dateString: string, activeFrom: string): string {
    const date = new Date(dateString.split('T')[0] + 'T00:00:00');
    const fromDate = new Date(activeFrom + 'T00:00:00');
    const diffDays = Math.floor((date.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
    const weekNumber = Math.floor(diffDays / 7);
    return `week_${weekNumber}`;
}

/**
 * Find position of log in old schedule (by matching time/day)
 */
function findLogPosition(log: LessonLog, schedules: ScheduleEntry[]): number {
    // Try to find by slotId first
    const bySlotId = schedules.findIndex(s => s.slotId === log.slotId);
    if (bySlotId !== -1) return bySlotId;

    // Fallback: match by day of week and approximate time
    const logDate = new Date(log.date.split('T')[0] + 'T00:00:00');
    const logDay = logDate.getDay() as DayOfWeek;

    const candidatesOnSameDay = schedules
        .map((s, idx) => ({ schedule: s, index: idx }))
        .filter(({ schedule }) => schedule.dayOfWeek === logDay);

    if (candidatesOnSameDay.length === 1) {
        return candidatesOnSameDay[0].index;
    }

    // Multiple on same day - can't determine reliably
    return -1;
}

/**
 * Calculate new date for a log based on new day of week
 */
function calculateNewDate(
    oldDate: string,
    newDayOfWeek: DayOfWeek,
    activeFrom: string
): string {
    const old = new Date(oldDate.split('T')[0] + 'T00:00:00');
    const weekStart = new Date(activeFrom + 'T00:00:00');

    // Find which week this log belongs to
    const diffDays = Math.floor((old.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24));
    const weekNumber = Math.floor(diffDays / 7);

    // Calculate new date in the same week
    const newDate = new Date(weekStart);
    newDate.setDate(weekStart.getDate() + (weekNumber * 7) + newDayOfWeek);

    return newDate.toISOString();
}
