<!--
El TÍTULO del PR será el mensaje del commit en main y decide la versión:
`tipo: descripción` con tipo feat, fix, perf, refactor, docs, test, build, ci, chore o revert.
Un cambio incompatible lleva `!` (`feat!: ...`). En feat, fix, perf y revert la descripción empieza
por un icono (`fix(web): 🔐 ...`) y el PR necesita la sección «Para las notas de la release».
Ver docs/operacion/versiones-y-releases.md.
-->

## Qué cambia

## Para las notas de la release

<!--
Obligatoria en feat, fix, perf y revert (en los demás tipos, bórrala). Se copia tal cual en la Release,
debajo del título del PR. Uno a tres puntos, cada uno con un icono al principio, en lenguaje de producto
(qué cambia para quien usa el panel o el buzón) y diciendo qué pasaba antes. Lo importante, en negrita.
-->

- 🐛 Qué fallaba, en qué caso, y qué se ve ahora.

## Cómo se ha probado

## ¿Cambio incompatible?

- [ ] No.
- [ ] Sí (marca el título con `!`): migración que exige pasos manuales o no admite volver atrás, variable de entorno nueva obligatoria, o cambio en lo que el servicio hace en el buzón. Explica aquí qué hay que hacer al desplegar:
