import React from 'react';
import { Cloud, Check, RefreshCw } from 'lucide-react';

interface SyncStatusProps {
    isSaving: boolean;
    lastSyncedAt: Date | string | null;
}

const SyncStatus: React.FC<SyncStatusProps> = ({ isSaving, lastSyncedAt }) => {
    const formatTime = (date: Date | string | null) => {
        if (!date) return '';
        const dateObj = typeof date === 'string' && date.includes(':')
            ? new Date(`${new Date().toISOString().split('T')[0]}T${date}`) // Hack para string de hora
            : new Date(date);

        if (isNaN(dateObj.getTime())) {
            // Fallback se falhar parsing, tenta extrair HH:mm da string
            if (typeof date === 'string') return date.substring(0, 5) + 'h';
            return '';
        }

        return dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + 'h';
    };

    return (
        <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/50 px-1.5 py-0.5 rounded-md border border-slate-100 dark:border-slate-800 transition-colors">
            {isSaving ? (
                <>
                    <span className="text-[9px] md:text-[10px] font-bold text-amber-500 whitespace-nowrap">
                        Pendente...
                    </span>
                    <RefreshCw size={10} className="text-amber-500 animate-spin" />
                </>
            ) : (
                <>
                    <span className="text-[9px] md:text-[10px] font-bold text-slate-400 dark:text-slate-500 whitespace-nowrap">
                        {lastSyncedAt ? `Salvo ${formatTime(lastSyncedAt)}` : 'Salvo'}
                    </span>
                    <div className="relative flex items-center justify-center w-3.5 h-3.5 text-green-500/80">
                        {/* 1. Base: Nuvem */}
                        <Cloud className="w-full h-full" strokeWidth={2.5} />
                        {/* 2. Sobreposição: Check centralizado */}
                        <Check size={8} strokeWidth={4} className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-[40%]" />
                    </div>
                </>
            )}
        </div>
    );
};

export default SyncStatus;
