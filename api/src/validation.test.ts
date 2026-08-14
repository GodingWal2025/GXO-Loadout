import { describe, it, expect } from 'vitest';
import {
  validateRecordSchema,
  validateInspectionRecord,
  validateInventoryRecord,
  validateSiteRecord,
} from './validation';

describe('API Runtime Schema Validation', () => {
  it('validates a correct inspection record', () => {
    const valid = {
      id: 'insp-101',
      siteId: 'site-a',
      status: 'IN_PROGRESS',
      pallets: [{ lpn: 'LPN001', bagCount: 50 }],
      photos: [],
      lastEditedAt: '2026-08-13T20:00:00.000Z',
    };
    const result = validateInspectionRecord(valid);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects an inspection with missing or empty id', () => {
    const invalid = {
      id: '   ',
      siteId: 'site-a',
    };
    const result = validateInspectionRecord(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'id')).toBe(true);
  });

  it('rejects non-object or malformed inspections', () => {
    expect(validateInspectionRecord('string').valid).toBe(false);
    expect(validateInspectionRecord(null).valid).toBe(false);
    expect(validateInspectionRecord({ id: '1', pallets: 'not-an-array' }).valid).toBe(false);
  });

  it('validates a correct inventory record', () => {
    const valid = {
      id: 'inv-202',
      sku: 'SKU12345',
      description: 'Corn Seed 50#',
      quantity: 120,
      lastUpdated: '2026-08-13T21:00:00.000Z',
    };
    const result = validateInventoryRecord(valid);
    expect(result.valid).toBe(true);
  });

  it('rejects inventory with invalid fields', () => {
    const invalid = {
      id: 'inv-202',
      sku: 12345, // should be string
      quantity: 'a lot', // should be number
    };
    const result = validateInventoryRecord(invalid);
    expect(result.valid).toBe(false);
  });

  it('validates site records and catches unknown kinds', () => {
    const validSite = { id: 'site-1', name: 'Cedar Rapids', active: true };
    expect(validateSiteRecord(validSite).valid).toBe(true);
    expect(validateRecordSchema('unknown-kind', { id: '1' }).valid).toBe(false);
  });
});
