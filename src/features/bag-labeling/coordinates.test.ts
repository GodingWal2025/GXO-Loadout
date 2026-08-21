import { describe, expect, it } from 'vitest';
import {
  pixelXywhToXyxy,
  xywhToXyxy,
  xyxyToPixelXywh,
  xyxyToXywh,
  xyxyToYxyx,
  yxyxToXyxy,
} from './coordinates';

describe('bag-labeling coordinates', () => {
  it('round-trips normalized xyxy and xywh', () => {
    const box = [0.1, 0.2, 0.8, 0.9] as const;
    xywhToXyxy(xyxyToXywh(box)).forEach((value, index) => expect(value).toBeCloseTo(box[index]));
  });

  it('round-trips pixel COCO boxes', () => {
    const box = [0.1, 0.2, 0.8, 0.9] as const;
    expect(pixelXywhToXyxy(xyxyToPixelXywh(box, 1000, 800), 1000, 800)).toEqual(box);
  });

  it('round-trips VLM yxyx coordinates', () => {
    const box = [0.1, 0.2, 0.8, 0.9] as const;
    expect(yxyxToXyxy(xyxyToYxyx(box))).toEqual(box);
  });
});
