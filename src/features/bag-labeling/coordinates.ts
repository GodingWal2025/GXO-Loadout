export type NormalizedXyxy = readonly [number, number, number, number];
export type NormalizedXywh = readonly [number, number, number, number];
export type PixelXywh = readonly [number, number, number, number];
export type NormalizedYxyx = readonly [number, number, number, number];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function normalizeXyxy(box: NormalizedXyxy): NormalizedXyxy {
  const [ax, ay, bx, by] = box.map(clamp01) as [number, number, number, number];
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

export function xyxyToXywh(box: NormalizedXyxy): NormalizedXywh {
  const [x1, y1, x2, y2] = normalizeXyxy(box);
  return [x1, y1, x2 - x1, y2 - y1];
}

export function xywhToXyxy(box: NormalizedXywh): NormalizedXyxy {
  const [x, y, width, height] = box;
  return normalizeXyxy([x, y, x + width, y + height]);
}

export function xyxyToPixelXywh(
  box: NormalizedXyxy,
  width: number,
  height: number
): PixelXywh {
  const [x1, y1, x2, y2] = normalizeXyxy(box);
  return [
    Math.round(x1 * width),
    Math.round(y1 * height),
    Math.round((x2 - x1) * width),
    Math.round((y2 - y1) * height),
  ];
}

export function pixelXywhToXyxy(
  box: PixelXywh,
  width: number,
  height: number
): NormalizedXyxy {
  if (width <= 0 || height <= 0) throw new Error('Image dimensions must be positive');
  const [x, y, boxWidth, boxHeight] = box;
  return normalizeXyxy([
    x / width,
    y / height,
    (x + boxWidth) / width,
    (y + boxHeight) / height,
  ]);
}

export function yxyxToXyxy(box: NormalizedYxyx): NormalizedXyxy {
  return normalizeXyxy([box[1], box[0], box[3], box[2]]);
}

export function xyxyToYxyx(box: NormalizedXyxy): NormalizedYxyx {
  const [x1, y1, x2, y2] = normalizeXyxy(box);
  return [y1, x1, y2, x2];
}

export function boxArea(box: NormalizedXyxy): number {
  const [x1, y1, x2, y2] = normalizeXyxy(box);
  return (x2 - x1) * (y2 - y1);
}

export function boxContainsPoint(box: NormalizedXyxy, x: number, y: number): boolean {
  const [x1, y1, x2, y2] = normalizeXyxy(box);
  return x >= x1 && x <= x2 && y >= y1 && y <= y2;
}
