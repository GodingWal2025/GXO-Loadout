#!/usr/bin/env bash
# Stand up the Cosmos 3 Reasoner NIM on a Brev GPU VM, behind a token-checked proxy.
#
# Run this ON THE VM (Brev terminal or ssh). Needs an NGC key with registry access —
# the same nvapi-... key from build.nvidia.com works.
#
#   export NGC_API_KEY=nvapi-...
#   export PROXY_TOKEN=$(openssl rand -hex 24)   # save this; Azure needs it
#   bash setup.sh
#
# Sized for the RTX PRO Server 6000 (96 GiB). Cosmos 3 Nano is BF16-only and wants
# ~32GB, so this card is comfortable; a 24GB card is not.
set -euo pipefail

NIM_IMAGE="${NIM_IMAGE:-nvcr.io/nim/nvidia/cosmos3-reasoner:latest}"
NIM_MODEL_SIZE="${NIM_MODEL_SIZE:-nano}"
NIM_PORT="${NIM_PORT:-8000}"
PROXY_PORT="${PROXY_PORT:-8080}"
CACHE_DIR="${CACHE_DIR:-$HOME/.cache/nim}"

: "${NGC_API_KEY:?export NGC_API_KEY=nvapi-... first}"
: "${PROXY_TOKEN:?export PROXY_TOKEN=\$(openssl rand -hex 24) first}"

echo "==> GPU"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader

echo "==> Logging in to nvcr.io"
# The username is the literal string $oauthtoken — not your email, not a variable.
echo "$NGC_API_KEY" | docker login nvcr.io --username '$oauthtoken' --password-stdin

echo "==> Pulling $NIM_IMAGE (several GB, one time)"
docker pull "$NIM_IMAGE"

# Persist the model cache on the host. Without this, every container restart
# re-downloads the weights — which on a $4/hr box is money for nothing.
mkdir -p "$CACHE_DIR"
chmod 777 "$CACHE_DIR"

echo "==> Starting the NIM"
docker rm -f cosmos-nim >/dev/null 2>&1 || true
docker run -d --name cosmos-nim \
  --gpus all \
  --shm-size=16g \
  --restart unless-stopped \
  -e NGC_API_KEY \
  -e NIM_MODEL_SIZE="$NIM_MODEL_SIZE" \
  -v "$CACHE_DIR":/opt/nim/.cache \
  -p "127.0.0.1:$NIM_PORT":8000 \
  "$NIM_IMAGE"
# Bound to 127.0.0.1 deliberately: the NIM has NO authentication of its own, so it
# must never be the thing listening on a public port. The proxy below is.

echo "==> Waiting for the model to load (first start pulls weights; can take 10-20 min)"
for i in $(seq 1 240); do
  if curl -sf "http://127.0.0.1:$NIM_PORT/v1/models" >/dev/null 2>&1; then
    echo "    ready after ~$((i*10))s"
    break
  fi
  if ! docker ps --format '{{.Names}}' | grep -q '^cosmos-nim$'; then
    echo "!!! container exited. Last 40 lines:"
    docker logs --tail 40 cosmos-nim
    exit 1
  fi
  sleep 10
done

curl -sf "http://127.0.0.1:$NIM_PORT/v1/models" || {
  echo "!!! NIM never became ready. Logs:"; docker logs --tail 60 cosmos-nim; exit 1; }

echo
echo "==> Model ids the NIM is serving (use one as COSMOS_NIM_MODEL):"
curl -s "http://127.0.0.1:$NIM_PORT/v1/models" | python3 -c \
  'import json,sys; [print("   ", m["id"]) for m in json.load(sys.stdin).get("data",[])]' \
  2>/dev/null || echo "   (could not parse; curl the endpoint directly)"

echo "==> Starting the auth proxy on :$PROXY_PORT"
pip install --quiet fastapi "uvicorn[standard]" httpx
pkill -f "uvicorn auth_proxy:app" >/dev/null 2>&1 || true
NIM_URL="http://127.0.0.1:$NIM_PORT" PROXY_TOKEN="$PROXY_TOKEN" \
  nohup uvicorn auth_proxy:app --host 0.0.0.0 --port "$PROXY_PORT" \
  > "$HOME/auth_proxy.log" 2>&1 &

sleep 4
curl -s "http://127.0.0.1:$PROXY_PORT/healthz" && echo

cat <<EOF

=========================================================================
NIM is local-only on :$NIM_PORT. The proxy on :$PROXY_PORT is what to expose.

Next:
  1. In Brev -> "Expose Port", expose $PROXY_PORT. Note the public host:port.
     Do NOT use "Share a Service" for this — those links require an interactive
     login, which an Azure Function cannot perform.
  2. Set on the Static Web App (Settings -> Environment variables, Production):
       COSMOS_NIM_URL   = http://<public-host>:<public-port>/v1
       COSMOS_NIM_KEY   = $PROXY_TOKEN
       COSMOS_NIM_MODEL = <a model id printed above>
  3. Stop the VM when you are not demoing. It bills by the hour.

Proxy log: $HOME/auth_proxy.log
NIM log:   docker logs -f cosmos-nim
=========================================================================
EOF
