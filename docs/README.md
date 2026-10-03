# Documentación

Índice de la documentación vigente. El código es la fuente de lo que hace el sistema; estos documentos
explican el porqué y dónde mirar. Los planes y los informes de trabajo (`plans/`) son registros de
estado, no documentación vigente.

| Documento | De qué trata |
| --- | --- |
| [arquitectura.md](arquitectura.md) | Cómo funciona hoy: piezas, flujo de un correo, orden de decisión, datos guardados, modo sombra y límites conocidos. |
| [adr/README.md](adr/README.md) | Índice de los registros de decisión: una decisión por fichero, agrupadas por tema. |
| [guias/entra-id-rbac.md](guias/entra-id-rbac.md) | Guía paso a paso para dar acceso a la app en Microsoft 365, limitado al buzón de Proveedores. |
| [referencia/sociedades-categorias.md](referencia/sociedades-categorias.md) | Las siete sociedades, sus CIF y la categoría que corresponde a cada una. |
| [operacion/despliegue.md](operacion/despliegue.md) | Resumen operativo del despliegue en Dokploy y sus advertencias. |
| [operacion/copias-y-restauracion.md](operacion/copias-y-restauracion.md) | Copias de seguridad de PostgreSQL y prueba de restauración. |
| [operacion/credenciales-y-caducidades.md](operacion/credenciales-y-caducidades.md) | Qué credenciales caducan, cuándo y cómo se renuevan. |
| [operacion/versiones-y-releases.md](operacion/versiones-y-releases.md) | Versionado con SemVer y flujo de releases. |

Fuera de `docs/`: [README.md](../README.md) (qué es y cómo arrancarlo), [CLAUDE.md](../CLAUDE.md)
(reglas del proyecto para agentes y personas), [infra/dokploy/README.md](../infra/dokploy/README.md)
(alta de servicios en Dokploy) y el [plan](../plans/261001-2123-clasificador-foodbox-lateral/plan.md).

`docs/privado/` existe solo en local y está fuera de git: guarda documentos internos con datos de
terceros.
