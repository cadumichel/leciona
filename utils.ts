import { BRAZIL_HOLIDAYS } from './constants';
import { AcademicCalendar, Term, DayOfWeek } from './types';

export const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

// Helper seguro para pegar o dia da semana de uma string YYYY-MM-DD
// Adiciona T12:00:00 para garantir que o fuso horário não mude o dia (Ex: GMT-3)
export const getDayOfWeekFromDate = (dateStr: string): DayOfWeek => {
  if (!dateStr) return 0;
  // Se já vier com T... (ISO), usa como está, senão adiciona meio-dia
  const safeDateStr = dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`;
  const date = new Date(safeDateStr);
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
  const date = new Date(dateStr + 'T00:00:00').getTime();
  const termIdx = calendar.terms.findIndex(t => {
    if (!t.start || !t.end) return false;
    const s = new Date(t.start + 'T00:00:00').getTime();
    const e = new Date(t.end + 'T00:00:00').getTime();
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
  const date = new Date(dateStr + 'T12:00:00');
  const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  return days[date.getDay()];
};

// Formata para o quadrado: 12/02 (embaixo)
export const getDayMonth = (dateStr: string): string => {
  const date = new Date(dateStr + 'T12:00:00');
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
  URL.revokeObjectURL(url);
};