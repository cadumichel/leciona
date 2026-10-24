import React from 'react';

/** Chave liga/desliga (padrão de Ajustes). Recebe as mesmas props de um checkbox. */
const Toggle: React.FC<Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>> = props => (
  <span className="relative inline-flex shrink-0 items-center cursor-pointer">
    <input type="checkbox" {...props} className="sr-only peer" />
    <span className="w-11 h-6 rounded-full bg-slate-200 dark:bg-slate-700 transition-colors peer-checked:bg-[var(--primary-color)] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-all peer-checked:after:translate-x-5" />
  </span>
);

export default Toggle;
