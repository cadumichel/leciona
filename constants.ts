
import { DayOfWeek } from './types';

export const DAYS_OF_WEEK_NAMES: Record<DayOfWeek, string> = {
  0: 'Domingo',
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado'
};

export const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', 
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'
];

export const BRAZIL_HOLIDAYS: Record<string, string> = {
  '01-01': 'Ano Novo',
  '04-21': 'Tiradentes',
  '05-01': 'Trabalhador',
  '09-07': 'Independência',
  '10-12': 'Aparecida',
  '11-02': 'Finados',
  '11-15': 'Proclamação',
  '11-20': 'Consciência',
  '12-25': 'Natal',
};
