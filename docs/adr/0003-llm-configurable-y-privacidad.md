# 0003. LLM configurable y con garantías de privacidad

- **Estado:** aceptada

## Contexto

Las reglas no resuelven todos los correos. El modelo de lenguaje debe poder cambiarse sin
redesplegar y no debe usar los datos de la empresa para entrenar (RGPD).

## Decisión

- Proveedor y modelo activos viven en la tabla `LlmSetting`; el worker los lee en **cada trabajo**,
  así que cambiarlos desde el panel no requiere redesplegar. Por defecto, Anthropic con Claude
  Haiku 4.5.
- Una sola llamada para todos los proveedores con el AI SDK de Vercel (`generateText` con salida
  estructurada validada con Zod). Proveedores: Anthropic, OpenRouter, compatibles con OpenAI
  (Ollama y otros) y Google.
- Solo proveedores que no entrenen con los datos. El panel avisa si el elegido no lo garantiza.
- Las **claves de API van en variables de entorno**, nunca en la base de datos ni en el panel.
- Al LLM se le envían el asunto, el cuerpo y el texto de las primeras páginas de los adjuntos, con
  un tope de caracteres. Si responde algo fuera de esquema o falla, la categoría queda en duda:
  nunca se inventa.
- El botón **Probar** del panel clasifica un correo con un proveedor y modelo concretos sin tocar
  `LlmSetting` ([0015](0015-web-sin-credenciales-del-buzon.md)). El correo va directo al LLM, sin
  reglas ni herencia: con reglas, un CIF conocido nunca llegaría al modelo.
- Solo puede haber un `LlmSetting` activo. Lo garantiza la aplicación al cambiarlo (transacción con
  bloqueo asesor de PostgreSQL), no un índice parcial, porque Prisma no gestiona índices
  parciales y la migración quedaría fuera de su control.

## Consecuencias

- Los modelos gratuitos de OpenRouter tienen cupo diario y no son aptos para producción.
- Se registran tokens, coste estimado y latencia por decisión. Hoy no hay tope de gasto diario
  (tarea pendiente en el plan).
- Una clave que falta no rompe el servicio: el LLM queda «no disponible» y la decisión se guarda
  degradada ([0007](0007-fallos-tecnicos-y-reproceso.md)).
