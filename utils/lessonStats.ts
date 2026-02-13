
import { AppData, LessonLog, ScheduleEntry, TimeSlot, School, DayOfWeek, Student } from '../types';
import { isHoliday, parseTimeToMinutes, checkTimeOverlap } from '../utils';
import { getSchedulesForDate } from './schedule';

export interface LessonDisplayItem {
    id: string; // unique key for rendering
    schedule: ScheduleEntry;
    log?: LessonLog;
    date: string;
    institution: School | Student;
    slot: TimeSlot;
    dayOfWeek: DayOfWeek;
    isExtra?: boolean;
    isSubstitution?: boolean;
    hasContent: boolean;
    isPast: boolean;
}

export interface LessonStats {
    total: number;
    completed: number;
    pending: number;
}

export interface LessonFilters {
    start: string;
    end: string;
    schoolId: string;
    classId: string;
    periodIdx?: string;
    showWithContent?: boolean;
    showWithoutContent?: boolean;
}

// Helper to check if a lesson is blocked
export const isLessonBlocked = (data: AppData, dateStr: string, schoolId: string, shiftId?: string, classId?: string): boolean => {
    const calendar = data.calendars.find(c => c.schoolId === schoolId);
    if (calendar) {
        if (calendar.midYearBreak.start && dateStr >= calendar.midYearBreak.start && dateStr <= calendar.midYearBreak.end) return true;
        if (calendar.extraRecesses?.some(r => r.date === dateStr)) return true;
    }

    const events = data.events.filter(e => e.schoolId === schoolId && e.date.startsWith(dateStr) && e.blocksClasses);
    for (const event of events) {
        if (!event.slotId && !event.classId) return true;
        if (event.slotId && event.slotId === shiftId) return true;
        if (event.classId && event.classId === classId) return true;
    }
    return false;
};

export const getLessonDisplayItems = (data: AppData, filters: LessonFilters): LessonDisplayItem[] => {
    const items: LessonDisplayItem[] = [];
    const { start, end, schoolId: filterInstId, classId: filterClassId, periodIdx: filterPeriodIdx, showWithContent, showWithoutContent } = filters;

    const startDate = new Date(start + 'T00:00:00');
    const endDate = new Date(end + 'T00:00:00');
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const currentMins = now.getHours() * 60 + now.getMinutes();

    // 1. Iterate dates
    const cursor = new Date(startDate);
    // Ensure we don't loop endlessly if dates are swapped, but usually start <= end
    while (cursor <= endDate) {
        const dateStr = cursor.toLocaleDateString('en-CA');
        const dayOfWeek = cursor.getDay() as DayOfWeek;

        // Only process if not holiday (unless it has a log? usually logs on holidays are rare but possible if extra. 
        // But original logic skips holidays for planned lessons.)
        if (!isHoliday(cursor)) {

            // A. Scheduled Classes
            const dailySchedules = getSchedulesForDate(data, dateStr);
            dailySchedules.forEach(s => {
                if (Number(s.dayOfWeek) !== dayOfWeek || s.classId === 'window') return;
                if (filterInstId !== 'all' && s.schoolId !== filterInstId) return;
                if (filterClassId !== 'all' && s.classId !== filterClassId) return;

                const school = data.schools.find(sc => sc.id === s.schoolId);
                if (!school || school.deleted) return;

                if (isLessonBlocked(data, dateStr, s.schoolId, s.shiftId, s.classId)) return;

                const slot = school.shifts.find(sh => sh.id === s.shiftId)?.slots.find(sl => sl.id === s.slotId);
                if (!slot) return;

                // Check Calendar
                const schoolCalendars = data.calendars.filter(c => c.schoolId === s.schoolId);
                let matchingCalendar = null;

                if (schoolCalendars.length > 0) {
                    // If school has calendars, the date MUST be within one of them
                    matchingCalendar = schoolCalendars.find(c => dateStr >= c.start && dateStr <= c.end);
                    if (!matchingCalendar) return;

                    // Check Term if filtered
                    if (filterPeriodIdx && filterPeriodIdx !== 'all') {
                        const term = matchingCalendar.terms[Number(filterPeriodIdx)];
                        // Only filter by term if the term exists AND we are in the calendar that corresponds to the filter context?
                        // Assuming filterPeriodIdx applies to the calendar found (if multiple calendars, this might be tricky, but usually filters are combined with a year/inst filter)
                        // For safety: If filterPeriodIdx is active, we validy against the term of the MATCHING calendar.
                        if (term && (dateStr < term.start || dateStr > term.end)) return;
                    }
                }

                // Check Log
                let log = data.logs.find(l => l.date.startsWith(dateStr) && l.slotId === s.slotId && l.schoolId === s.schoolId);

                // FALLBACK: If Strict Slot ID match fails, try finding by Time/Class Match
                if (!log) {
                    log = data.logs.find(l => {
                        if (!l.date.startsWith(dateStr)) return false;
                        if (l.schoolId !== s.schoolId) return false;
                        if (l.startTime !== slot!.startTime) return false;

                        // Check class ID or Name
                        if (l.classId === s.classId) return true;

                        // Fallback: Check if s.classId is Name and l.classId is ID (or vice versa)
                        // Resolve s.classId (which might be ID) to Name
                        const classObj = school.classes.find(c => (typeof c === 'string' ? c : c.id) === s.classId);
                        const className = classObj ? (typeof classObj === 'string' ? classObj : classObj.name) : s.classId;

                        // Check if log classId matches the resolved name
                        if (l.classId === className) return true;

                        // Check if log classId is an ID that resolves to the same name
                        const logClassObj = school.classes.find(c => (typeof c === 'string' ? c : c.id) === l.classId);
                        const logClassName = logClassObj ? (typeof logClassObj === 'string' ? logClassObj : logClassObj.name) : l.classId;

                        return className === logClassName;
                    });
                }
                if (log && log.status === 'removed') return;

                // Original logic skips substitutions in the scheduled loop (handled in manual loop)
                if (log && log.type === 'substitution') return;

                const hasContent = !!(log && (log.subject || log.homework || log.notes || (log.attendance && log.attendance.length > 0)));

                // Apply Content Filters
                if (showWithContent !== undefined && showWithoutContent !== undefined) {
                    if (hasContent && !showWithContent) return;
                    if (!hasContent && !showWithoutContent) return;
                }

                // Determine if past (for pending status)
                let isPast = false;
                if (dateStr < todayStr) isPast = true;
                else if (dateStr === todayStr) isPast = currentMins >= parseTimeToMinutes(slot.endTime);

                items.push({
                    id: `${dateStr}-${s.schoolId}-${s.slotId}`,
                    schedule: s,
                    log,
                    date: dateStr,
                    institution: school,
                    slot,
                    dayOfWeek,
                    hasContent,
                    isPast
                });
            });

            // B. Private Students (if enabled)
            if (data.settings.isPrivateTeacher && data.students) {
                data.students.forEach(st => {
                    if (filterInstId !== 'all' && st.id !== filterInstId) return;
                    if (filterClassId !== 'all' && st.name !== filterClassId) return;
                    if (dateStr < st.startDate) return;

                    if (isLessonBlocked(data, dateStr, st.id)) return;

                    st.schedules.filter(ps => Number(ps.dayOfWeek) === dayOfWeek).forEach(ps => {
                        const log = data.logs.find(l => l.date.startsWith(dateStr) && l.slotId === ps.id && l.studentId === st.id);
                        if (log && log.status === 'removed') return;

                        const hasContent = !!(log && (log.subject || log.homework || log.notes));
                        // Apply Content Filters
                        if (showWithContent !== undefined && showWithoutContent !== undefined) {
                            if (hasContent && !showWithContent) return;
                            if (!hasContent && !showWithoutContent) return;
                        }

                        const slot: TimeSlot = { id: ps.id, startTime: ps.startTime, endTime: ps.endTime, label: 'Particular', type: 'class' };

                        let isPast = false;
                        if (dateStr < todayStr) isPast = true;
                        else if (dateStr === todayStr) isPast = currentMins >= parseTimeToMinutes(ps.endTime);

                        items.push({
                            id: `${dateStr}-${st.id}-${ps.id}`,
                            schedule: { dayOfWeek, schoolId: st.id, shiftId: 'private', slotId: ps.id, classId: st.name } as any,
                            log,
                            date: dateStr,
                            institution: st,
                            slot,
                            dayOfWeek,
                            hasContent,
                            isPast
                        });
                    });
                });
            }
        }

        // C. Manual Logs (Extra / Substitution / Regular Manual)
        // These are date-specific, so we should check if they fall in current 'cursor' date?
        // Optimization: Filter logs array once or inside loop? 
        // Inside loop matches logic: "For this date..."
        // But logs are not indexed by date efficiently. 
        // Better: Filter logs for the date range ONCE, then iterate.
        // OR just iterate logic inside the date loop as original code does.

        const manualLogs = data.logs.filter(l =>
            l.date.startsWith(dateStr) &&
            (l.type === 'extra' || l.type === 'substitution' || l.type === 'regular') &&
            (filterInstId === 'all' || l.schoolId === filterInstId) &&
            (filterClassId === 'all' || l.classId === filterClassId)
        );

        manualLogs.forEach(l => {
            // Check duplicates (already processed as scheduled regular? Original logic handles this by excluding 'regular' from manual loop IF it matched a schedule, but here 'regular' manual usually implies it wasn't found in schedule or is override? 
            // Actually original code:  !combinedLogIds.has(l.id).
            // So we need to track processed log IDs.
            // Let's implement that tracking.
            const alreadyProcessed = items.some(i => i.log?.id === l.id);
            if (alreadyProcessed) return;

            const school = data.schools.find(sc => sc.id === l.schoolId);
            if (!school || school.deleted) return;

            // Strict Calendar Validation for Manual Logs
            const schoolCalendars = data.calendars.filter(c => c.schoolId === l.schoolId);
            if (schoolCalendars.length > 0) {
                const matchingCalendar = schoolCalendars.find(c => dateStr >= c.start && dateStr <= c.end);
                if (!matchingCalendar) return;

                if (filterPeriodIdx && filterPeriodIdx !== 'all') {
                    const term = matchingCalendar.terms[Number(filterPeriodIdx)];
                    if (term && (dateStr < term.start || dateStr > term.end)) return;
                }
            }

            const hasContent = true; // Manual logs always exist, implies content or at least existence.

            // Apply Content Filters (Manual logs generally have content, but if we have a filter...)
            if (showWithContent !== undefined && showWithoutContent !== undefined) {
                if (!showWithContent) return;
            }

            let slot: TimeSlot = { id: l.slotId, startTime: l.startTime || '00:00', endTime: l.endTime || '00:00', label: l.type === 'extra' ? 'Extra' : 'Substituição', type: 'class' };
            // Try to find real slot for prettier display if possible
            if (school.shifts) {
                const found = school.shifts.flatMap(s => s.slots).find(s => s.id === l.slotId);
                if (found) slot = found;
            }

            items.push({
                id: l.id,
                schedule: { dayOfWeek, schoolId: l.schoolId, shiftId: l.type || 'extra', slotId: l.slotId, classId: l.classId } as any,
                log: l,
                date: dateStr,
                institution: school,
                slot,
                dayOfWeek,
                isExtra: l.type === 'extra',
                isSubstitution: l.type === 'substitution',
                hasContent: true,
                isPast: true // Logs are usually past/done
            });
        });

        cursor.setDate(cursor.getDate() + 1);
    }

    return items;
};

export function deriveStatsFromLessons(lessons: LessonDisplayItem[]): LessonStats {
    if (!lessons || lessons.length === 0) {
        return { total: 0, completed: 0, pending: 0 };
    }

    const total = lessons.length;

    // Completed: Has log with content OR explicitly marked done (if we had that field, but hasContent proxy is good)
    const completed = lessons.filter(l => l.hasContent).length;

    // Pending: Is Past AND has NO content (and implicitly no log, or empty log)
    // Wait, if it's future, it's not pending.
    // And if it's past and HAS content, it's completed.
    const pending = lessons.filter(l => l.isPast && !l.hasContent).length;

    return { total, completed, pending };
}
