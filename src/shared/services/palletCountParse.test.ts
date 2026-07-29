import { describe, expect, it } from 'vitest';
import { extractJsonObject } from '../../../api/src/index';

// The pallet-count reply parser. Cosmos3 Nano Reasoner narrates inside <think>
// before answering, and that narration contains braces — coordinates, JSON
// sketches, set notation. Reading the FIRST object would return the model's
// scratch work as the answer, so these pin the reasoning-model behaviour.

const ANSWER = {
  layers: 6,
  topLayerFull: true,
  gaps: false,
  damage: false,
  estimatedBags: 12,
  confidence: 0.8,
  rationale: 'Six courses visible.',
};

describe('extractJsonObject', () => {
  it('reads a bare JSON reply from a direct-answering model', () => {
    expect(extractJsonObject(JSON.stringify(ANSWER))).toEqual(ANSWER);
  });

  it('ignores a think block and returns the answer after it', () => {
    const reply = `<think>I count the seams. Roughly {x: 10} across.</think>\n${JSON.stringify(ANSWER)}`;
    expect(extractJsonObject(reply)).toEqual(ANSWER);
  });

  it('is not fooled by a JSON sketch inside the reasoning', () => {
    // The decoy is a complete, parseable object that appears FIRST.
    const decoy = '{"layers": 99, "note": "scratch"}';
    const reply = `<think>Maybe the shape is ${decoy} — let me verify.</think>${JSON.stringify(ANSWER)}`;
    expect(extractJsonObject(reply)?.layers).toBe(6);
  });

  it('prefers the object carrying layers when several survive', () => {
    const reply = `{"unrelated": 1} ${JSON.stringify(ANSWER)} {"trailing": 2}`;
    expect(extractJsonObject(reply)).toEqual(ANSWER);
  });

  it('handles bounding-box coordinates in the narration', () => {
    // Cosmos emits point localization and boxes; those braces must not win.
    const reply =
      '<think>Boxes: {"bbox": [0,0,10,10]}, {"bbox": [0,10,10,20]}</think>' +
      JSON.stringify(ANSWER);
    expect(extractJsonObject(reply)?.layers).toBe(6);
  });

  it('survives a multi-line think block and fenced output', () => {
    const reply = `<think>\nline one\nline two {a:1}\n</think>\n\`\`\`json\n${JSON.stringify(
      ANSWER
    )}\n\`\`\``;
    expect(extractJsonObject(reply)).toEqual(ANSWER);
  });

  it('tolerates an unterminated think block without throwing', () => {
    // Budget exhausted mid-thought: no answer to find, but it must not crash.
    expect(() => extractJsonObject('<think>counting the layers and then')).not.toThrow();
  });

  it('skips a malformed object and keeps scanning', () => {
    const reply = `{"broken": }\n${JSON.stringify(ANSWER)}`;
    expect(extractJsonObject(reply)).toEqual(ANSWER);
  });

  it('returns null when there is no object at all', () => {
    expect(extractJsonObject('I cannot tell how many layers there are.')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });

  it('handles nested objects in the answer', () => {
    const nested = { ...ANSWER, extra: { a: { b: 1 } } };
    expect(extractJsonObject(JSON.stringify(nested))).toEqual(nested);
  });
});
