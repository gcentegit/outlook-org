#!/usr/bin/env bash
# Genera el certificado autofirmado con el que la app del buzón se autentica en Entra ID.
# Guía de uso: docs/guia-entra-id-rbac.md (Parte A).
set -euo pipefail

NOMBRE="clasificador-proveedores"
DIAS=730
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SALIDA="$RAIZ/secrets"
FORZAR=0
PFX=0

uso() {
  cat <<USO
Uso: $(basename "$0") [--out DIRECTORIO] [--pfx] [--force]

  --out DIR   Directorio de salida (por defecto: <repo>/secrets).
  --pfx       Genera además un .pfx. La contraseña se toma de la variable
              PFX_PASSWORD o, si no existe, se pide por teclado.
  --force     Sobrescribe los ficheros si ya existen.
  -h, --help  Muestra esta ayuda.

Ficheros generados (CN=$NOMBRE, RSA 2048, $DIAS días):
  $NOMBRE.cer  Certificado público (DER). Es el que se sube a Entra ID.
  $NOMBRE.pem  Clave privada y certificado. Es el que usa la app. Permisos 600.
  $NOMBRE.pfx  Opcional, con --pfx.
USO
}

while [ $# -gt 0 ]; do
  case "$1" in
    --out)
      [ $# -ge 2 ] || { echo "Error: --out necesita un directorio." >&2; exit 1; }
      SALIDA="$2"; shift 2 ;;
    --pfx) PFX=1; shift ;;
    --force) FORZAR=1; shift ;;
    -h|--help) uso; exit 0 ;;
    *) echo "Error: opción desconocida: $1" >&2; uso >&2; exit 1 ;;
  esac
done

command -v openssl >/dev/null 2>&1 || { echo "Error: openssl no está instalado." >&2; exit 1; }

CER="$SALIDA/$NOMBRE.cer"
PEM="$SALIDA/$NOMBRE.pem"
PFX_FILE="$SALIDA/$NOMBRE.pfx"

existentes=()
for f in "$CER" "$PEM"; do [ -e "$f" ] && existentes+=("$f"); done
if [ "$PFX" -eq 1 ] && [ -e "$PFX_FILE" ]; then existentes+=("$PFX_FILE"); fi
if [ "${#existentes[@]}" -gt 0 ] && [ "$FORZAR" -ne 1 ]; then
  echo "Error: ya existen ficheros y no se sobrescriben sin --force:" >&2
  printf '  %s\n' "${existentes[@]}" >&2
  exit 1
fi

pfx_pass=""
if [ "$PFX" -eq 1 ]; then
  if [ -n "${PFX_PASSWORD:-}" ]; then
    pfx_pass="$PFX_PASSWORD"
  else
    read -r -s -p "Contraseña para el .pfx: " pfx_pass; echo
    [ -n "$pfx_pass" ] || { echo "Error: la contraseña del .pfx no puede estar vacía." >&2; exit 1; }
  fi
fi

mkdir -p "$SALIDA"
chmod 700 "$SALIDA"
umask 077

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Generando clave RSA 2048 y certificado de $DIAS días (CN=$NOMBRE)..."
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days "$DIAS" \
  -subj "/CN=$NOMBRE" -keyout "$tmp/key.pem" -out "$tmp/cert.pem" 2>/dev/null

openssl x509 -in "$tmp/cert.pem" -outform DER -out "$CER"
cat "$tmp/key.pem" "$tmp/cert.pem" > "$PEM"
chmod 644 "$CER"
chmod 600 "$PEM"

if [ "$PFX" -eq 1 ]; then
  PFX_PASS="$pfx_pass" openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
    -name "$NOMBRE" -passout env:PFX_PASS -out "$PFX_FILE"
  chmod 600 "$PFX_FILE"
fi

huella="$(openssl x509 -in "$tmp/cert.pem" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d ':')"
caduca="$(openssl x509 -in "$tmp/cert.pem" -noout -enddate | cut -d= -f2)"

echo
echo "Hecho. Ficheros en $SALIDA:"
echo "  $CER   (súbelo a Entra ID)"
echo "  $PEM   (clave privada: no la compartas ni la subas a git)"
[ "$PFX" -eq 1 ] && echo "  $PFX_FILE"
echo
echo "Huella (SHA-1, la que muestra Entra ID): $huella"
echo "Caduca: $caduca"
