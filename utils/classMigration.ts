
import { AppData, SchoolClass } from '../types';

export const migrateClassData = (
    data: AppData,
    schoolId: string,
    oldClassName: string,
    newClassName: string
): Partial<AppData> => {
    console.log(`Migrating class ${oldClassName} to ${newClassName} in school ${schoolId}`);

    // 1. Update ClassRecords (Students)
    const classRecords = (data.classRecords || []).map(r =>
        (r.schoolId === schoolId && r.classId === oldClassName)
            ? { ...r, classId: newClassName }
            : r
    );

    // 2. Update Events (Scheduled Tests, Works)
    const events = (data.events || []).map(e =>
        (e.schoolId === schoolId && e.classId === oldClassName)
            ? { ...e, classId: newClassName }
            : e
    );

    // 3. Update CustomAssessments (Custom Columns)
    const customAssessments = (data.customAssessments || []).map(c =>
        (c.schoolId === schoolId && c.classId === oldClassName)
            ? { ...c, classId: newClassName }
            : c
    );

    // 4. Update Schedules (Time slots)
    const schedules = (data.schedules || []).map(s =>
        (s.schoolId === schoolId && s.classId === oldClassName)
            ? { ...s, classId: newClassName }
            : s
    );

    // 5. Update Logs (Daily Lessons and Occurrences)
    const logs = (data.logs || []).map(l =>
        (l.schoolId === schoolId && l.classId === oldClassName)
            ? { ...l, classId: newClassName }
            : l
    );

    // 6. Update School Classes (Usually handled by component, but safe to return if needed)
    // Logic mostly relies on the component updating the School object itself, 
    // but we return the dependent data updates here.

    return {
        classRecords,
        events,
        customAssessments,
        schedules,
        logs
    };
};
