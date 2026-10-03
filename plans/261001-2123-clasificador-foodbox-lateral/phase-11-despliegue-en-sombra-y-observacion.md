---
title: "Phase 11: Despliegue en sombra y observación"
status: todo
effort: 1d (+ 2 semanas de observación)
---

# Phase 11: Despliegue en sombra y observación

## Overview

Desplegar el servicio en Dokploy en modo sombra y observarlo dos semanas comparando con lo que hace el
equipo. Nada se despliega sin autorización del usuario.

## Key Insights

- El equipo no etiqueta siempre, así que el acierto no sale solo de lo que hagan las personas: hace
  falta una **revisión semanal de una muestra en el panel**.
- Las personas de Proveedores van a ver cambios en su flujo aunque el servicio no escriba nada:
  hay que contarles qué verán antes de empezar.
- El worker sin credenciales de Graph arranca sano pero no sincroniza; el orden de alta importa
  ([despliegue](../../docs/operacion/despliegue.md)).

## Requirements

- Depende de la fase 10.
- Autorización expresa del usuario para el alta y el despliegue.
- La categoría ARCOBETA existe en la lista maestra del buzón (hoy no existe).
- Alguien atiende los avisos de Uptime Kuma, con nombre y plazo de respuesta.

## Implementation Steps

1. Alta de los servicios con `infra/dokploy/provision.ts`: primero `--dry-run`, revisar y solo
   entonces `--apply` ([infra/dokploy/README.md](../../infra/dokploy/README.md)).
2. Registro DNS del panel, dominio y HTTPS; métricas del servidor activadas.
3. Desplegar con el flujo de publicación (worker primero) en `MODE=shadow` y comprobar `/livez`,
   `/health` y `/api/health`.
4. Monitor de Uptime Kuma con su URL de push en el worker.
5. Comunicar al equipo de Proveedores y empezar las dos semanas.
6. Cada semana, revisar con el usuario una muestra de decisiones en el panel y anotar las
   discrepancias.
7. Informe de las dos semanas: precisión y cobertura por categoría contra lo revisado, y lista de
   discrepancias; ajustar reglas si hace falta.

## Todo

- [ ] Autorización del usuario para desplegar
- [ ] Categoría ARCOBETA creada en el buzón
- [ ] Alta en Dokploy, primero en simulación y después aplicando
- [ ] Registro DNS, dominio y HTTPS del panel
- [ ] Métricas del servidor activadas y límites de memoria revisados tras la primera semana
- [ ] Despliegue del worker y la web en sombra; comprobaciones de salud en verde
- [ ] Monitor de Uptime Kuma y heartbeat; persona responsable de los avisos
- [ ] Prueba mensual de restauración programada (hoy no está en ningún cron ni workflow) y primera ejecución con datos reales
- [ ] Procedimiento de restauración sobre producción escrito y ensayado
- [ ] Comunicación al equipo de Proveedores: qué verán, cómo corregir una etiqueta y a quién avisar
- [ ] Dos semanas en sombra con revisión semanal de una muestra en el panel
- [ ] Informe de modo sombra aprobado por el usuario

## Success Criteria

- En producción, cada correo nuevo tiene su decisión registrada en menos de 5 minutos y el buzón no
  cambia.
- El servicio está desplegado en Dokploy en sombra, con heartbeat en Uptime Kuma.
- Informe de dos semanas aprobado por el usuario: precisión ≥ 95 % por categoría contra lo revisado a
  mano y cobertura mínima cumplida.

## Risk Assessment

- Throttling de Graph con picos de correo: respetar `Retry-After` y limitar la concurrencia.
- Alarmas sin responsable: el aviso existe pero nadie lo atiende. Se asigna antes de empezar.
- Una migración al desplegar: copia de seguridad previa.
