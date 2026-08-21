FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv git libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-sam3.txt ./
RUN python3 -m pip install --break-system-packages \
      torch torchvision --index-url https://download.pytorch.org/whl/cu128 \
    && python3 -m pip install --break-system-packages -r requirements.txt -r requirements-sam3.txt

COPY app.py schemas.py pipeline.py cosmos_client.py sam3_model.py geometry.py ./

# Keep checkpoints outside the image and version them under /workspace/models.
# Exactly one worker is intentional: every worker would load another model copy.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=4s --start-period=600s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1
CMD ["sh", "-c", "python3 -m uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1"]
