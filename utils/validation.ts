import { useState } from 'react';

export const LIMITS = {
    MAX_TEXT_LENGTH: 5000,
    MAX_SUBJECT_LENGTH: 500,
    MAX_NAME_LENGTH: 100,
    MAX_HOMEWORK_LENGTH: 2000,
    MIN_YEAR: 2000,
    MAX_YEAR: 2100,
} as const;

/**
 * Valida e sanitiza texto do usuário
 */
export const sanitizeText = (text: string, maxLength: number = LIMITS.MAX_TEXT_LENGTH): string => {
    if (!text) return '';
    return text
        .trim()
        .slice(0, maxLength)
        .replace(/[<>]/g, ''); // Remove < e > para prevenir XSS
};

/**
 * Valida formato de data YYYY-MM-DD
 */
export const isValidDate = (dateStr: string): boolean => {
    if (!dateStr || typeof dateStr !== 'string') return false;

    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateStr)) return false;

    const [year, month, day] = dateStr.split('-').map(Number);

    // Verifica limites básicos
    if (year < LIMITS.MIN_YEAR || year > LIMITS.MAX_YEAR) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    // Verifica se a data é real (ex: 30 de fevereiro é inválida)
    const date = new Date(year, month - 1, day);
    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
    );
};

/**
 * Valida formato de horário HH:MM
 */
export const isValidTime = (time: string): boolean => {
    if (!time || typeof time !== 'string') return false;

    const regex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!regex.test(time)) return false;

    const [hours, minutes] = time.split(':').map(Number);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

/**
 * Valida email
 */
export const isValidEmail = (email: string): boolean => {
    if (!email) return false;
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
};

/**
 * Protege contra race conditions em operações async
 */
export const useAsyncLock = () => {
    const [isLocked, setIsLocked] = useState(false);

    const runWithLock = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
        if (isLocked) {
            console.warn('Operação já em andamento. Ignorando...');
            return null;
        }

        setIsLocked(true);
        try {
            return await fn();
        } finally {
            setIsLocked(false);
        }
    };

    return { isLocked, runWithLock };
};
