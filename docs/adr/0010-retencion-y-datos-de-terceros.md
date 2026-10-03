# 0010. Retención de datos y datos de terceros

- **Estado:** aceptada (el plazo de remitentes, asuntos y decisiones está pendiente de decidir)

## Contexto

Los correos de proveedores y sus facturas contienen datos de terceros (direcciones, nombres,
importes). El repositorio es público y el RGPD aplica.

## Decisión

- **El texto extraído de adjuntos se conserva 90 días** (`AttachmentText.expiresAt`); un trabajo
  diario lo borra ([0006](0006-cola-de-trabajos-con-pg-boss.md)). Los **remitentes, asuntos y
  decisiones se conservan 12 meses** (decisión del 2026-10-03): es el periodo que el panel puede
  mostrar y basta para auditar una decisión y medir el acierto; los correos originales siguen en
  Outlook.
- El texto pegado en el botón Probar del panel viaja en los datos del trabajo de pg-boss: el panel
  lo borra en cuanto lee el resultado y la cola lo elimina a los 5 minutos como máximo
  (`deleteAfterSeconds`). No se guarda en ninguna otra tabla.
- **Nada de datos de terceros en git:** `data/` (informes del histórico y de la prueba de
  extracción, que incluyen direcciones y nombres de ficheros), `secrets/` y `docs/privado/` están
  ignorados; `.dockerignore` excluye `data`, `secrets`, `.claude` y `.agentkit`. Los informes
  de importación y de reglas candidatas van a `data/history/`, no a `plans/reports/`.
- Las direcciones reales solo existen en variables de entorno ([0022](0022-repositorio-publico-y-direcciones-reales.md)).

## Consecuencias

- **Pendiente:** el borrado a los 12 meses todavía no está implementado (es una tarea del plan):
  hoy remitentes, asuntos y decisiones se guardan sin límite. El plazo debe anotarse en el registro
  de actividades de tratamiento de la empresa.
- El panel muestra extractos de facturas: solo a usuarios autorizados
  ([0014](0014-panel-sesion-y-acceso.md)).
- No hay que pegar en Probar datos que no deban salir hacia el proveedor de LLM elegido.
