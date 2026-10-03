'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from './ui';

export const NAV_ITEMS = [
  { href: '/', label: 'Resumen' },
  { href: '/discrepancias', label: 'Discrepancias' },
  { href: '/modelos', label: 'Modelos' },
  { href: '/categorias', label: 'Categorías' },
  { href: '/configuracion', label: 'Configuración' },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal">
      <ul className="flex flex-wrap gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-2 text-sm font-medium',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground hover:bg-surface-muted',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
