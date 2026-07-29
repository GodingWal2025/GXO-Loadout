import { describe, expect, it } from 'vitest';
import { fitWithin } from './palletVision';

describe('fitWithin', () => {
  it('leaves frames already inside the cap untouched', () => {
    expect(fitWithin(800, 600, 1024)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1024, 768, 1024)).toEqual({ width: 1024, height: 768 });
  });

  it('scales a portrait phone photo by its long edge', () => {
    // The real sample set: 3264x2448 sensor frames, upright after EXIF rotation.
    expect(fitWithin(2448, 3264, 1024)).toEqual({ width: 768, height: 1024 });
  });

  it('scales a landscape photo by its long edge', () => {
    expect(fitWithin(3264, 2448, 1024)).toEqual({ width: 1024, height: 768 });
  });

  it('preserves aspect ratio within a rounding step', () => {
    const { width, height } = fitWithin(4000, 3000, 1024);
    expect(Math.abs(width / height - 4000 / 3000)).toBeLessThan(0.01);
  });

  it('never collapses a dimension to zero on extreme aspect ratios', () => {
    const { width, height } = fitWithin(5000, 3, 1024);
    expect(width).toBe(1024);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('handles a degenerate zero-size frame without dividing by zero', () => {
    expect(fitWithin(0, 0, 1024)).toEqual({ width: 0, height: 0 });
  });
});
