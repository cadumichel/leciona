import React, { useState, useCallback, createContext, useContext } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: number;
    type: ToastType;
    message: string;
}

interface ToastContextType {
    showSuccess: (message: string) => void;
    showError: (message: string) => void;
    showWarning: (message: string) => void;
    showInfo: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((type: ToastType, message: string) => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, type, message }]);

        // Auto-remover após 5 segundos
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 5000);
    }, []);

    const removeToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const contextValue = {
        showSuccess: (msg: string) => addToast('success', msg),
        showError: (msg: string) => addToast('error', msg),
        showWarning: (msg: string) => addToast('warning', msg),
        showInfo: (msg: string) => addToast('info', msg),
    };

    return (
        <ToastContext.Provider value={contextValue}>
            {children}

            {/* Container de Toasts */}
            <div className="fixed top-4 right-4 z-[9999] space-y-2">
                {toasts.map(toast => (
                    <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
                ))}
            </div>
        </ToastContext.Provider>
    );
};

const ToastItem: React.FC<{ toast: Toast; onClose: () => void }> = ({ toast, onClose }) => {
    const config = {
        success: { bg: 'bg-green-500', icon: CheckCircle2 },
        error: { bg: 'bg-red-500', icon: AlertCircle },
        warning: { bg: 'bg-amber-500', icon: AlertCircle },
        info: { bg: 'bg-blue-500', icon: AlertCircle },
    };

    const { bg, icon: Icon } = config[toast.type];

    return (
        <div className={`${bg} text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 min-w-[300px] max-w-md animate-in slide-in-from-right-full`}>
            <Icon size={20} />
            <p className="flex-1 text-sm font-bold">{toast.message}</p>
            <button onClick={onClose} className="hover:bg-white/20 rounded p-1 transition-colors">
                <X size={16} />
            </button>
        </div>
    );
};

// Hook para usar em componentes
export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) throw new Error('useToast must be used within ToastProvider');
    return context;
};
