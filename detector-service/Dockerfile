# CPU inference image. RF-DETR runs on CPU, so — unlike the Cosmos NIM — this does
# NOT need a GPU host; an Azure Container App (consumption) or small VM is enough.
# For GPU throughput, swap the base for an nvidia/cuda runtime + CUDA torch build.
FROM python:3.11-slim

# libGL / glib are needed by opencv (pulled in by rfdetr/supervision).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake weights in so the container starts offline. Drop your fine-tuned RF-DETR
# checkpoint in weights/ and set RFDETR_WEIGHTS to match; without it the service
# loads the COCO base model (which has no bag class — for smoke tests only).
COPY app.py .
COPY weights/ ./weights/

ENV RFDETR_CONF=0.5 \
    PORT=8080
# e.g. RFDETR_WEIGHTS=/app/weights/checkpoint_best.pth
#      RFDETR_CLASS_NAMES=bag,gap,damage

EXPOSE 8080
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
