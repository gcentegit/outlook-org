'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { buttonClass, cn } from './ui';

/** Alterna claro/oscuro y recuerda la elección en el navegador. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('tema', next ? 'oscuro' : 'claro');
    } catch {
      // Sin almacenamiento (modo privado): el cambio vale solo para esta visita.
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(buttonClass.secondary, 'px-2.5')}
      aria-label={dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
    >
      {dark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
    </button>
  );
}
