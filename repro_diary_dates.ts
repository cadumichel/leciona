
import { AppData, School, AcademicCalendar, ScheduleEntry, Shift, SchoolClass, DayOfWeek } from './types';

// Mock Data Setup
const schoolA: School = {
    id: 'school-a',
    name: 'School A (Starts 04/02)',
    color: '#000000',
    subjects: ['Math'],
    classes: [{ id: 'class-a1', name: 'Class A1' }],
    shifts: [{
        id: 'shift-a',
        name: 'Morning',
        slots: [{ id: 'slot-a1', startTime: '08:00', endTime: '09:00', type: 'class', label: 'Math' }]
    }]
};

const schoolB: School = {
    id: 'school-b',
    name: 'School B (Starts 09/02)',
    color: '#ffffff',
    subjects: ['History'],
    classes: [{ id: 'class-b1', name: 'Class B1' }],
    shifts: [{
        id: 'shift-b',
        name: 'Morning',
        slots: [{ id: 'slot-b1', startTime: '08:00', endTime: '09:00', type: 'class', label: 'History' }]
    }]
};

// 04/02/2026 is Wednesday (Day 3)
const dateToCheck = '2026-02-04';
const dayOfWeek = 3;

const calendarA: AcademicCalendar = {
    id: 'cal-a',
    schoolId: 'school-a',
    year: 2026,
    division: 'bimestres',
    terms: [],
    midYearBreak: { start: '', end: '' },
    extraRecesses: [],
    start: '2026-02-04',
    end: '2026-12-15'
};

const calendarB: AcademicCalendar = {
    id: 'cal-b',
    schoolId: 'school-b',
    year: 2026,
    division: 'bimestres',
    terms: [],
    midYearBreak: { start: '', end: '' },
    extraRecesses: [],
    start: '2026-02-09', // Starts AFTER the date checks
    end: '2026-12-15'
};

const schedules: ScheduleEntry[] = [
    { id: 's1', dayOfWeek: 3, schoolId: 'school-a', shiftId: 'shift-a', slotId: 'slot-a1', classId: 'class-a1' },
    { id: 's2', dayOfWeek: 3, schoolId: 'school-b', shiftId: 'shift-b', slotId: 'slot-b1', classId: 'class-b1' }
];

const mockData: AppData = {
    schools: [schoolA, schoolB],
    calendars: [calendarA, calendarB],
    schedules: schedules,
    scheduleVersions: [{ id: 'v1', activeFrom: '2026-01-01', createdAt: '', schedules: schedules }],
    // ... other unrelated fields empty
    logs: [],
    events: [],
    students: [],
    classRecords: [],
    profile: { name: 'Teacher', subjects: [] },
    reminders: [],
    grades: [],
    customAssessments: [],
    gradingConfigs: [],
    settings: {
        alertBeforeMinutes: 0,
        alertAfterLesson: false,
        alertAfterShift: false,
        isPrivateTeacher: false,
        googleSyncEnabled: false,
        showQuickStartGuide: false,
        themeColor: '',
        darkMode: false,
        showDailyQuote: false
    }
};

// Simplified Logic from LessonLogger.tsx (integratedPanoramicColumns)
function getVisibleLessons(data: AppData, date: string) {
    const visibleLessons: string[] = [];
    const currentYear = new Date(date).getFullYear();

    // Mock getSchedulesForDate (since we just have one version)
    const dailySchedules = data.schedules;

    data.schools.forEach(school => {
        school.shifts.forEach(shift => {
            shift.slots.forEach(slot => {
                const schedule = dailySchedules.find(s =>
                    s.dayOfWeek === dayOfWeek &&
                    s.schoolId === school.id &&
                    s.shiftId === shift.id &&
                    s.slotId === slot.id
                );

                if (schedule) {
                    // CURRENT LOGIC (Missing Date Check)
                    // In the actual component, it just checks for schedule existence
                    // We want to verify that School B shows up here erroneously
                    visibleLessons.push(`${school.name}`);
                }
            });
        });
    });

    return visibleLessons;
}

// Logic WITH FIX
function getVisibleLessonsFixed(data: AppData, date: string) {
    const visibleLessons: string[] = [];
    const currentYear = new Date(date).getFullYear();
    const dailySchedules = data.schedules;

    data.schools.forEach(school => {
        // FIX: Check Academic Calendar
        const calendar = data.calendars.find(c => c.schoolId === school.id && c.year === currentYear) ||
            data.calendars.find(c => c.schoolId === school.id);

        if (calendar) {
            if (calendar.start && date < calendar.start) return; // Skip if before start
            if (calendar.end && date > calendar.end) return;     // Skip if after end
        }

        school.shifts.forEach(shift => {
            shift.slots.forEach(slot => {
                const schedule = dailySchedules.find(s =>
                    s.dayOfWeek === dayOfWeek &&
                    s.schoolId === school.id &&
                    s.shiftId === shift.id &&
                    s.slotId === slot.id
                );

                if (schedule) {
                    visibleLessons.push(`${school.name}`);
                }
            });
        });
    });

    return visibleLessons;
}

console.log('--- REPRODUCTION TEST ---');
const currentResult = getVisibleLessons(mockData, dateToCheck);
console.log('Visible Lessons (Current Logic):', currentResult);

if (currentResult.includes('School B (Starts 09/02)')) {
    console.log('FAIL: School B should NOT be visible on 04/02');
} else {
    console.log('PASS: School B is correctly hidden');
}

console.log('\n--- FIXED LOGIC TEST ---');
const fixedResult = getVisibleLessonsFixed(mockData, dateToCheck);
console.log('Visible Lessons (Fixed Logic):', fixedResult);

if (!fixedResult.includes('School B (Starts 09/02)') && fixedResult.includes('School A (Starts 04/02)')) {
    console.log('PASS: Logic correctly filters out School B');
} else {
    console.log('FAIL: Logic failed to filter correctly');
}
