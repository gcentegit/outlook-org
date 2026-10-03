# 0020. Copias de seguridad comprobadas

- **Estado:** aceptada (la programación de la prueba mensual está pendiente)

## Contexto

PostgreSQL guarda decisiones, correcciones, reglas y la cola de trabajos. Una copia que nunca se
ha restaurado no es una copia. Cómo operarlo: [copias y restauración](../operacion/copias-y-restauracion.md).

## Decisión

- **Copia diaria de la base de datos** hecha por Dokploy al destino S3 compatible que ya existe en
  el servidor, con 7 copias.
- **Prueba de restauración** con [`infra/scripts/restore-check.sh`](../../infra/scripts/restore-check.sh):
  restaura la última copia en un `postgres:16-alpine` temporal de nombre único y exige filas en
  `Message`, `Decision` y `Rule` y todas las migraciones del repositorio aplicadas y terminadas.
  Detecta solo el formato (custom o SQL, con o sin gzip), porque Dokploy llama `.sql.gz` a copias
  que pueden ser formato custom comprimido. Una migración fallida que se resolvió y se volvió a
  aplicar no hace fallar la comprobación para siempre. La imagen de `minio/mc` va fijada por
  digest.
- La prueba se pretende mensual y en el mismo servidor de Dokploy, que tiene Docker.

## Consecuencias

- **Pendiente:** hoy el script no está programado en ningún cron ni workflow; hay que decidir
  dónde se ejecuta y con qué credenciales (tarea del plan).
- Antes de cualquier migración se toma una copia aparte.
