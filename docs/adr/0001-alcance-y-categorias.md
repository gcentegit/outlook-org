# 0001. Alcance: tres categorías y respeto a las de las personas

- **Estado:** aceptada

## Contexto

El buzón de Proveedores recibe facturas y otros correos de varias sociedades del grupo. El equipo
ya usa muchas categorías de Outlook (responsables, estados, etc.). El primer alcance se limita a
saber a qué sociedad pertenece cada correo.

## Decisión

- Solo se automatizan **FOOD BOX**, **LATERAL** y **ARCOBETA**. Decide la sociedad facturada:
  FOODBOX va a FOOD BOX, ARCO BETA va a ARCOBETA y toda sociedad con «Lateral» en su razón social
  va a LATERAL ([tabla de sociedades](../referencia/sociedades-categorias.md)).
- Un correo puede llevar varias categorías, una o ninguna. Los correos dudosos se dejan **sin
  categoría** y se registran: ante la duda, no se etiqueta.
- Solo se sigue la **Bandeja de entrada**. Los correos se quedan en ella al llegar; el equipo los
  mueve después a mano.
- El clasificador **nunca quita** las categorías que ponen las personas ni crea categorías por su
  cuenta. El panel permite ver la lista maestra del buzón y crear categorías nuevas (nombre y
  color) con confirmación, a través del worker ([0015](0015-web-sin-credenciales-del-buzon.md));
  no renombra ni borra, porque los correos guardan la categoría como texto y quedarían etiquetas
  huérfanas.
- Quedan fuera de alcance el resto de categorías, la edición de reglas desde el panel y los
  webhooks.

## Consecuencias

- La categoría ARCOBETA tiene que existir en la lista maestra del buzón antes de activar nada; el
  panel avisa si falta. Hoy no existe.
- Un correo cuya sociedad no está entre las siete conocidas queda sin categoría y no cuenta como
  error.
