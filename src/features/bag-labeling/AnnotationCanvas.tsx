import { useEffect, useRef, useState } from 'react';
import { normalizeXyxy, type NormalizedXyxy } from './coordinates';
import type { PalletLabelPhoto } from './types';

export type AnnotationMode = 'pallet' | 'prompt';

interface Props {
  photo: PalletLabelPhoto;
  mode: AnnotationMode;
  busy?: boolean;
  onDrawBox: (box: NormalizedXyxy) => void;
}

function drawNormalizedBox(
  context: CanvasRenderingContext2D,
  box: NormalizedXyxy,
  width: number,
  height: number,
  color: string,
  lineWidth = 2
): void {
  const [x1, y1, x2, y2] = box;
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.strokeRect(x1 * width, y1 * height, (x2 - x1) * width, (y2 - y1) * height);
}

export function AnnotationCanvas({ photo, mode, busy, onDrawBox }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; currentX: number; currentY: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(photo.blob);
    const next = new Image();
    next.onload = () => setImage(next);
    next.src = url;
    return () => {
      setImage(null);
      URL.revokeObjectURL(url);
    };
  }, [photo.blob, photo.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const maxWidth = Math.max(320, Math.min(1000, canvas.parentElement?.clientWidth || 1000));
    const scale = Math.min(1, maxWidth / photo.width);
    canvas.width = Math.round(photo.width * scale);
    canvas.height = Math.round(photo.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    if (photo.targetPalletBox) {
      const [x1, y1, x2, y2] = photo.targetPalletBox;
      context.fillStyle = 'rgba(12, 18, 24, 0.5)';
      context.fillRect(0, 0, canvas.width, y1 * canvas.height);
      context.fillRect(0, y2 * canvas.height, canvas.width, (1 - y2) * canvas.height);
      context.fillRect(0, y1 * canvas.height, x1 * canvas.width, (y2 - y1) * canvas.height);
      context.fillRect(x2 * canvas.width, y1 * canvas.height, (1 - x2) * canvas.width, (y2 - y1) * canvas.height);
      drawNormalizedBox(context, photo.targetPalletBox, canvas.width, canvas.height, '#ffbf00', 3);
    }

    for (const flap of photo.flaps) {
      if (flap.status === 'rejected') continue;
      const color = flap.status === 'accepted' ? '#2ca66f' : '#50a7ff';
      context.fillStyle = flap.status === 'accepted' ? 'rgba(44,166,111,.28)' : 'rgba(80,167,255,.25)';
      for (const polygon of flap.displayPolygon) {
        if (polygon.length < 6) continue;
        context.beginPath();
        context.moveTo(polygon[0] * canvas.width, polygon[1] * canvas.height);
        for (let index = 2; index + 1 < polygon.length; index += 2) {
          context.lineTo(polygon[index] * canvas.width, polygon[index + 1] * canvas.height);
        }
        context.closePath();
        context.fill();
      }
      drawNormalizedBox(context, flap.bbox, canvas.width, canvas.height, color, flap.status === 'accepted' ? 3 : 2);
    }

    if (drag) {
      const box = normalizeXyxy([drag.x, drag.y, drag.currentX, drag.currentY]);
      context.setLineDash([8, 5]);
      drawNormalizedBox(context, box, canvas.width, canvas.height, mode === 'pallet' ? '#ffbf00' : '#50a7ff', 3);
      context.setLineDash([]);
    }
  }, [drag, image, mode, photo]);

  const position = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  return (
    <div className="bag-label-canvas-wrap">
      <canvas
        ref={canvasRef}
        className={busy ? 'bag-label-canvas is-busy' : 'bag-label-canvas'}
        onPointerDown={(event) => {
          if (busy) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = position(event);
          setDrag({ ...point, currentX: point.x, currentY: point.y });
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          const point = position(event);
          setDrag({ ...drag, currentX: point.x, currentY: point.y });
        }}
        onPointerUp={(event) => {
          if (!drag) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          const point = position(event);
          const box = normalizeXyxy([drag.x, drag.y, point.x, point.y]);
          setDrag(null);
          if ((box[2] - box[0]) * (box[3] - box[1]) >= 0.0001) onDrawBox(box);
        }}
      />
      {busy && <div className="bag-label-canvas-busy">SAM 3 is segmenting…</div>}
    </div>
  );
}
