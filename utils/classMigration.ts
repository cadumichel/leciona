
import { AppData } from '../types';

/**
 * Renomear turma: referências pelo código interno não precisam mudar (o código continua o mesmo).
 * Só as referências que guardam o NOME da turma (grade horária e registros criados a partir dela)
 * precisam ser atualizadas — inclusive dentro das versões de horário, que antes ficavam de fora
 * e passavam a apontar para um nome que não existia mais.
 */
export const migrateClassData = (
    data: AppData,
    schoolId: string,
    oldClassName: string,
    newClassName: string
): Partial<AppData> => {
    const rename = <T extends { schoolId?: string; classId?: string }>(item: T): T =>
        (item.schoolId === schoolId && item.classId === oldClassName)
            ? { ...item, classId: newClassName }
            : item;

    return {
        classRecords: (data.classRecords || []).map(rename),
        events: (data.events || []).map(rename),
        customAssessments: (data.customAssessments || []).map(rename),
        gradingConfigs: (data.gradingConfigs || []).map(rename),
        reminders: (data.reminders || []).map(rename),
        schedules: (data.schedules || []).map(rename),
        scheduleVersions: (data.scheduleVersions || []).map(v => ({
            ...v,
            schedules: (v.schedules || []).map(rename)
        })),
        logs: (data.logs || []).map(rename)
    };
};
