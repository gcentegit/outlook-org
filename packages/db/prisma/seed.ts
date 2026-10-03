import { createPrismaClient } from '../src/client';
import { applySeed } from '../src/seed';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL no está definida');

const db = createPrismaClient(url);

applySeed(db, { adminEmail: process.env.ADMIN_EMAIL })
  .then(async (result) => {
    const [rules, cifs] = await Promise.all([
      db.rule.count(),
      db.rule.count({ where: { type: 'cif' } }),
    ]);
    console.log(
      `Semilla aplicada: ${rules} reglas (${cifs} de CIF), ${result.rulesCreated} nueva(s)` +
        `${result.adminCreated ? '; administrador inicial dado de alta' : ''}` +
        `${result.adminMissing ? '; sin administrador: define ADMIN_EMAIL' : ''}` +
        `${result.llmCreated ? '; modelo por defecto creado' : ''}.`,
    );
  })
  .catch((err: unknown) => {
    console.error('Error en la semilla:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
