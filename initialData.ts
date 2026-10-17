import { AppData } from './types';

export const INITIAL_DATA: AppData = {
  profile: { name: '', subjects: [], setupCompleted: false },
  schools: [],
  students: [],
  classRecords: [],
  schedules: [],
  scheduleVersions: [], // Inicializa array de versões
  logs: [],
  events: [],
  calendars: [],
  reminders: [],
  grades: [], // Inicializa array de notas
  customAssessments: [], // Inicializa array de avaliações personalizadas
  gradingConfigs: [], // Inicializa configurações de média
  settings: {
    alertBeforeMinutes: 5,
    alertAfterLesson: false,
    alertAfterShift: true,
    alertAfterShiftDelay: 0,
    alertType: 'notification',
    alertNotificationStyle: 'silent',
    isPrivateTeacher: false,
    googleSyncEnabled: false,
    showQuickStartGuide: true,
    themeColor: '#2563eb',
    darkMode: false,
    showDailyQuote: true,
    advancedModes: {
      attendance: false,
      individualOccurrence: false,
      grades: false
    },
    termsAccepted: false
  }
};
