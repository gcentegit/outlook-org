# Changelog

## [1.4.0](https://github.com/gcentegit/outlook-org/compare/v1.3.2...v1.4.0) (2026-10-23)


### 🚀 Novedades

* **web:** 🗂️ la categoría del clasificador se elige en el panel ([#130](https://github.com/gcentegit/outlook-org/issues/130)) ([74ff917](https://github.com/gcentegit/outlook-org/commit/74ff917cabd061e4fb9675351ebd0f42b150677d))
* **worker:** 🏷️ marca con la categoría del servicio los correos que categoriza ([#128](https://github.com/gcentegit/outlook-org/issues/128)) ([e67f863](https://github.com/gcentegit/outlook-org/commit/e67f863f979269f07570d0e1156ee3f6b9cc05a6))

## [1.3.2](https://github.com/gcentegit/outlook-org/compare/v1.3.1...v1.3.2) (2026-10-19)


### 🔧 Correcciones

* **web:** 📱 el icono del panel también se ve en Safari del iPhone ([#118](https://github.com/gcentegit/outlook-org/issues/118)) ([1633c70](https://github.com/gcentegit/outlook-org/commit/1633c70ba2ca50338d587f2fb2cce8d13536a836))

### 🧹 Mantenimiento

* **infra:** docling responde en cuanto termina la conversión ([#121](https://github.com/gcentegit/outlook-org/issues/121)) ([23ab9cb](https://github.com/gcentegit/outlook-org/commit/23ab9cb0482fbf60ada6130014486cb4d3ae878d))
* **infra:** el worker sincroniza el buzón cada 60 s ([#122](https://github.com/gcentegit/outlook-org/issues/122)) ([6fb2eef](https://github.com/gcentegit/outlook-org/commit/6fb2eef373a3cfc535e5b672f9595f767d2e7bd2))
* **infra:** la provisión no devuelve a sombra un worker en live ([#124](https://github.com/gcentegit/outlook-org/issues/124)) ([9c6f9ac](https://github.com/gcentegit/outlook-org/commit/9c6f9ac0afa9e454d4928f0d5225f46a76b119e3))

## [1.3.1](https://github.com/gcentegit/outlook-org/compare/v1.3.0...v1.3.1) (2026-10-17)


### 🔧 Correcciones

* **web:** 🎨 poner en una línea los botones de cada regla ([#115](https://github.com/gcentegit/outlook-org/issues/115)) ([4c6752a](https://github.com/gcentegit/outlook-org/commit/4c6752a7b8f53a9259fe0dab3614e6f5340c954b))

## [1.3.0](https://github.com/gcentegit/outlook-org/compare/v1.2.0...v1.3.0) (2026-10-17)


### 🚀 Novedades

* **web:** 🧩 gestionar las reglas desde el panel y revisar la Bandeja con una regla ([#113](https://github.com/gcentegit/outlook-org/issues/113)) ([99f707f](https://github.com/gcentegit/outlook-org/commit/99f707f787ccf0cd226867be1c8ac0bafbcf920b))

## [1.2.0](https://github.com/gcentegit/outlook-org/compare/v1.1.0...v1.2.0) (2026-10-17)


### 🚀 Novedades

* **web:** 🏷️ contar como acierto lo que escribe el servicio hasta que el equipo lo cambie ([#111](https://github.com/gcentegit/outlook-org/issues/111)) ([cc15923](https://github.com/gcentegit/outlook-org/commit/cc15923e199f293f7de1144e2c68a81f0a4c4a24))

## [1.1.0](https://github.com/gcentegit/outlook-org/compare/v1.0.0...v1.1.0) (2026-10-17)


### 🚀 Novedades

* **web:** 🗂️ separar lo que pone el equipo de la referencia en Correos ([#108](https://github.com/gcentegit/outlook-org/issues/108)) ([a7a0f6a](https://github.com/gcentegit/outlook-org/commit/a7a0f6a7cf936752a199fdcfde8760e400b5c287))


### 🔧 Correcciones

* **web:** 🐛 no contar como verdad del equipo lo que escribe el servicio ([#109](https://github.com/gcentegit/outlook-org/issues/109)) ([8a0e0a5](https://github.com/gcentegit/outlook-org/commit/8a0e0a5eb79eed19e337c0118cb7cc957f27fe49))

## [1.0.0](https://github.com/gcentegit/outlook-org/compare/v0.16.2...v1.0.0) (2026-10-16)


### ⚠ BREAKING CHANGES

* **worker:** ✍️ activar el modo real: escribir en Outlook las categorías en live ([#104](https://github.com/gcentegit/outlook-org/issues/104))

### 🚀 Novedades

* **worker:** ✍️ activar el modo real: escribir en Outlook las categorías en live ([#104](https://github.com/gcentegit/outlook-org/issues/104)) ([812fb7f](https://github.com/gcentegit/outlook-org/commit/812fb7fd1d8bec3fbc72c459bcd42a61e3239b66))

## [0.16.2](https://github.com/gcentegit/outlook-org/compare/v0.16.1...v0.16.2) (2026-10-16)


### 🔧 Correcciones

* **deps:** 🔒 versiones corregidas de dependencias con avisos de seguridad ([#102](https://github.com/gcentegit/outlook-org/issues/102)) ([698b922](https://github.com/gcentegit/outlook-org/commit/698b922c234a7c3cbb203926437793be21e62b88))

## [0.16.1](https://github.com/gcentegit/outlook-org/compare/v0.16.0...v0.16.1) (2026-10-16)


### 🔧 Correcciones

* **worker:** 🧾 solo queda anotado como escrito lo que el correo tiene de verdad ([#100](https://github.com/gcentegit/outlook-org/issues/100)) ([566b3e3](https://github.com/gcentegit/outlook-org/commit/566b3e32833174de7e48c4a15e3b2dd98ee43168))

## [0.16.0](https://github.com/gcentegit/outlook-org/compare/v0.15.0...v0.16.0) (2026-10-16)


### 🚀 Novedades

* **web:** 🔌 desactivar el LLM desde Modelos y dejar las dudas como dudas ([#98](https://github.com/gcentegit/outlook-org/issues/98)) ([acea138](https://github.com/gcentegit/outlook-org/commit/acea13870410e43f9378aba927c061f31d99f145))

## [0.15.0](https://github.com/gcentegit/outlook-org/compare/v0.14.2...v0.15.0) (2026-10-16)


### 🚀 Novedades

* **worker:** 🎯 razón social con forma societaria y varias sociedades sin CIF en duda ([#96](https://github.com/gcentegit/outlook-org/issues/96)) ([c241e43](https://github.com/gcentegit/outlook-org/commit/c241e43fec6ec78df5833687073b5aa16f0b1c7c))

## [0.14.2](https://github.com/gcentegit/outlook-org/compare/v0.14.1...v0.14.2) (2026-10-16)


### 🔧 Correcciones

* **worker:** 🐛 el CIF de una tabla HTML del cuerpo se reconoce ([#94](https://github.com/gcentegit/outlook-org/issues/94)) ([cc3a18f](https://github.com/gcentegit/outlook-org/commit/cc3a18f903fa7755b08ae030638d95525f194205))

## [0.14.1](https://github.com/gcentegit/outlook-org/compare/v0.14.0...v0.14.1) (2026-10-16)


### 🔧 Correcciones

* **web:** 📱 versión bajo el título y botones a la derecha en móvil ([#91](https://github.com/gcentegit/outlook-org/issues/91)) ([c2d89bd](https://github.com/gcentegit/outlook-org/commit/c2d89bd5cf8d5896df849538edae9f109e3ba98c))

## [0.14.0](https://github.com/gcentegit/outlook-org/compare/v0.13.1...v0.14.0) (2026-10-16)


### 🚀 Novedades

* **worker:** ✨ recupera los correos archivados durante una parada ([#88](https://github.com/gcentegit/outlook-org/issues/88)) ([b0e67d7](https://github.com/gcentegit/outlook-org/commit/b0e67d7cdbfa23ea7d8f4c2317ed68e12590282a))

## [0.13.1](https://github.com/gcentegit/outlook-org/compare/v0.13.0...v0.13.1) (2026-10-16)


### 🔧 Correcciones

* **worker:** 🐛 la imagen trae el motor de migraciones de Prisma para OpenSSL 3 ([#84](https://github.com/gcentegit/outlook-org/issues/84)) ([05d5419](https://github.com/gcentegit/outlook-org/commit/05d541976e7c710b911b62a7600c90c7f372c0bd))

## [0.13.0](https://github.com/gcentegit/outlook-org/compare/v0.12.1...v0.13.0) (2026-10-15)


### 🚀 Novedades

* 📉 registro de caídas de la sincronización en el panel ([#76](https://github.com/gcentegit/outlook-org/issues/76)) ([b22afd7](https://github.com/gcentegit/outlook-org/commit/b22afd7e4cf42a101688bd0dd73bded564d14dab))
* **worker:** ⏳ aviso de caducidad del certificado de Graph y del secreto de login ([#78](https://github.com/gcentegit/outlook-org/issues/78)) ([bbda923](https://github.com/gcentegit/outlook-org/commit/bbda923034efe036985eb89342f2b79596afa3f3))
* **worker:** 💶 tope de gasto diario del LLM ([#80](https://github.com/gcentegit/outlook-org/issues/80)) ([5042352](https://github.com/gcentegit/outlook-org/commit/504235241812d61dfb15711829a3ce9bdce852b3))
* **worker:** 📎 los correos adjuntos se descartan de forma informada ([#75](https://github.com/gcentegit/outlook-org/issues/75)) ([0bfa21f](https://github.com/gcentegit/outlook-org/commit/0bfa21f077520b0060a123bf91a437c73800e825))
* **worker:** 🧹 borrado de correos con más de 12 meses, desactivado hasta la copia ([#77](https://github.com/gcentegit/outlook-org/issues/77)) ([a40a954](https://github.com/gcentegit/outlook-org/commit/a40a9540bc9133b94df25198ee9aa71aff008d1d))


### 🔧 Correcciones

* **worker:** ⏱️ una ronda de carpetas que caduca se detiene y no se solapa con la siguiente ([#81](https://github.com/gcentegit/outlook-org/issues/81)) ([f01aa97](https://github.com/gcentegit/outlook-org/commit/f01aa971742cba69953e4a558d29a4c081f56f7c))


### ⚡ Rendimiento

* **worker:** 📦 la imagen del worker baja de 2,09 GB a 1,06 GB ([#79](https://github.com/gcentegit/outlook-org/issues/79)) ([2bf6421](https://github.com/gcentegit/outlook-org/commit/2bf6421e1ea1d88a2c98df9b7b2b5b2ff0df9977))

## [0.12.1](https://github.com/gcentegit/outlook-org/compare/v0.12.0...v0.12.1) (2026-10-15)


### 🔧 Correcciones

* 🛡️ arreglos de la revisión del código del 2026-10-13 ([#63](https://github.com/gcentegit/outlook-org/issues/63)) ([7265c32](https://github.com/gcentegit/outlook-org/commit/7265c32f965837bfb2babca3a55bc9e734152f76))

## [0.12.0](https://github.com/gcentegit/outlook-org/compare/v0.11.0...v0.12.0) (2026-10-15)


### 🚀 Novedades

* **worker:** ⚡ el texto de los PDF se lee sin docling ([#72](https://github.com/gcentegit/outlook-org/issues/72)) ([70f7aaf](https://github.com/gcentegit/outlook-org/commit/70f7aafe1d6ed4fa3b840ee832e1fd9e7faad976))

## [0.11.0](https://github.com/gcentegit/outlook-org/compare/v0.10.0...v0.11.0) (2026-10-14)


### 🚀 Novedades

* **web:** 🗑️ el resumen cuenta aparte los correos que el equipo eliminó ([#69](https://github.com/gcentegit/outlook-org/issues/69)) ([26ee8aa](https://github.com/gcentegit/outlook-org/commit/26ee8aa2849d47fbec55d5460a52d30f45050963))

## [0.10.0](https://github.com/gcentegit/outlook-org/compare/v0.9.2...v0.10.0) (2026-10-14)


### 🚀 Novedades

* **worker:** 📮 el reproceso encuentra los correos que el equipo ya archivó ([#67](https://github.com/gcentegit/outlook-org/issues/67)) ([9792ed8](https://github.com/gcentegit/outlook-org/commit/9792ed8ca64b1ae0347ff1fab1ba42fdbfa2a991))

## [0.9.2](https://github.com/gcentegit/outlook-org/compare/v0.9.1...v0.9.2) (2026-10-14)


### 🔧 Correcciones

* 🏷️ «Grupo Lateral» en los conceptos de una factura da LATERAL ([#64](https://github.com/gcentegit/outlook-org/issues/64)) ([f7a9da6](https://github.com/gcentegit/outlook-org/commit/f7a9da6b3d605dfefcfdb0fde2df77a4cac10d61))

## [0.9.1](https://github.com/gcentegit/outlook-org/compare/v0.9.0...v0.9.1) (2026-10-13)


### 🔧 Correcciones

* 🔁 reprocesar ya no deja en cola los correos que el equipo archivó ([#60](https://github.com/gcentegit/outlook-org/issues/60)) ([76fae41](https://github.com/gcentegit/outlook-org/commit/76fae4126a03ea8650aacbf7d45dad3692b52eca))

## [0.9.0](https://github.com/gcentegit/outlook-org/compare/v0.8.0...v0.9.0) (2026-10-13)


### 🚀 Novedades

* 🗂️ «Correos» muestra la carpeta exacta donde está cada correo ([#57](https://github.com/gcentegit/outlook-org/issues/57)) ([1a0bf37](https://github.com/gcentegit/outlook-org/commit/1a0bf3777ac52f16da1ada99e59ed17a0968d94d))

## [0.8.0](https://github.com/gcentegit/outlook-org/compare/v0.7.0...v0.8.0) (2026-10-13)


### 🚀 Novedades

* 📂 el panel compara con la carpeta donde el equipo archiva cada correo ([#55](https://github.com/gcentegit/outlook-org/issues/55)) ([ecfb635](https://github.com/gcentegit/outlook-org/commit/ecfb63587d4576e2dd1022827d1a3c469670a9f5))

## [0.7.0](https://github.com/gcentegit/outlook-org/compare/v0.6.2...v0.7.0) (2026-10-13)


### 🚀 Novedades

* **worker:** 🏷️ escritura de categorías en el buzón preparada y bloqueada hasta la activación real ([#48](https://github.com/gcentegit/outlook-org/issues/48)) ([1c3f627](https://github.com/gcentegit/outlook-org/commit/1c3f627653ecce3ec3d700c62df686ce5de5e341))
* **worker:** 📊 casos de evaluación contra la carpeta donde el equipo archiva cada correo ([#49](https://github.com/gcentegit/outlook-org/issues/49)) ([39a22b5](https://github.com/gcentegit/outlook-org/commit/39a22b522933550f36d3e641de2f1e0f45877448))


### 🔧 Correcciones

* **web:** 🖼️ el panel tiene icono y la consola ya no da error por el favicon ([#50](https://github.com/gcentegit/outlook-org/issues/50)) ([84e8f00](https://github.com/gcentegit/outlook-org/commit/84e8f00b9c1ea95467870604c9bb8d95f0149cbf))

## [0.6.2](https://github.com/gcentegit/outlook-org/compare/v0.6.1...v0.6.2) (2026-10-12)


### 🔧 Correcciones

* **worker:** 📮 un correo marcado para reprocesar se vuelve a decidir aunque ya estuviera decidido ([#45](https://github.com/gcentegit/outlook-org/issues/45)) ([56e960f](https://github.com/gcentegit/outlook-org/commit/56e960fa8825f656999c26eb6b7550be64f0d927))

## [0.6.1](https://github.com/gcentegit/outlook-org/compare/v0.6.0...v0.6.1) (2026-10-12)


### 🔧 Correcciones

* **worker:** 🏷️ la razón social no cuenta dentro de una dirección de correo o una web ([#43](https://github.com/gcentegit/outlook-org/issues/43)) ([00a4561](https://github.com/gcentegit/outlook-org/commit/00a45611cf77ee1a41dd89fcb69173e595e40e7f))

## [0.6.0](https://github.com/gcentegit/outlook-org/compare/v0.5.0...v0.6.0) (2026-10-12)


### 🚀 Novedades

* **web:** anchos fijos en la tabla de correos ([#40](https://github.com/gcentegit/outlook-org/issues/40)) ([b7fc164](https://github.com/gcentegit/outlook-org/commit/b7fc1644b2dfb02ba24f51703d9d10dfaa59419f))

## [0.5.0](https://github.com/gcentegit/outlook-org/compare/v0.4.0...v0.5.0) (2026-10-12)


### 🚀 Novedades

* **web:** el motivo muestra solo lo que se cumple y el indicador se aclara ([#38](https://github.com/gcentegit/outlook-org/issues/38)) ([3784332](https://github.com/gcentegit/outlook-org/commit/378433266be6ca798830bd29df75c87dcaaf7a4b))

## [0.4.0](https://github.com/gcentegit/outlook-org/compare/v0.3.0...v0.4.0) (2026-10-12)


### 🚀 Novedades

* aceptar «FOOD BOX, S.A.» y «ARCOBETA, S.L.» como razón social ([#35](https://github.com/gcentegit/outlook-org/issues/35)) ([d9f0768](https://github.com/gcentegit/outlook-org/commit/d9f0768fd86eea2d81898f2cde1d8b6fe613b12a))
* **worker:** la razón social vale sin forma societaria ([#37](https://github.com/gcentegit/outlook-org/issues/37)) ([e3f9cf9](https://github.com/gcentegit/outlook-org/commit/e3f9cf9fdf223cea5a7ffd3dc9621f8932675f1e))

## [0.3.0](https://github.com/gcentegit/outlook-org/compare/v0.2.0...v0.3.0) (2026-10-12)


### 🚀 Novedades

* **web:** 🔔 aviso de reproceso con la causa de cada grupo de correos ([e70c011](https://github.com/gcentegit/outlook-org/commit/e70c0119915b8f1ab16bedaab24ad77fd8380455))

## [0.2.0](https://github.com/gcentegit/outlook-org/compare/v0.1.3...v0.2.0) (2026-10-12)


### 🚀 Novedades

* **web:** 🗂️ páginas de correos y reglas en el panel ([#27](https://github.com/gcentegit/outlook-org/issues/27)) ([4c40dfe](https://github.com/gcentegit/outlook-org/commit/4c40dfedb79093bb7bc4ee3eb1909d8c4c4ec537))

## [0.1.3](https://github.com/gcentegit/outlook-org/compare/v0.1.2...v0.1.3) (2026-10-12)


### 🔧 Correcciones

* **web:** 🔐 llevar el oid de Microsoft en la sesión para que las acciones del panel funcionen ([#25](https://github.com/gcentegit/outlook-org/issues/25)) ([27fed17](https://github.com/gcentegit/outlook-org/commit/27fed17a9b5a6060731b4bb88c01cf029246a6d1))

## [0.1.2](https://github.com/gcentegit/outlook-org/compare/v0.1.1...v0.1.2) (2026-10-12)


### 🔧 Correcciones

* **worker:** 📎 quitar los caracteres nulos del texto de los adjuntos ([#23](https://github.com/gcentegit/outlook-org/issues/23)) ([12726ff](https://github.com/gcentegit/outlook-org/commit/12726ff3a863a1c76b8e82bef1b08fddd3695b2a))

## [0.1.1](https://github.com/gcentegit/outlook-org/compare/v0.1.0...v0.1.1) (2026-10-12)


### ⚡ Rendimiento

* **worker:** 📄 leer la capa de texto del PDF antes de usar OCR ([#21](https://github.com/gcentegit/outlook-org/issues/21)) ([8c926fa](https://github.com/gcentegit/outlook-org/commit/8c926fadfc275a11c985ed1d4676c3304e44925c))

## 0.1.0 (2026-10-03)


### 🚀 Novedades

* 🏷️ clasificador del buzón de Proveedores en modo sombra ([6208561](https://github.com/gcentegit/outlook-org/commit/6208561ef4c639317017b97f60aa6844b105e3ac))
