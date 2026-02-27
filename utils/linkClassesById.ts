
import { AppData, SchoolClass } from '../types';

export const migrateNamesToIds = (data: AppData): AppData => {
    console.log("Starting Migration: Class Names -> Class IDs");
    let updatedData = { ...data };

    // Generate IDs for legacy string classes if they don't have them (converting string[] to SchoolClass[])
    // AND Build a Mapping of "SchoolID + ClassName" -> "ClassID"
    const nameToIdMap: Record<string, string> = {}; // key: `${schoolId}:${className}` -> value: classId

    updatedData.schools = updatedData.schools.map((school: any) => {
        const updatedClasses: SchoolClass[] = [];

        (school.classes || []).forEach(cls => {
            let classObj: SchoolClass;

            if (typeof cls === 'string') {
                // Legacy String Class - Convert to Object with NEW ID (if not already mapped?)
                // Wait, if it's a string, we generate a new ID.
                classObj = { id: crypto.randomUUID(), name: cls };
            } else {
                // Already Object
                classObj = cls;
                if (!classObj.id) classObj.id = crypto.randomUUID(); // Ensure ID
            }

            // Map Name -> ID
            // If duplicate name exists in same school, FIRST one claims the data.
            // The second one gets a new ID but no data mapped (Separation!)
            const key = `${school.id}:${classObj.name}`;
            if (!nameToIdMap[key]) {
                nameToIdMap[key] = classObj.id;
            }

            updatedClasses.push(classObj);
        });

        return { ...school, classes: updatedClasses };
    });

    // Now Replace Names with IDs in all collections

    // 1. ClassRecords (Students)
    updatedData.classRecords = (updatedData.classRecords || []).map(r => {
        const key = `${r.schoolId}:${r.classId}`; // r.classId is currently Name
        const newId = nameToIdMap[key];
        return newId ? { ...r, classId: newId } : r; // Update to ID if found
    });

    // 2. Events (Scheduled Tests, Works)
    updatedData.events = (updatedData.events || []).map(e => {
        const key = `${e.schoolId}:${e.classId}`;
        const newId = nameToIdMap[key];
        return newId ? { ...e, classId: newId } : e;
    });

    // 3. CustomAssessments
    updatedData.customAssessments = (updatedData.customAssessments || []).map(c => {
        const key = `${c.schoolId}:${c.classId}`;
        const newId = nameToIdMap[key];
        return newId ? { ...c, classId: newId } : c;
    });

    // 4. Logs (Diaries)
    updatedData.logs = (updatedData.logs || []).map(l => {
        const key = `${l.schoolId}:${l.classId}`;
        const newId = nameToIdMap[key];
        return newId ? { ...l, classId: newId } : l;
    });

    // 5. Schedules (Time Slots)
    updatedData.schedules = (updatedData.schedules || []).map(s => {
        // Note: Schedules might use "window" or empty string. Check validity.
        if (!s.classId || s.classId === 'window') return s;
        const key = `${s.schoolId}:${s.classId}`;
        const newId = nameToIdMap[key];
        return newId ? { ...s, classId: newId } : s;
    });

    // 6. GradingConfigs
    updatedData.gradingConfigs = (updatedData.gradingConfigs || []).map(g => {
        const key = `${g.schoolId}:${g.classId}`;
        const newId = nameToIdMap[key];
        return newId ? { ...g, classId: newId } : g;
    });

    console.log("Migration Complete.");
    return updatedData;
};
