"""
Bearer-token gate in front of a self-hosted Cosmos 3 Reasoner NIM.

Why this exists: the NIM serves an OpenAI-compatible API with NO authentication of
its own. Exposing port 8000 to the internet so Azure can reach it would leave an
open GPU inference endpoint that anyone who finds the URL can bill to your GPU
hours. Brev's own Secure Links can't solve this either — they gate on interactive
login, which a server-to-server call from an Azure Function cannot satisfy.

So: expose THIS instead of the NIM. It requires the same
`Authorization: Bearer <token>` the Function already sends as COSMOS_NIM_KEY, and
forwards everything else to the NIM untouched.

    PROXY_TOKEN=<long random secret>   # must equal COSMOS_NIM_KEY in Azure
    NIM_URL=http://127.0.0.1:8000      # where the NIM is listening
    PORT=8080                          # port to expose publicly

    pip install fastapi uvicorn httpx
    PROXY_TOKEN=... uvicorn auth_proxy:app --host 0.0.0.0 --port 8080

Then in the Azure Static Web App environment variables:
    COSMOS_NIM_URL = https://<public-proxy-host>/v1
    COSMOS_NIM_KEY = <the same PROXY_TOKEN>
"""

import hmac
import os

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

TOKEN = os.environ.get("PROXY_TOKEN", "").strip()
NIM_URL = os.environ.get("NIM_URL", "http://127.0.0.1:8000").rstrip("/")

if not TOKEN:
    raise SystemExit("PROXY_TOKEN is required — refusing to run an unauthenticated proxy.")
if len(TOKEN) < 20:
    raise SystemExit("PROXY_TOKEN is too short; use at least 20 random characters.")

# A reasoning VLM on a modest GPU is slow. This must exceed the client's patience,
# not the other way around, or you get a truncated stream instead of an answer.
TIMEOUT = httpx.Timeout(float(os.environ.get("PROXY_TIMEOUT", "600")))

app = FastAPI(title="cosmos-nim-auth-proxy")
_client: httpx.AsyncClient | None = None


@app.on_event("startup")
async def _startup() -> None:
    global _client
    _client = httpx.AsyncClient(base_url=NIM_URL, timeout=TIMEOUT)


@app.on_event("shutdown")
async def _shutdown() -> None:
    if _client:
        await _client.aclose()


def _authorized(header: str | None) -> bool:
    if not header or not header.startswith("Bearer "):
        return False
    # compare_digest, not ==, so a wrong token can't be recovered by timing.
    return hmac.compare_digest(header[7:].strip(), TOKEN)


@app.get("/healthz")
async def healthz():
    """Unauthenticated liveness for the proxy itself; reports NIM reachability."""
    try:
        r = await _client.get("/v1/models")
        return {"proxy": "ok", "nim": r.status_code, "nimUrl": NIM_URL}
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"proxy": "ok", "nim": "unreachable", "error": str(e)}, status_code=503)


@app.api_route("/{path:path}", methods=["GET", "POST", "OPTIONS"])
async def forward(path: str, request: Request):
    if not _authorized(request.headers.get("authorization")):
        raise HTTPException(status_code=401, detail="Unauthorized")

    # Drop hop-by-hop and auth headers; the NIM wants neither.
    skip = {"host", "authorization", "content-length", "connection"}
    headers = {k: v for k, v in request.headers.items() if k.lower() not in skip}

    upstream = await _client.request(
        request.method,
        f"/{path}",
        content=await request.body(),
        headers=headers,
        params=dict(request.query_params),
    )
    passthrough = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower() not in {"content-length", "transfer-encoding", "connection"}
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=passthrough,
        media_type=upstream.headers.get("content-type"),
    )
