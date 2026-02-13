
import { AppData, LessonLog, ScheduleEntry, School, Shift, TimeSlot } from './types';
import { getLessonDisplayItems } from './utils/lessonStats';

// Mock Data Setup
const mockSchool: School = {
    id: 'school1',
    name: 'School 1',
    color: '#000000',
    subjects: ['Math'],
    classes: [{ id: 'classUUID', name: 'ClassName' }],
    shifts: [{
        id: 'shift1',
        name: 'Morning',
        slots: [{ id: 'slot1', startTime: '08:00', endTime: '09:00', type: 'class', label: '1st Slot' }]
    }]
};

// Schedule uses UUID
const mockSchedule: ScheduleEntry = {
    id: 'sch1',
    dayOfWeek: 1,
    schoolId: 'school1',
    shiftId: 'shift1',
    slotId: 'slot1',
    classId: 'classUUID'
};

// Log uses Name (Legacy or Migration issue) AND Slot ID mismatch
const mockLog: LessonLog = {
    id: 'log1',
    date: '2024-02-12T00:00:00.000Z',
    schoolId: 'school1',
    classId: 'ClassName', // Mismatch!
    slotId: 'slotOLD',    // Mismatch!
    startTime: '08:00',   // Match
    endTime: '09:00',
    subject: 'Math Class',
    homework: '',
    notes: '',
    occurrences: [],
    type: 'regular',
    status: 'active'
};

const mockData: AppData = {
    profile: { name: 'Teacher', subjects: ['Math'] },
    schools: [mockSchool],
    students: [],
    classRecords: [],
    schedules: [mockSchedule],
    scheduleVersions: [],
    logs: [mockLog],
    events: [],
    calendars: [{
        id: 'cal1',
        schoolId: 'school1',
        year: 2024,
        division: 'bimestres',
        terms: [{ name: 'Term 1', start: '2024-01-01', end: '2024-12-31' }],
        midYearBreak: { start: '', end: '' },
        extraRecesses: [],
        start: '2024-01-01',
        end: '2024-12-31'
    }],
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

// Test Execution
console.log("Running duplication test (Mismatch Scenario)...");

const items = getLessonDisplayItems(mockData, {
    start: '2024-02-12',
    end: '2024-02-12',
    schoolId: 'all',
    classId: 'all',
    showWithContent: true,
    showWithoutContent: true
});

console.log(`Found ${items.length} items`);
items.forEach(item => {
    console.log(`- ID: ${item.id}, LogID: ${item.log?.id || 'None'}, Content: ${item.hasContent}`);
});

if (items.length > 1) {
    console.error("FAIL: Duplicates found!");
} else {
    console.log("PASS: No duplicates.");
}
