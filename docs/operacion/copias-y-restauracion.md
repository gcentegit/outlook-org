# Copias de seguridad y restauración

Estado: **activas**. Dokploy hace la copia diaria y la prueba de restauración se ejecuta cada mes. Motivos y decisiones: [ADR 0020](../adr/0020-copias-de-seguridad-y-restauracion.md).

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

La prueba se ejecuta **el día 1 de cada mes a las 5:00** en la máquina de desarrollo, que tiene Docker
y el repositorio. Es un temporizador de systemd del usuario (`clasificador-restore-check.timer`,
fuera del repositorio) que lanza el script con las variables de `secrets/restore-check.env`. Para
verlo y ejecutarlo a mano:

```bash
systemctl --user list-timers clasificador-restore-check.timer
systemctl --user start clasificador-restore-check.service
journalctl --user -u clasificador-restore-check.service -n 30
```

Si esa máquina está apagada el día 1, la prueba se hace al encenderla (`Persistent=true`). Con
`KUMA_PUSH_URL` en el fichero de variables, el resultado llega también a Uptime Kuma.

## Antes de una migración

Toma una copia manual (desde Dokploy o con `pg_dump`) y compruébala con
`restore-check.sh --from-file`. Es una regla del proyecto: ninguna migración sin copia previa.

## Antes de activar el borrado a los 12 meses

La limpieza diaria del worker borra los correos con más de 12 meses (remitente, asunto, decisiones,
correcciones y categorías aplicadas; el plazo está en [ADR 0010](../adr/0010-retencion-y-datos-de-terceros.md)).
El borrado **no se puede deshacer** salvo restaurando una copia, y viene desactivado
(`RETENTION_DELETE_ENABLED=false`): mientras tanto el registro dice cada noche cuántos correos
«se borrarían». Para activarlo la primera vez:

1. Toma una copia manual de `clasificador-db` y compruébala con `restore-check.sh --from-file`.
2. Revisa en el registro del worker que la cifra de «se borrarían» es la esperada.
3. Pon `RETENTION_DELETE_ENABLED=true` en el worker y reinícialo; la siguiente limpieza borra.

El histórico importado no está en la base de datos: vive en `data/history/`, fuera del control de
versiones y de este borrado.

## Restaurar sobre producción

La API de Dokploy no permite restaurar: se hace desde su interfaz.

1. **Copia del estado actual:** en `clasificador-db`, pestaña **Backups**, ejecuta la copia a mano.
   Si la restauración sale mal, se vuelve a este punto.
2. **Para el worker y el panel** (botón **Stop** en `clasificador-worker` y `clasificador-web`), para
   que nada escriba durante la restauración.
3. En `clasificador-db`, pestaña **Backups**, pulsa **Restore Backup**. Elige el destino de copias,
   busca el fichero dentro de `<appName de clasificador-db>/clasificador/` y pon `clasificador`
   como base de datos. Espera a que el registro diga «Restore completed successfully!».
4. **Arranca primero el worker.** Si la copia es anterior al código, aplica las migraciones que
   falten al arrancar. Comprueba en sus registros que migra y sincroniza.
5. **Arranca el panel** y comprueba que `/api/health` responde y que el estado del servicio está
   «Al día».

Los correos que llegaron entre la copia y la restauración no se pierden. La base restaurada guarda el
punto de sincronización de la copia, así que el worker vuelve a pedir a Graph los cambios desde ahí.
Si ese punto ha caducado, empieza de nuevo desde el correo registrado más antiguo, y vuelve a
procesar los que no conozca.

**Ensayo:** se hizo sobre una base temporal vacía, nunca sobre la real. Allí la copia se restauró
completa y pasó `restore-check.sh`. Queda sin comprobar cómo trata Dokploy una base que ya tiene
tablas. Si el registro muestra errores de objetos que ya existen, no arranques el worker: vuelve a
la copia del paso 1 y revisa el caso antes de seguir.
