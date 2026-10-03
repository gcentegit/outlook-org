# Registros de decisión (ADR)

Cada fichero recoge una decisión relevante: el contexto, lo que se decidió y sus consecuencias. Están
agrupados por **tema** y describen el estado **actual** de la decisión, no su historia: si una
decisión cambia, se edita su registro (o se crea otro que lo sustituya y se marca el anterior).
Cómo funciona hoy el sistema, en conjunto, está en [../arquitectura.md](../arquitectura.md).

## Formato

Título con número, `Estado` (aceptada, sustituida por NNNN, o aceptada con una nota de lo pendiente),
`Contexto`, `Decisión` y `Consecuencias`. Breve y siempre igual. Nombre de fichero:
`NNNN-titulo-en-kebab.md`, con el siguiente número libre.

## Cuándo escribir uno

Cuando la decisión cuesta cambiarla, descarta alternativas razonables, fija una regla de negocio o
añade una advertencia que el código no puede expresar. Lo que el código ya dice (campos, rutas,
valores por defecto) no va aquí: se enlaza al fichero que lo define.

## Índice

| N.º | Tema |
| --- | --- |
| [0001](0001-alcance-y-categorias.md) | Alcance: tres categorías y respeto a las de las personas |
| [0002](0002-orden-de-decision-del-clasificador.md) | Orden de decisión del clasificador (CIF, hilo, reglas, LLM) |
| [0003](0003-llm-configurable-y-privacidad.md) | LLM configurable y con garantías de privacidad |
| [0004](0004-modo-sombra-y-activacion-por-categoria.md) | Modo sombra obligatorio y activación por categoría |
| [0005](0005-sincronizacion-delta-e-instancia-unica.md) | Sincronización con delta query y una sola instancia |
| [0006](0006-cola-de-trabajos-con-pg-boss.md) | Cola de trabajos con pg-boss sobre PostgreSQL |
| [0007](0007-fallos-tecnicos-y-reproceso.md) | Fallos técnicos frente a decisiones válidas, y reproceso |
| [0008](0008-correcciones-y-metrica-de-acierto.md) | Correcciones del equipo y métrica de acierto |
| [0009](0009-modelo-de-datos.md) | Modelo de datos |
| [0010](0010-retencion-y-datos-de-terceros.md) | Retención de datos y datos de terceros |
| [0011](0011-candidatas-de-reglas-del-historico.md) | Reglas candidatas a partir del histórico |
| [0012](0012-adjuntos-y-extraccion.md) | Extracción de adjuntos con docling y límites conocidos |
| [0013](0013-acceso-al-buzon-con-certificado-y-rbac.md) | Acceso al buzón con certificado y RBAC de Exchange |
| [0014](0014-panel-sesion-y-acceso.md) | Panel: sesión sin estado y acceso por lista de usuarios |
| [0015](0015-web-sin-credenciales-del-buzon.md) | La web no tiene credenciales del buzón |
| [0016](0016-prisma-7-y-monorepo.md) | Prisma 7 con adaptador `pg` y monorepo pnpm |
| [0017](0017-imagenes-y-comprobaciones-de-salud.md) | Imágenes, comprobaciones de salud y puertos |
| [0018](0018-despliegue-en-dokploy.md) | Despliegue en Dokploy y advertencias |
| [0019](0019-publicacion-y-vuelta-atras.md) | Publicación de imágenes por commit y vuelta atrás |
| [0020](0020-copias-de-seguridad-y-restauracion.md) | Copias de seguridad comprobadas |
| [0021](0021-datos-iniciales-al-arrancar.md) | Datos iniciales aplicados en cada arranque |
| [0022](0022-repositorio-publico-y-direcciones-reales.md) | Repositorio público: sin direcciones reales ni datos de terceros |
