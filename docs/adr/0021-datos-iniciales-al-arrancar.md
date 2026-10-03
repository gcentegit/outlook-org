# 0021. Datos iniciales aplicados en cada arranque del worker

- **Estado:** aceptada

## Contexto

Un primer despliegue debe dejar el panel accesible y las reglas cargadas sin ejecutar nada a mano.
Código: `packages/db/src/seed.ts`, que usan tanto el worker al arrancar como `pnpm db:seed`.

## Decisión

- Tras aplicar las migraciones, el worker aplica de forma **idempotente y sin sobrescribir** las 14
  reglas fuertes (CIF y razón social de las siete sociedades), el administrador inicial y el
  modelo de LLM por defecto. Solo inserta lo que falta: una regla desactivada sigue desactivada.
- El **administrador solo se da de alta si no hay ningún usuario autorizado** y `ADMIN_EMAIL` tiene
  valor. Si falta en ese caso, el worker lo registra en el log, arranca igualmente y no crea
  ninguno. Si alguien lo quita más adelante, no reaparece en cada arranque.
- El modelo por defecto solo se crea si `LlmSetting` está vacía.
- `ADMIN_EMAIL` no tiene valor por defecto en ningún sitio.
- No se añadió un aviso «sin reglas activas» a `/health`: con la semilla automática deja de ser un
  caso normal.

## Consecuencias

- Las reglas por defecto salen de la [tabla de sociedades](../referencia/sociedades-categorias.md);
  una prueba comprueba que coinciden.
- Cambiar una regla por defecto en el código no actualiza las ya existentes.
