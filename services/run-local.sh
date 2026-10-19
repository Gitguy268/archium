#!/bin/sh
# Run your own Helium services (filter lists, bangs, extension proxy) on this Mac at https://localhost.
# Needs Docker Desktop and mkcert. Run `mkcert -install` once yourself so the browser trusts the cert.
set -eu
cd "$(dirname "$0")"

SERVICES_COMMIT="a306151c83dab82582ecffcbd5b36c9bb59cc44d" # 2026-09-26
DIR="helium-services"

command -v docker >/dev/null 2>&1 || { echo "Docker Desktop is required." >&2; exit 1; }
command -v mkcert >/dev/null 2>&1 || { echo "mkcert is required: brew install mkcert && mkcert -install" >&2; exit 1; }

if [ ! -d "$DIR/.git" ]; then
  git clone --quiet https://github.com/imputnet/helium-services.git "$DIR"
fi
git -C "$DIR" fetch --quiet origin "$SERVICES_COMMIT"
git -C "$DIR" checkout --quiet "$SERVICES_COMMIT"
cd "$DIR"

if [ ! -f .env ]; then
  cat > .env <<EOF
SERVICES_HOSTNAME=localhost
SSL_CERT_EMAIL=
HMAC_SECRET=$(openssl rand -hex 32)
PROXY_BASE_URL=https://localhost/ext/
UBO_PROXY_BASE_URL=https://localhost/ubo/
EOF
  chmod 600 .env
fi

# Upstream's setup.sh issues a Let's Encrypt cert, which needs a public domain; use mkcert locally instead.
mkdir -p private/certs private/acme-tmp
if [ ! -f private/certs/fullchain.pem ]; then
  mkcert -cert-file private/certs/fullchain.pem -key-file private/certs/private.key localhost 127.0.0.1 ::1
fi

# Listen on this Mac only (upstream binds every interface). Docker Desktop has no IPv6 bridge
# by default, and the ACME daemon is not needed locally.
cat > compose.override.yml <<'EOF'
networks:
  default:
    enable_ipv6: false
services:
  nginx:
    ports: !override
      - 127.0.0.1:80:80/tcp
      - 127.0.0.1:443:443/tcp
  acme.sh:
    profiles: [public]
EOF

docker compose up -d --build

printf "Waiting for services"
i=0
until curl -fs -o /dev/null --cacert "$(mkcert -CAROOT)/rootCA.pem" https://localhost/bangs.json; do
  i=$((i + 1))
  if [ "$i" -ge 120 ]; then echo; echo "Services did not come up: docker compose logs" >&2; exit 1; fi
  printf "."; sleep 2
done
echo
echo "Helium services are running. In Helium: Settings > Privacy > Services > custom origin: https://localhost"
