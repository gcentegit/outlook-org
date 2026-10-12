# Cómo revisa los correos el clasificador

Explicación paso a paso para el equipo de Proveedores. El clasificador lee cada correo nuevo de la
Bandeja de entrada del buzón de Proveedores, extrae el texto de sus adjuntos y propone FOOD BOX,
LATERAL o ARCOBETA. Hoy funciona en **modo sombra**: no toca ningún correo, solo anota lo que habría
etiquetado. El detalle técnico está en [arquitectura.md](../arquitectura.md).

Los valores entre paréntesis (cada cuánto sincroniza, cuántas páginas lee, el tamaño máximo) son los
de por defecto y se pueden cambiar en la configuración del worker
([`apps/worker/src/config.ts`](../../apps/worker/src/config.ts)).

## Paso 1. Detectar el correo

Cada 90 segundos (por defecto) el clasificador pregunta a Microsoft 365 qué ha cambiado en la
**Bandeja de entrada** del buzón de Proveedores.

- Un correo nuevo se apunta como pendiente y se pone en cola para leerlo.
- Si alguien del equipo cambia las categorías de un correo ya leído, se anota como corrección. Así se
  compara lo que propuso el clasificador con lo que dejó el equipo.
- Solo mira la Bandeja de entrada. Un correo que se mueve a una carpeta antes de que el clasificador
  lo vea no se procesa. Normalmente pasan horas o días, así que no es un problema.

## Paso 2. Leer el correo y sus adjuntos (cuándo hay OCR)

El OCR (leer el texto de una imagen) solo se usa cuando el documento no trae texto propio: un PDF
escaneado, una foto o una imagen. En las pruebas con correos reales se usó en 2 de 185 adjuntos
([medición](../../plans/reports/validacion-261012-1530-velocidad-extraccion.md)).

1. Del correo se leen el remitente, el asunto y el cuerpo.
2. De los adjuntos solo cuentan los ficheros adjuntos de verdad. Las imágenes incrustadas en el
   cuerpo (logos, firmas) se saltan.
3. Si el mismo fichero ya se leyó en los últimos 90 días (por ejemplo, una factura reenviada), se
   reutiliza su texto y no se vuelve a leer.
4. Cada adjunto se lee con docling según su tipo:

| Tipo de adjunto | Cómo se lee | ¿OCR? |
| --- | --- | --- |
| PDF con texto (factura generada por un programa) | Se lee su texto directamente, solo las primeras páginas (2 por defecto) | No |
| PDF sin texto (escaneado o foto) | Primero se intenta sin OCR; si sale casi vacío (menos de 50 letras y números), se repite con OCR | Sí |
| Imagen (PNG, JPG, TIFF) | Siempre con OCR | Sí |
| Word (DOCX) y Excel (XLSX) | Se lee su texto directamente | No |
| ZIP, CSV, correos adjuntos (EML, MSG) y otros | No se leen; quedan anotados como omitidos | — |
| Ficheros más grandes que el límite (15 MB por defecto) | No se descargan | — |

Un PDF con texto tarda unos 3–4 segundos; con OCR puede tardar 20 segundos o más. Si docling no
responde, el correo queda pendiente de reprocesar y no se pierde.

## Paso 3. Decidir cada categoría

FOOD BOX, LATERAL y ARCOBETA se deciden por separado. Para cada una se usa la primera respuesta de
esta lista:

1. **Regla fuerte: el CIF o la razón social de una sociedad del grupo.** Decide sola, con total
   seguridad.
    - Si el remitente es externo, se busca en el asunto, el cuerpo y los adjuntos.
    - Si es de un dominio de correo del grupo, solo en los adjuntos y en la parte reenviada o citada
      del correo, porque su firma lleva los datos del propio grupo.
    - El CIF vale con o sin «ES» delante y con espacios, puntos o guiones. La razón social tiene que
      ir con su forma societaria (S.L., S.A.), y valen también las variantes de
      [sociedades-categorias.md](sociedades-categorias.md): «FOOD BOX, S.A.» por FOODBOX y
      «ARCOBETA, S.L.» por ARCO BETA.
2. **Descarte.** Si aparece una sociedad de otra categoría, esta se descarta: una factura a LATERAL
   IBERIA no es de FOOD BOX.
3. **Hilo.** Si otro correo de la misma conversación ya tenía esa categoría (puesta por el equipo o
   ya decidida), se hereda.
4. **Regla media: remitente, dominio o palabra clave.** Solo decide si nada más fuerte responde.
5. **Modelo de lenguaje (LLM).** Solo para lo que siga en duda.
6. **Duda.** Si nada responde, la categoría queda sin decidir.

Un correo puede quedar con **varias categorías**. Si un adjunto es una factura a FOODBOX y otro a
LATERAL IBERIA (o una está en el cuerpo y otra en un adjunto), las dos tienen su regla fuerte y el
correo queda con FOOD BOX y LATERAL; ARCOBETA se descarta porque no aparece.

Nunca se quita una categoría que haya puesto una persona.

## Paso 4. Qué pasa con el resultado

En modo sombra el resultado solo se guarda en el panel del clasificador: en Outlook no cambia nada.
Cada correo queda en uno de estos estados, visibles en la página **Correos** del panel:

| Estado | Qué significa |
| --- | --- |
| Clasificado | Tiene al menos una categoría propuesta |
| Sin categoría | No es de ninguna sociedad del grupo |
| En duda | Hay respuesta, pero con poca seguridad |
| Pendiente de reprocesar | Faltó algo (el LLM, o docling no respondió); se volverá a procesar |
| En cola | Todavía no se ha leído |

Qué tiene que hacer el equipo mientras tanto:

- Seguir poniendo las categorías y archivando en las carpetas como siempre. Eso es lo que se usa para
  medir cuánto acierta.
- Avisar si ven en un correo una categoría que no ha puesto nadie, o si falta una que sí habían
  puesto.

## Las reglas

Las reglas fuertes son el CIF y la razón social de cada sociedad de
[sociedades-categorias.md](sociedades-categorias.md). Las reglas activas, incluidas las de remitente,
dominio o palabra clave que se añadan, y cuántos correos ha decidido cada una se ven en la página
**Reglas** del panel.
