#!/usr/bin/env bash
# Espera a que un despliegue de Dokploy termine bien y a que el contenedor de la aplicación esté
# sano con la imagen esperada. Lo usa el flujo de publicación para no desplegar la web hasta que el
# worker (que aplica las migraciones al arrancar) esté sano, y para comprobar ambos al final.
#
# Uso:
#   DOKPLOY_API_URL=https://dokploy.example.com DOKPLOY_API_KEY=... \
#     bash infra/scripts/wait-dokploy-app.sh --app-id <applicationId> --app-name <appName> \
#       --tag <sha corto> [--since <AAAA-MM-DDTHH:MM:SS en UTC>] [--timeout 600] [--interval 5]
#
# Pasos (cualquier fallo sale con código 1):
#   1. Espera a que exista un despliegue de la aplicación posterior a --since y a que termine:
#      `done` sigue; `error` o `cancelled` falla. (Sin --since vale cualquiera: comprobación final.)
#   2. Espera a que algún contenedor de la aplicación lleve la imagen con la etiqueta --tag y esté
#      `(healthy)`. Un contenedor con esa imagen que se reinicia o sale falla al terminar el tiempo.
#      Si Dokploy no ofrece la consulta de contenedores (HTTP 4xx), avisa y se queda con el paso 1.
#
# Solo hace lecturas (GET) contra la API de Dokploy. Nunca imprime la clave.
set -euo pipefail

APP_ID=""; APP_NAME=""; TAG=""; SINCE=""; TIMEOUT=600; INTERVAL=5
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-id) APP_ID="$2"; shift 2 ;;
    --app-name) APP_NAME="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --since) SINCE="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done
: "${DOKPLOY_API_URL:?falta DOKPLOY_API_URL}"; : "${DOKPLOY_API_KEY:?falta DOKPLOY_API_KEY}"
[[ -n "$APP_ID" && -n "$APP_NAME" && -n "$TAG" ]] || { echo "Faltan --app-id, --app-name o --tag" >&2; exit 2; }
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "Etiqueta no válida: '$TAG'" >&2; exit 2; }
[[ "$APP_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "appName no válido: '$APP_NAME'" >&2; exit 2; }
[[ "$TIMEOUT" =~ ^[0-9]+$ && "$INTERVAL" =~ ^[0-9]+$ ]] || { echo "--timeout y --interval deben ser enteros" >&2; exit 2; }

API="${DOKPLOY_API_URL%/}"; API="${API%/api}/api"
DEADLINE=$(( $(date +%s) + TIMEOUT ))
log() { echo "[$(date -u +%H:%M:%S)] $*"; }
expired() { (( $(date +%s) >= DEADLINE )); }

# GET con la clave; deja el cuerpo en $BODY y el código HTTP en $CODE (000 si no hubo respuesta).
get() {
  local out
  out="$(curl -sS --max-time 20 -w '\n%{http_code}' -H "x-api-key: $DOKPLOY_API_KEY" "$@" 2>/dev/null || printf '\n000')"
  CODE="${out##*$'\n'}"; BODY="${out%$'\n'*}"
}

# --- 1. Despliegue terminado -------------------------------------------------
log "Esperando el despliegue de $APP_NAME${SINCE:+ posterior a $SINCE UTC} (hasta ${TIMEOUT} s)..."
while :; do
  get -G "$API/deployment.all" --data-urlencode "applicationId=$APP_ID"
  if [[ "$CODE" == 2* ]]; then
    # El más reciente posterior a --since (createdAt es ISO en UTC: se compara como texto).
    STATUS="$(jq -r --arg since "$SINCE" '
      [ .[]? | select(($since == "") or ((.createdAt // "")[0:19] >= $since)) ]
      | sort_by(.createdAt) | last | .status // empty' <<<"$BODY" 2>/dev/null || true)"
    case "$STATUS" in
      done) log "Despliegue terminado (done)."; break ;;
      error|cancelled) log "ERROR: el despliegue de $APP_NAME terminó en '$STATUS'." >&2; exit 1 ;;
      running|"") log "Despliegue: ${STATUS:-aún no registrado}" ;;
      *) log "Estado de despliegue desconocido: '$STATUS'" ;;
    esac
  else
    log "deployment.all respondió HTTP $CODE"
  fi
  expired && { log "ERROR: el despliegue de $APP_NAME no terminó a tiempo." >&2; exit 1; }
  sleep "$INTERVAL"
done

# --- 2. Contenedor sano con la imagen esperada ---------------------------------
log "Esperando un contenedor sano de $APP_NAME con la imagen :$TAG..."
LAST=""
while :; do
  get -G "$API/docker.getContainersByAppNameMatch" --data-urlencode "appName=$APP_NAME"
  if [[ "$CODE" == 4* ]]; then
    log "AVISO: Dokploy no ofrece la consulta de contenedores (HTTP $CODE); solo se comprobó que el despliegue terminó."
    exit 0
  fi
  if [[ "$CODE" == 2* ]]; then
    HEALTHY="$(jq -r --arg tag ":$TAG" '[ .[]? | select((.image // "") | endswith($tag)) | select((.status // "") | test("\\(healthy\\)")) ] | length' <<<"$BODY" 2>/dev/null || echo 0)"
    LAST="$(jq -r --arg tag ":$TAG" '[ .[]? | select((.image // "") | endswith($tag)) | "\(.name): \(.state) \(.status)" ] | join("; ")' <<<"$BODY" 2>/dev/null || true)"
    if (( HEALTHY > 0 )); then log "Contenedor sano: $LAST"; exit 0; fi
    log "Aún no está sano: ${LAST:-ningún contenedor con :$TAG todavía}"
  else
    log "docker.getContainersByAppNameMatch respondió HTTP $CODE"
  fi
  expired && { log "ERROR: $APP_NAME no tiene un contenedor sano con :$TAG (último estado: ${LAST:-ninguno})." >&2; exit 1; }
  sleep "$INTERVAL"
done
