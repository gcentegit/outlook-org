---
title: "Phase 5: Clasificador: reglas + LLM configurable"
status: done
effort: 2d
---

# Phase 5: Clasificador: reglas + LLM configurable

## Estado

**Hecha en código**, probada con un modelo simulado. Se construyeron el esquema de la decisión, la
herencia del hilo, el motor de reglas, los proveedores de LLM (Anthropic, OpenRouter, compatible con
OpenAI y Google), las decisiones degradadas por fallo técnico y el evaluador (`apps/worker/scripts/evaluate.ts`).
Orden y motivos: [ADR 0002](../../docs/adr/0002-orden-de-decision-del-clasificador.md) y
[ADR 0003](../../docs/adr/0003-llm-configurable-y-privacidad.md).

**Validación con datos reales: movida a la fase 10.** El evaluador no se ha ejecutado con una
muestra real ni con claves de LLM; el criterio de precisión se mide contra la muestra revisada a mano
de la fase 9.

## Overview

Función `classify(email) → Decision` que decide FOOD BOX, LATERAL y ARCOBETA de forma
independiente (multietiqueta) y devuelve el JSON del brief. El LLM se elige en
tiempo de ejecución entre varios proveedores.

## Key Insights

- Cada categoría se decide por separado: sí, no o duda.
- Orden: reglas fuertes (CIF o razón social de la sociedad facturada, del propio
  correo) > herencia del hilo (`conversationId`) > reglas medias (palabras clave) >
  LLM > duda. Decisión del usuario del 2026-10-02: manda el CIF; la herencia usa
  las categorías finales del equipo (corrección o categorías vistas), nunca una
  decisión del sistema que el equipo corrigió.
- El pie de firma de un remitente interno (dominios del grupo) no dispara reglas
  fuertes: solo cuentan los adjuntos y el bloque reenviado.
- **AI SDK de Vercel** (`ai`) con `generateText` + `Output.object` y un esquema
  Zod: la misma llamada sirve para todos los proveedores
  (https://ai-sdk.dev). Proveedores:
  - `@ai-sdk/anthropic`: Claude Haiku (`claude-haiku-4-5-20251001`), opción por defecto.
  - `@openrouter/ai-sdk-provider`: modelos de pago y `:free` de OpenRouter.
  - `@ai-sdk/openai-compatible`: Ollama local y otras APIs gratuitas compatibles con OpenAI (Groq, Mistral…). Google Gemini con `@ai-sdk/google`.
- Proveedor y modelo activos en la tabla `LlmSetting`; el worker los lee en cada
  trabajo, así que el cambio desde el panel no requiere redesplegar.
- Al LLM se le envían el asunto, el cuerpo y la primera página de los adjuntos.

## Requirements

- Salida: `{ messageId, categories, source, ruleId, model, confidence, needsReview, reason, mode }`.
- Por debajo del umbral de confianza: sin categoría, `needsReview: true`.
- Solo categorías que existan en la lista maestra del buzón.
- Si el modelo devuelve algo que no cumple el esquema o falla, el correo queda como dudoso (nunca se inventa).
- Registro de tokens y coste estimado por decisión.
- Evaluador: precisión y cobertura por categoría y **por modelo** sobre el conjunto de prueba.

## Related Code Files

Crear: `apps/worker/src/classify/rules.ts`, `apps/worker/src/classify/thread.ts`,
`apps/worker/src/classify/llm.ts`, `apps/worker/src/classify/providers.ts`,
`apps/worker/src/classify/index.ts`, `packages/shared/src/decision-schema.ts`,
`apps/worker/scripts/evaluate.ts`, tests.

## Implementation Steps

1. Esquema Zod de la decisión en un paquete compartido (lo usa también el panel).
2. Herencia por hilo.
3. Motor de reglas leyendo de `Rule`: CIF (normalizado, con y sin `ES`), razón social, remitente/dominio, palabra clave.
4. Fábrica de proveedores a partir de `LlmSetting`; claves de API en variables de entorno, nunca en la base de datos.
5. Prompt con la descripción de las tres categorías y sus sociedades a partir de `docs/referencia/sociedades-categorias.md`.
6. `evaluate.ts`: matriz de confusión por categoría y por modelo, porcentaje que pasa por el LLM y coste.
7. Tests unitarios con casos anonimizados.

## Todo

- [x] Esquema y herencia por hilo
- [x] Motor de reglas
- [x] Proveedores LLM (Anthropic, OpenRouter, compatible OpenAI, Gemini), probados con modelo simulado
- [x] Evaluador (código y pruebas)
- [x] Tests
- [x] Correcciones de la revisión: CIF por delante del hilo, herencia con categorías finales del equipo, firma interna sin regla fuerte, decisiones degradadas por fallo técnico del LLM

## Movido a otras fases

- Ejecutar el evaluador con la muestra revisada a mano y con claves de LLM, con y sin LLM: fase 10.
- Informe comparativo de al menos dos modelos: fase 10.
- Tope de gasto diario del LLM (no existe hoy): fase 10.

## Success Criteria

Se medirán en la fase 10: precisión ≥ 95 % por categoría con el modelo por defecto contra la
muestra revisada a mano, más la cobertura mínima que se fije en la fase 9, e informe comparativo de
al menos dos modelos.

## Risk Assessment

- Modelos `:free` de OpenRouter: 50 peticiones al día (1.000 con 10 $ de crédito) y no aptos para producción. Si se agota el cupo, el correo queda como dudoso.
- Ollama en 4 CPU arm64: solo modelos pequeños (3-4B) y lentos; medir latencia y acierto antes de usarlo.
- Las siete sociedades comparten dirección fiscal: la dirección fiscal no sirve como señal; sí el CIF y la razón social.
- El CIF del proveedor también aparece en la factura: solo cuentan los CIF de las siete sociedades del grupo, que son una lista cerrada.

## Security Considerations

- Se clasifican todos los correos, internos y externos, con el mismo flujo. En los reenvíos internos manda el CIF del PDF, no el remitente.
- Anthropic: DPA incluido en los Commercial Terms de la API (cuenta de Console de empresa).
- OpenRouter: activar en la cuenta "no permitir proveedores que entrenen con los datos" y, si es posible, retención cero de datos (ZDR), también para modelos gratuitos. El panel avisa si el proveedor elegido no lo garantiza.
- Otras APIs gratuitas: revisar su política de datos antes de habilitarlas; muchas usan los datos de la capa gratuita para entrenar.
