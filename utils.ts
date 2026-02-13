import { BRAZIL_HOLIDAYS } from './constants';
import { AcademicCalendar, Term, DayOfWeek, PrivateSchedule } from './types';

export const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

// Helper seguro para criar objeto Date a partir de string
export const getSafeDate = (dateStr: string): Date => {
  if (!dateStr) return new Date();
  // Se já tiver 'T' (ISO), usa como está. Se for YYYY-MM-DD, adiciona meio-dia para evitar problemas de fuso.
  const cleanDateStr = dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`;
  return new Date(cleanDateStr);
};

export const getDayOfWeekFromDate = (dateStr: string): DayOfWeek => {
  if (!dateStr) return 0;
  const date = getSafeDate(dateStr);
  return date.getDay() as DayOfWeek;
};

export const getHolidayName = (date: Date): string | null => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const key = `${month}-${day}`;
  return BRAZIL_HOLIDAYS[key] || null;
};

export const isHoliday = (date: Date): boolean => {
  return !!getHolidayName(date);
};

export const formatTime = (time: string): string => {
  return time; // HH:mm
};

export const parseTimeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export const addMinutesToTime = (time: string, minutesToAdd: number): string => {
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hours);
  date.setMinutes(minutes + minutesToAdd);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

// Helper de Deep Equal para evitar loops de sync
export const deepEqual = (obj1: any, obj2: any): boolean => {
  if (obj1 === obj2) return true;

  if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 === null || obj2 === null) {
    return false;
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) {
      return false;
    }
  }

  return true;
};

export const checkTimeOverlap = (start1: string, end1: string, start2: string, end2: string): boolean => {
  const s1 = parseTimeToMinutes(start1);
  const e1 = parseTimeToMinutes(end1);
  const s2 = parseTimeToMinutes(start2);
  const e2 = parseTimeToMinutes(end2);
  return Math.max(s1, s2) < Math.min(e1, e2);
};

export const getCurrentTimeInMinutes = (): number => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

export const getTermInfo = (dateStr: string, calendar?: AcademicCalendar) => {
  if (!calendar) return null;
  const date = getSafeDate(dateStr).getTime();
  const termIdx = calendar.terms.findIndex(t => {
    if (!t.start || !t.end) return false;
    const s = getSafeDate(t.start).getTime();
    const e = getSafeDate(t.end).getTime();
    return date >= s && date <= e;
  });

  if (termIdx === -1) return null;

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];
  return {
    term: calendar.terms[termIdx],
    color: colors[termIdx % colors.length],
    index: termIdx
  };
};

// Formata para o quadrado: SEG (em cima)
export const getShortWeekDay = (dateStr: string): string => {
  const date = getSafeDate(dateStr);
  if (isNaN(date.getTime())) return '---';
  const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  return days[date.getDay()];
};

// Formata para o quadrado: 12/02 (embaixo)
export const getDayMonth = (dateStr: string): string => {
  const date = getSafeDate(dateStr);
  if (isNaN(date.getTime())) return '--/--';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}`;
};

export const downloadCSV = (data: any[], filename: string) => {
  if (data.length === 0) {
    alert('Nenhum dado encontrado para exportar.');
    return;
  }

  const headers = Object.keys(data[0]);
  const separator = ';';

  const csvContent = [
    headers.join(separator),
    ...data.map(row => headers.map(header => {
      let cell = row[header] ?? '';
      cell = String(cell).replace(/"/g, '""');
      return `"${cell}"`;
    }).join(separator))
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const downloadICS = (events: { title: string; start: string; end: string; description: string }[], filename: string) => {
  if (events.length === 0) {
    alert('Nenhum evento encontrado para exportar.');
    return;
  }

  const formatToICSDate = (dateStr: string) => {
    return dateStr.replace(/[-:]/g, '').split('.')[0];
  };

  let icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Leciona//Gestao Escolar//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ].join('\r\n');

  events.forEach(event => {
    icsContent += '\r\n' + [
      'BEGIN:VEVENT',
      `SUMMARY:${event.title}`,
      `DTSTART:${formatToICSDate(event.start)}`,
      `DTEND:${formatToICSDate(event.end)}`,
      `DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`,
      'STATUS:CONFIRMED',
      'END:VEVENT'
    ].join('\r\n');
  });

  icsContent += '\r\nEND:VCALENDAR';

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.ics`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const getNearestClassDate = (schedules: PrivateSchedule[]): string => {
  if (!schedules || schedules.length === 0) {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const today = new Date();
  const currentDayOfWeek = today.getDay();
  // Reset time to midnight for accurate day difference calculation
  const baseDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let minDiff = Infinity;
  let nearestDate = baseDate;

  schedules.forEach(schedule => {
    const targetDay = typeof schedule.dayOfWeek === 'string' ? parseInt(schedule.dayOfWeek as any, 10) : schedule.dayOfWeek;

    // 1. Calculate Previous Occurrence (or today)
    const daysAgo = (currentDayOfWeek - targetDay + 7) % 7;
    const pastDate = new Date(baseDate);
    pastDate.setDate(baseDate.getDate() - daysAgo);

    // 2. Calculate Next Occurrence (or today)
    const daysUntil = (targetDay - currentDayOfWeek + 7) % 7;
    const futureDate = new Date(baseDate);
    futureDate.setDate(baseDate.getDate() + daysUntil);

    // Check Past
    const diffPast = Math.abs(pastDate.getTime() - baseDate.getTime());
    if (diffPast < minDiff) {
      minDiff = diffPast;
      nearestDate = pastDate;
    }

    // Check Future (Tie-breaker: Future wins? actually < vs <= doesn't matter much for equal distance, 
    // unless preference for future. e.g. Mon vs Fri (from Wed) -> 2 days each.
    // If strict <, Past wins (it was checked first). If <=, Future wins.
    // Let's check Future with strict <. If equal, Past remains. 
    // Wait, user said: "Terça (ontem) vs Sexta (futuro) -> Terça is closer". 
    // My math gives 1 day diff for Tue, 2 for Fri. So Tue wins.
    // What if Today=Wed(3), Sched=Mon(1) and Fri(5). 
    // Past: Mon (2 days ago). Future: Fri (2 days ahead).
    // Logic: diffPast=2, diffFuture=2.
    // If unique schedules, usually fine.
    const diffFuture = Math.abs(futureDate.getTime() - baseDate.getTime());
    if (diffFuture < minDiff) {
      minDiff = diffFuture;
      nearestDate = futureDate;
    }
  });

  const y = nearestDate.getFullYear();
  const m = String(nearestDate.getMonth() + 1).padStart(2, '0');
  const d = String(nearestDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};