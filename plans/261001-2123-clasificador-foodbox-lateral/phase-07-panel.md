---
title: "Phase 7: Panel de métricas y configuración"
status: in-progress
effort: 2.5d
---

# Phase 7: Panel de métricas y configuración

## Overview

Aplicación Next.js (`apps/web`) en `https://clasificador.arcofood.com`, con login
por SSO de Microsoft y una lista de usuarios autorizados. Muestra cómo está
funcionando la clasificación y permite elegir el proveedor y el modelo de LLM.

## Key Insights

- Las métricas salen de las tablas `Message`, `Decision` y `Correction`.
- **Acierto**: se compara la decisión del sistema con las categorías finales
  que deja el equipo (detectadas por la delta query como `updated`). En modo
  sombra es la medida que decide la activación.
- El login necesita una segunda app de Entra ID (delegada, solo `openid`,
  `profile` y `email`), separada de la app del buzón para no mezclar permisos.

## Requirements

**Métricas** (filtro por rango de fechas y categoría):
- Correos leídos, clasificados, sin clasificar (dudosos) y porcentaje de cobertura.
- Precisión y cobertura por categoría frente al equipo; lista de discrepancias.
- Origen de la decisión: hilo, regla o LLM.
- Por modelo: correos decididos, acierto, coste y latencia.
- Estado del servicio: última sincronización, cola pendiente, errores.

**Configuración:**
- Selector de proveedor y modelo (Anthropic, OpenRouter, compatible OpenAI/Ollama, Gemini) con aviso de privacidad para proveedores que no garantizan no entrenar con los datos.
- Botón "probar" que clasifica un correo de ejemplo con el modelo elegido antes de activarlo.
- Interruptor de modo sombra/live por categoría.
- **Categorías del buzón:** lista de la lista maestra de `<MAILBOX>` con su color; aviso si falta alguna que use el clasificador (por ejemplo ARCOBETA); formulario para crear una categoría (nombre y color `preset0`-`preset24`) con confirmación, que llama a `POST /users/<MAILBOX>/outlook/masterCategories`. Sin renombrar ni borrar: los correos guardan la categoría como texto y esos cambios dejarían etiquetas huérfanas.
- Gestión de la lista de usuarios autorizados. Al principio solo `<ADMIN_EMAIL>`.

## Related Code Files

Crear: `apps/web/` (páginas de métricas, discrepancias y configuración), auth
con better-auth y el proveedor Microsoft (patrón de CPA), configuración de
dominio en Dokploy.

## Implementation Steps

1. Registrar la app de login en Entra ID con la URL de retorno `https://clasificador.arcofood.com/api/auth/callback/microsoft`.
2. better-auth con Microsoft y comprobación contra `AllowedUser`.
3. Consultas de métricas en `packages/db`.
4. Páginas: resumen, discrepancias, modelos, categorías, configuración. Leer y crear categorías lo hace el worker (con el certificado de la app del buzón) a petición del panel por la cola de trabajos: el panel no tiene credenciales de Graph.
5. Registro DNS `A` de `clasificador.arcofood.com` a la IP pública del servidor; dominio y HTTPS en Dokploy (Traefik + Let's Encrypt).

## Todo

- [ ] App de login en Entra ID
- [x] Autenticación y lista de usuarios (probado con Entra ID simulado)
- [x] Métricas
- [x] Selector de modelo y botón Probar (cola `test-classify` atendida por el worker; probado con el modelo simulado y con proveedor no disponible)
- [x] Interruptores sombra/live (tabla `CategorySetting` migrada; el worker solo los expone, la activación real es la fase 8)
- [x] Pantalla de categorías: ver, avisar de las que faltan y crear, a través del worker (probado con Graph simulado en el worker y sin credenciales: muestra el motivo)
- [x] Correcciones de la revisión: comprobación de acceso en cada página, acceso atado a `oid` y `tid`, métrica de acierto solo sobre correos revisados, botón de reprocesar, cabeceras anti-clickjacking
- [ ] Despliegue en el subdominio

## Success Criteria

Un usuario autorizado entra con su cuenta de Microsoft y uno no autorizado no
puede; las métricas coinciden con una consulta manual a la base de datos; un
cambio de modelo se refleja en la siguiente decisión del worker.

## Security Considerations

- Panel expuesto a Internet: solo SSO y lista de usuarios; sin endpoints públicos sin sesión.
- Las claves de API de los proveedores no se muestran ni se editan desde el panel; viven en variables de entorno de Dokploy.
- El panel muestra extractos de facturas: solo a usuarios autorizados.
- Crear una categoría afecta a todo el equipo de Proveedores: se pide confirmación y se registra quién la creó y cuándo.
