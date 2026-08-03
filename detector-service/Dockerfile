# CPU inference image. Both supported backends can run on CPU, so this
# does NOT need a GPU host; an Azure Container App (consumption) or small VM is enough.
# For GPU throughput, swap the base for an nvidia/cuda runtime + CUDA torch build.
FROM python:3.11-slim

# Which detector to build for: "owlv2" (zero-shot demo, no weights needed) or
# "rfdetr" (production, needs a fine-tuned checkpoint in weights/).
#   docker build --build-arg DETECTOR_BACKEND=rfdetr .
ARG DETECTOR_BACKEND=owlv2

# libGL / glib are needed by opencv (pulled in by rfdetr/supervision).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt requirements-owlv2.txt requirements-rfdetr.txt ./
# CPU-only torch: the default CUDA wheels add ~2GB to an image that has no GPU.
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir -r "requirements-${DETECTOR_BACKEND}.txt" \
       --extra-index-url https://download.pytorch.org/whl/cpu

COPY app.py zeroshot.py geometry.py rfdetr_model.py ./
# Bake weights in so the container starts offline. Drop your fine-tuned RF-DETR
# checkpoint in weights/ and set RFDETR_WEIGHTS to match; without it the service
# loads the COCO base model (which has no bag class — for smoke tests only).
COPY weights/ ./weights/

# Pre-download the OWLv2 snapshot at BUILD time. Without this the first request
# after every cold start pays a ~600MB HuggingFace download, which on Container
# Apps' scale-to-zero means a multi-minute first response.
ENV HF_HOME=/opt/hf
RUN if [ "$DETECTOR_BACKEND" = "owlv2" ]; then \
      python -c "from transformers import Owlv2Processor, Owlv2ForObjectDetection; \
m='google/owlv2-base-patch16-ensemble'; Owlv2Processor.from_pretrained(m); \
Owlv2ForObjectDetection.from_pretrained(m)"; \
    fi

ENV DETECTOR_BACKEND=${DETECTOR_BACKEND} \
    RFDETR_CONF=0.5 \
    PORT=8080
# e.g. RFDETR_WEIGHTS=/app/weights/checkpoint_best.pth
#      RFDETR_MODEL_SIZE=small RFDETR_CLASS_NAMES=bag_flap RFDETR_BAG_CLASSES=bag_flap

EXPOSE 8080
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
