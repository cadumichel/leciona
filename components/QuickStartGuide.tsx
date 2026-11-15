import React from 'react';
import { Lightbulb, X } from 'lucide-react';

/** Faixa "Vamos começar?" do Início e de Ajustes (antes ficava em App.tsx). */
export const QuickStartGuide: React.FC<{ onDismiss: () => void; onNavigate: (tab: string) => void }> = ({ onDismiss, onNavigate }) => (
  <div className="bg-primary text-white p-4 md:p-6 rounded-[24px] md:rounded-[32px] shadow-xl shadow-primary/20 mb-4 relative overflow-hidden animate-in fade-in zoom-in-95 duration-500">
    <div className="absolute top-0 right-0 p-6 opacity-10 pointer-events-none">
      <Lightbulb size={60} className="md:w-[90px] md:h-[90px]" />
    </div>
    <button onClick={onDismiss} className="absolute top-3 right-3 p-1.5 hover:bg-white/20 rounded-full transition-colors z-20">
      <X size={16} />
    </button>
    <div className="relative z-10">
      <span className="text-[8px] md:text-[9px] font-black uppercase tracking-[0.2em] opacity-80">Bem-Vindo</span>
      <h2 className="text-lg md:text-xl font-black mt-0.5 mb-1.5 tracking-tight">Vamos começar?</h2>
      <p className="text-[10px] md:text-xs font-medium opacity-90 max-w-3xl leading-relaxed">
        Para começar a usar o leciona cadastre seu perfil e as informações sobre as instituições em que trabalha. Para iniciar é necessário que pelo menos uma escola, um ano letivo e um horário de aula estejam cadastrados.
      </p>
    </div>
  </div>
);
