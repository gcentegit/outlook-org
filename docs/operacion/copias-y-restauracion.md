# Copias de seguridad y restauración

Estado: configuradas en el script de alta pero **todavía sin servicio desplegado**, así que no existe
ninguna copia real. Motivos y decisiones: [ADR 0020](../adr/0020-copias-de-seguridad-y-restauracion.md).

## Qué se copia

La base de datos PostgreSQL (`clasificador-db`): mensajes, decisiones, correcciones, reglas,
ajustes, usuarios autorizados y la cola de trabajos. Dokploy hace la copia diaria al destino S3
compatible que ya existe en el servidor, con 7 copias; `provision.ts` la configura. No hay otros
datos que copiar: el texto de adjuntos se vuelve a generar y los secretos no están en la base de
datos.

## Comprobar que se puede restaurar

[`infra/scripts/restore-check.sh`](../../infra/scripts/restore-check.sh) baja la última copia, la
restaura en un PostgreSQL temporal, comprueba que hay datos y que las migraciones están completas, y
borra el contenedor. Las variables que necesita y el ejemplo de uso están en la sección «Copias de
seguridad» de [infra/dokploy/README.md](../../infra/dokploy/README.md#copias-de-seguridad). Con
`--from-file <volcado>` prueba un volcado local, útil tras tomar una copia manual.

Hoy la prueba **no está programada** en ningún cron ni workflow: hay que decidir dónde se ejecuta
cada mes (necesita Docker y las credenciales del almacenamiento). Está en el plan.

## Antes de una migración

Toma una copia manual (desde Dokploy o con `pg_dump`) y compruébala con
`restore-check.sh --from-file`. Es una regla del proyecto: ninguna migración sin copia previa.

## Restaurar sobre producción

No hay un procedimiento escrito ni ensayado para restaurar sobre el servicio real (el script solo
restaura en un contenedor temporal). Escribirlo y ensayarlo es una tarea del plan antes de
considerar el despliegue como operativo.
