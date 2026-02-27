
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface TimeSlot {
  id: string;
  startTime: string;
  endTime: string;
  type: 'class' | 'break';
  label: string;
}

export interface Shift {
  id: string;
  name: string;
  slots: TimeSlot[];
}

export interface School {
  id: string;
  name: string;
  color: string;
  subjects: string[];
  classes: SchoolClass[];
  shifts: Shift[];
  deleted?: boolean;
  deletedAt?: string;
}

export interface SchoolClass {
  id: string;
  name: string;
  subject?: string;
  deleted?: boolean;
  deletedAt?: string;
}

export interface PrivateSchedule {
  id: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
}

export type PaymentModel = 'monthly' | 'per_class';

export interface PaymentRecord {
  id: string;
  date: string;
  amount: number;
  referenceData?: string; // "YYYY-MM" for monthly
  notes?: string;
}

export interface StudentPaymentConfig {
  enabled: boolean;
  model: PaymentModel;
  value: number;
  dueDay: number;
}

export interface Student {
  id: string;
  name: string;
  subject: string;
  color: string;
  startDate: string; // Data a partir da qual as aulas são contadas
  schedules: PrivateSchedule[];
  paymentConfig?: StudentPaymentConfig;
  payments?: PaymentRecord[];
}

// Novos Tipos para Modos Avançados
export interface ClassStudent {
  id: string;
  name: string;
  active?: boolean; // Define se o aluno está ativo na turma
  disabledAt?: string; // Data em que saiu da turma
}

export interface ClassRecord {
  id: string;
  schoolId: string;
  classId: string;
  students: ClassStudent[];
  createdAt?: string; // Data de criação da turma
  updatedAt?: string; // Data da última alteração na lista
}

export interface TeacherProfile {
  title?: 'Prof.' | 'Profª.';
  name: string;
  subjects: string[];
  setupCompleted?: boolean;
}

export interface ScheduleEntry {
  id: string; // Adicionado para suporte ao mergeArrays
  dayOfWeek: DayOfWeek;
  schoolId: string;
  shiftId: string;
  slotId: string;
  classId: string;
}

export interface ScheduleVersion {
  id: string;
  activeFrom: string; // YYYY-MM-DD
  createdAt: string;
  name?: string;
  schedules: ScheduleEntry[];
}

export interface AppData {
  profile: TeacherProfile;
  schools: School[];
  students: Student[];
  classRecords: ClassRecord[];
  schedules: ScheduleEntry[]; // DEPRECATED: Kept for legacy compatibility/migration
  scheduleVersions: ScheduleVersion[]; // NEW: Source of Truth
  logs: LessonLog[];
  events: SchoolEvent[];
  calendars: AcademicCalendar[];
  reminders: Reminder[];
  grades: GradeEntry[];
  customAssessments: CustomAssessment[];
  gradingConfigs: GradingConfig[];
  settings: AppSettings;
}

export interface Occurrence {
  id: string;
  type: string;
  description: string;
  studentIds?: string[]; // IDs dos alunos envolvidos na ocorrência
}

export type AttendanceStatus = 'present' | 'absent' | 'justified';

export interface StudentAttendance {
  studentId: string;
  status: AttendanceStatus;
}

export interface LessonLog {
  id: string;
  date: string;
  schoolId: string;
  studentId?: string;
  classId: string;
  slotId: string;
  subject: string;
  homework: string;
  notes: string;
  occurrences?: Occurrence[];
  attendance?: StudentAttendance[]; // Lista de presença
  type?: 'regular' | 'extra' | 'substitution';
  substitutionSubject?: string;
  startTime?: string;
  endTime?: string;
  status?: 'active' | 'removed';
}

export type EventType = 'test' | 'work' | 'meeting' | 'festivity' | 'trip' | 'material' | 'other';

export interface SchoolEvent {
  id: string;
  date: string;
  schoolId: string;
  classId?: string;
  affectedClassIds?: string[];
  slotId?: string;
  type: EventType;
  title: string;
  description: string;
  blocksClasses: boolean;
  blocksShift?: boolean;
  weight?: number; // Peso da avaliação para o cálculo de média
  maxGrade?: number; // Nota máxima (default: 10)
}

export interface Term {
  name: string;
  start: string;
  end: string;
}

export interface Recess {
  id: string;
  name: string;
  date: string;
}

export interface AcademicCalendar {
  id: string;
  schoolId: string;
  year: number;
  division: 'bimestres' | 'trimestres' | 'personalizado';
  terms: Term[];
  midYearBreak: { start: string; end: string };
  extraRecesses: Recess[];
  start: string;
  end: string;
}

export interface Reminder {
  id: string;
  date: string;
  alarmTime?: string;
  alarmTriggered?: boolean;
  category: 'occurrence' | 'observation' | 'topic' | 'general';
  title: string;
  content: string;
  schoolId?: string;
  classId?: string;
  studentId?: string;
}

// === TIPOS DO MODO NOTAS ===

export interface GradeEntry {
  id: string;
  studentId: string;
  assessmentId: string; // Pode ser ID de SchoolEvent ou CustomAssessment
  value: number;
}

export interface CustomAssessment {
  id: string;
  schoolId: string;
  classId: string;
  termIndex: number;
  title: string;
  date: string; // Data de referência (para ordenação)
  weight: number;
  maxGrade?: number;
}

export interface GradingConfig {
  id: string;
  schoolId: string;
  classId: string;
  termIndex: number;
  formula: 'arithmetic' | 'weighted' | 'custom'; // Adicionado 'custom'
  customFormula?: string; // Fórmula personalizada (ex: "(N1 + N2)/2")
}

export interface AdvancedModes {
  attendance: boolean;
  individualOccurrence: boolean;
  grades: boolean;
}

export interface AppSettings {
  alertBeforeMinutes: number;
  alertAfterLesson: boolean;
  alertAfterShift: boolean;
  alertAfterShiftDelay?: number; // Delay em minutos para alerta de turno (0, 1, 5, 10)
  isPrivateTeacher: boolean;
  lastSyncAt?: string;
  googleSyncEnabled: boolean;
  showQuickStartGuide: boolean;
  themeColor: string;
  darkMode: boolean;
  showDailyQuote: boolean;
  alertType?: 'notification' | 'popup'; // Novo tipo de alerta
  alertNotificationStyle?: 'sound' | 'vibration' | 'silent'; // Estilo do push
  advancedModes?: AdvancedModes; // Novos modos

  // Controles de Exibição de Alertas
  hideUnregisteredClassesOnDiary?: boolean;
  termsAccepted?: boolean;
}

export interface AppData {
  profile: TeacherProfile;
  schools: School[];
  students: Student[]; // Alunos particulares
  classRecords: ClassRecord[]; // Listas de alunos por turma (Modos avançados)
  schedules: ScheduleEntry[];
  logs: LessonLog[];
  events: SchoolEvent[];
  calendars: AcademicCalendar[];
  reminders: Reminder[];
  grades: GradeEntry[]; // Notas lançadas
  customAssessments: CustomAssessment[]; // Colunas extras de notas
  gradingConfigs: GradingConfig[]; // Configurações de média por turma/bimestre
  settings: AppSettings;
}
