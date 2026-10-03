#!/usr/bin/env bash
#
# restore-check.sh — comprueba que la última copia de seguridad de PostgreSQL se puede restaurar.
#
# Baja la última copia del destino MinIO (o usa un fichero local), la restaura en un contenedor
# postgres:16-alpine temporal con nombre único y comprueba que:
#   - las tablas Message, Decision y Rule tienen al menos el número de filas esperado, y
#   - _prisma_migrations está al día: ninguna migración fallida y todas las del repositorio aplicadas.
# Al terminar (bien o mal) borra el contenedor y los ficheros temporales. No toca ninguna otra base
# de datos ni ningún otro contenedor: solo existe el que crea.
#
# USO (con `bash`):
#   bash infra/scripts/restore-check.sh                      # última copia del MinIO (variables abajo)
#   bash infra/scripts/restore-check.sh --from-file x.dump   # prueba local con un pg_dump existente
#
# VARIABLES (modo MinIO; las credenciales solo por entorno, nunca en el repositorio):
#   MINIO_ENDPOINT     https://minio.example.com
#   MINIO_ACCESS_KEY / MINIO_SECRET_KEY
#   MINIO_BUCKET       bucket del destino de copias de Dokploy
#   BACKUP_PATH        ruta dentro del bucket: <appName de PostgreSQL>/<prefix de la copia>
# OPCIONALES:
#   DB_NAME=clasificador               base de datos que contiene la copia
#   MIN_ROWS_MESSAGE=1  MIN_ROWS_DECISION=1  MIN_ROWS_RULE=1   mínimos de filas (0 los desactiva)
#   MIGRATIONS_DIR=<repo>/packages/db/prisma/migrations
#   ALLOW_OLDER_MIGRATIONS=1           una copia anterior a la última migración es un aviso, no un fallo
#   KUMA_PUSH_URL                      URL de push de Uptime Kuma: avisa del resultado
#   POSTGRES_IMAGE=postgres:16-alpine  MC_IMAGE=minio/mc@sha256:73a539df... (fijada por digest)
#
# Es un volcado de pg_dump: formato custom (PGDMP) o SQL plano, con o sin gzip; se detecta solo.
#
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly DB_NAME="${DB_NAME:-clasificador}"
readonly POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:16-alpine}"
# Fijada por digest (minio/mc no publica una etiqueta estable que se pueda fijar): no cambia sola.
readonly MC_IMAGE="${MC_IMAGE:-minio/mc@sha256:73a539df6ca44c9f4728feb9fa58d9c31a73536290dc160a75313793c5374238}"
readonly MIGRATIONS_DIR="${MIGRATIONS_DIR:-$REPO_ROOT/packages/db/prisma/migrations}"
readonly MIN_ROWS_MESSAGE="${MIN_ROWS_MESSAGE:-1}"
readonly MIN_ROWS_DECISION="${MIN_ROWS_DECISION:-1}"
readonly MIN_ROWS_RULE="${MIN_ROWS_RULE:-1}"

die() { echo "ERROR: $*" >&2; exit 1; }
step() { echo; echo "→ $*"; }

FROM_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-file) [[ $# -ge 2 ]] || die "--from-file necesita la ruta del volcado"; FROM_FILE="$2"; shift 2 ;;
    -h|--help)   awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "opción desconocida: $1" ;;
  esac
done

command -v docker >/dev/null || die "falta docker"
[[ -z "${DOCKER_HOST:-}" ]] || die "DOCKER_HOST está definido ($DOCKER_HOST); esta prueba solo usa el Docker local"
for n in "$MIN_ROWS_MESSAGE" "$MIN_ROWS_DECISION" "$MIN_ROWS_RULE"; do
  [[ "$n" =~ ^[0-9]+$ ]] || die "los mínimos de filas deben ser números enteros"
done

WORK_DIR="$(mktemp -d)"
CONTAINER="restore-check-$(date +%Y%m%d%H%M%S)-$$-${RANDOM}"
STARTED=0

notify() { # <up|down> <mensaje>
  [[ -n "${KUMA_PUSH_URL:-}" ]] || return 0
  curl -fsS --max-time 10 -G "$KUMA_PUSH_URL" \
    --data-urlencode "status=$1" --data-urlencode "msg=${2:0:200}" --data-urlencode "ping=" \
    >/dev/null 2>&1 || echo "aviso: no se pudo avisar a Uptime Kuma" >&2
}

cleanup() {
  local code=$?
  if (( STARTED )); then docker rm -f -v "$CONTAINER" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK_DIR"
  if (( code == 0 )); then notify up "restauración comprobada"; else notify down "restauración fallida (código $code)"; fi
  exit "$code"
}
trap cleanup EXIT

# --- 1. Conseguir el volcado -------------------------------------------------
if [[ -n "$FROM_FILE" ]]; then
  [[ -s "$FROM_FILE" ]] || die "el fichero '$FROM_FILE' no existe o está vacío"
  step "Usando el volcado local $FROM_FILE"
  cp "$FROM_FILE" "$WORK_DIR/backup.raw"
else
  for v in MINIO_ENDPOINT MINIO_ACCESS_KEY MINIO_SECRET_KEY MINIO_BUCKET BACKUP_PATH; do
    [[ -n "${!v:-}" ]] || die "falta la variable $v (o usa --from-file)"
  done
  command -v jq >/dev/null || die "falta jq"
  # `mc` en un contenedor efímero; el secreto viaja por entorno, no por la línea de órdenes.
  MC_HOST_backup="$(jq -rn --arg k "$MINIO_ACCESS_KEY" --arg s "$MINIO_SECRET_KEY" --arg e "$MINIO_ENDPOINT" \
    '($e | capture("^(?<scheme>https?)://(?<host>.+)$")) as $u | "\($u.scheme)://\($k|@uri):\($s|@uri)@\($u.host)"')"
  export MC_HOST_backup
  mc() { docker run --rm --user 0 --entrypoint mc -e MC_HOST_backup -v "$WORK_DIR:/out" "$MC_IMAGE" "$@"; }

  step "Buscando la última copia en $MINIO_BUCKET/$BACKUP_PATH"
  listing="$(mc ls --recursive "backup/$MINIO_BUCKET/${BACKUP_PATH%/}/" | tr -d '\r')" || die "no se pudo listar el bucket"
  # Líneas: `[2026-10-02 03:00:05 UTC]  1.2MiB STANDARD nombre`; el orden por fecha da la más reciente.
  newest="$(printf '%s\n' "$listing" | sort | tail -1 | awk '{print $NF}')"
  [[ -n "$newest" ]] || die "no hay copias en $MINIO_BUCKET/$BACKUP_PATH"
  echo "  última copia: $newest"
  mc cp "backup/$MINIO_BUCKET/${BACKUP_PATH%/}/$newest" /out/backup.raw >/dev/null || die "falló la descarga de $newest"
  [[ -s "$WORK_DIR/backup.raw" ]] || die "la copia descargada está vacía"
fi
echo "  tamaño: $(du -h "$WORK_DIR/backup.raw" | cut -f1)"

# --- 2. Descomprimir y detectar el formato -----------------------------------
if [[ "$(head -c2 "$WORK_DIR/backup.raw" | od -An -tx1 | tr -d ' \n')" == "1f8b" ]]; then
  gunzip -c "$WORK_DIR/backup.raw" > "$WORK_DIR/backup.dump" || die "la copia no se pudo descomprimir"
else
  mv "$WORK_DIR/backup.raw" "$WORK_DIR/backup.dump"
fi
if [[ "$(head -c5 "$WORK_DIR/backup.dump")" == "PGDMP" ]]; then FORMAT="custom"; else FORMAT="sql"; fi
echo "  formato: $FORMAT"

# --- 3. Restaurar en un contenedor temporal -----------------------------------
step "Restaurando en el contenedor temporal $CONTAINER ($POSTGRES_IMAGE)"
# Sin puertos publicados: solo se habla con él por `docker exec`.
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=restore-check -e POSTGRES_DB="$DB_NAME" "$POSTGRES_IMAGE" >/dev/null
STARTED=1
for _ in $(seq 1 60); do
  # Dos comprobaciones: el arranque inicial de la imagen reinicia el servidor una vez.
  if docker exec "$CONTAINER" psql -U postgres -d "$DB_NAME" -tAc 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" psql -U postgres -d "$DB_NAME" -tAc 'SELECT 1' >/dev/null 2>&1 || die "PostgreSQL temporal no arrancó"

# `docker cp` y no una tubería: pg_restore necesita un fichero con acceso aleatorio.
docker cp "$WORK_DIR/backup.dump" "$CONTAINER:/tmp/backup.dump"
if [[ "$FORMAT" == "custom" ]]; then
  docker exec "$CONTAINER" pg_restore -U postgres -d "$DB_NAME" --no-owner --no-privileges /tmp/backup.dump \
    || die "pg_restore terminó con errores"
else
  docker exec "$CONTAINER" psql -U postgres -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -f /tmp/backup.dump >/dev/null \
    || die "psql terminó con errores al cargar el volcado SQL"
fi

# --- 4. Comprobaciones --------------------------------------------------------
sql() { docker exec "$CONTAINER" psql -U postgres -d "$DB_NAME" -tA -c "$1"; }
FAILED=0
fail() { echo "  FALLO: $*" >&2; FAILED=1; }

step "Recuento de filas"
check_rows() { # <tabla> <mínimo>
  local n
  n="$(sql "SELECT count(*) FROM \"$1\"" 2>/dev/null)" || { fail "no se pudo contar la tabla $1 (¿falta en la copia?)"; return; }
  if (( n >= $2 )); then echo "  $1: $n filas (mínimo $2)"; else fail "$1 tiene $n filas y se esperaban al menos $2"; fi
}
check_rows Message "$MIN_ROWS_MESSAGE"
check_rows Decision "$MIN_ROWS_DECISION"
check_rows Rule "$MIN_ROWS_RULE"

step "Migraciones de Prisma"
if ! sql 'SELECT 1 FROM "_prisma_migrations" LIMIT 1' >/dev/null 2>&1; then
  fail "no existe la tabla _prisma_migrations (o está vacía)"
else
  # Una migración que falló y se resolvió (`migrate resolve`) y se volvió a aplicar deja una fila
  # vieja sin terminar o revertida y otra terminada: solo cuenta la que no tiene ninguna terminada.
  broken="$(sql 'SELECT count(DISTINCT m.migration_name) FROM "_prisma_migrations" m
    WHERE (m.finished_at IS NULL OR m.rolled_back_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM "_prisma_migrations" ok
        WHERE ok.migration_name = m.migration_name AND ok.finished_at IS NOT NULL AND ok.rolled_back_at IS NULL)')"
  (( broken == 0 )) && echo "  ninguna migración fallida ni revertida sin volver a aplicar" || fail "$broken migración(es) sin terminar o revertidas"
  applied="$(sql 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
  if [[ -d "$MIGRATIONS_DIR" ]]; then
    missing=""
    while IFS= read -r dir; do
      name="$(basename "$dir")"
      grep -qx "$name" <<<"$applied" || missing="$missing $name"
    done < <(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d | sort)
    if [[ -z "$missing" ]]; then
      echo "  todas las migraciones del repositorio están aplicadas ($(grep -c . <<<"$applied") en la copia)"
    elif [[ "${ALLOW_OLDER_MIGRATIONS:-0}" == "1" ]]; then
      echo "  aviso: la copia es anterior a estas migraciones:$missing"
    else
      fail "faltan migraciones del repositorio en la copia:$missing (ALLOW_OLDER_MIGRATIONS=1 lo admite)"
    fi
  else
    echo "  aviso: no existe $MIGRATIONS_DIR; solo se comprobó que no haya migraciones fallidas"
  fi
fi

echo
if (( FAILED )); then die "la copia NO supera la comprobación"; fi
echo "OK: la copia se restauró y supera las comprobaciones."
