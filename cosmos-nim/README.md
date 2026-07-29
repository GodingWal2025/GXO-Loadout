# Self-hosted Cosmos 3 Reasoner for pallet bag-count

`nvidia/cosmos3-nano-reasoner` is **not served on NVIDIA's hosted API**
(`integrate.api.nvidia.com`) — pointing the Function at it there returns a plain
`404 page not found`. The build.nvidia.com page is an interactive playground, not an
API endpoint. To use this model you host it, which is what this directory is for.

The NIM serves the **same OpenAI-compatible `/chat/completions`** the Function
already speaks, so no application code changes — only `COSMOS_NIM_*` settings.

## Hardware

Cosmos 3 Nano is **BF16-only** — no FP8, FP4, or GGUF — so the weights alone want
~32GB and NVIDIA recommends H100 or RTX PRO 6000 class. A 24GB card (L4, most
consumer RTX) is below spec, and even where it fits it is slow enough that a
reasoning generation will blow the 45-second Static Web Apps gateway timeout.

**Brev RTX PRO Server 6000 (96 GiB) bills ~$4/hr.** Stop the instance when you are
not demoing — a $20 credit is about five hours.

## Setup

On the VM (Brev terminal or ssh), with `auth_proxy.py` and `setup.sh` present:

```bash
export NGC_API_KEY=nvapi-...              # same key works for the registry
export PROXY_TOKEN=$(openssl rand -hex 24)  # save this — Azure needs it
bash setup.sh
```

It verifies the GPU, logs in to `nvcr.io`, pulls the NIM, starts it bound to
**localhost only**, waits for the model to load, prints the model ids it serves, and
starts the auth proxy on `:8080`.

First start downloads weights and can take 10–20 minutes. The cache is mounted from
the host, so restarts are fast — on an hourly-billed box that matters.

## Why the proxy

The NIM has **no authentication of its own**. Exposing its port publicly so Azure can
reach it leaves an open GPU inference endpoint for anyone who finds the URL.

Brev's "Share a Service" links don't solve it either: they gate on interactive login,
which a server-to-server call from an Azure Function cannot satisfy. So expose the
proxy — it requires the same `Authorization: Bearer` the Function already sends as
`COSMOS_NIM_KEY`, compares it with `hmac.compare_digest`, and forwards everything else
untouched.

Use Brev **"Expose Port"** (raw TCP) on the proxy port, not "Share a Service".

> ### Transport is unencrypted — know what you are accepting
> Raw TCP exposure gives you `http://`, not `https://`. The bearer token and the
> pallet photos cross the internet in cleartext. For a short-lived demo with a
> throwaway token that may be an acceptable trade; it is **not** a production
> posture. For production, terminate TLS properly (a tunnel with a real
> certificate, or a reverse proxy on a domain you control) — or move the model
> into your own Azure tenant, which also settles the question of warehouse photos
> leaving the network.

## Wire it up

Static Web App → **Settings → Environment variables** (Production):

```
COSMOS_NIM_URL   = http://<public-host>:<public-port>/v1
COSMOS_NIM_KEY   = <the PROXY_TOKEN>
COSMOS_NIM_MODEL = <a model id setup.sh printed>
```

`COSMOS_NIM_URL` must end in `/v1` — the Function appends `/chat/completions`.

## Verify

Against the VM directly, from your laptop:

```bash
cd ../detector-service
$env:NVIDIA_BASE_URL = "http://<public-host>:<public-port>/v1"
$env:NVIDIA_API_KEY = "<PROXY_TOKEN>"
.venv/Scripts/python.exe try_nvidia.py --src "$env:USERPROFILE\Desktop\Bags_Phots" --limit 6
```

Then through the deployed app:

```bash
.venv/Scripts/python.exe try_nvidia.py --src "$env:USERPROFILE\Desktop\Bags_Phots" \
  --endpoint "https://<swa-host>/api/analyze-pallet-count?debug=1" --limit 4
```

`?debug=1` echoes the upstream error body, resolved endpoint, and configured model —
which is how the hosted-API 404 got diagnosed in the first place.

## Watch the 45-second ceiling

Static Web Apps cuts managed-function HTTP responses at 45s even though the function
keeps running. A reasoning model at `COSMOS_NIM_MAX_TOKENS=1536` is the most likely
thing to exceed it. If responses time out, in order of preference:

1. Lower `COSMOS_NIM_MAX_TOKENS` (try 768).
2. Lower the client's `MAX_EDGE` in `src/shared/services/palletVision.ts`.
3. Switch `COSMOS_NIM_MODEL` to a direct-answering VLM.

Time each call with `try_nvidia.py` against the VM *before* wiring production — the
script has no 45s limit, so it tells you the true latency.

## Operating

```bash
docker logs -f cosmos-nim          # model loading / inference
tail -f ~/auth_proxy.log           # proxy
curl localhost:8080/healthz        # proxy up + NIM reachable (no auth needed)
docker restart cosmos-nim          # weights are cached; restart is quick
```
