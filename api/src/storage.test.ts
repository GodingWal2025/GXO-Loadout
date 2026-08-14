import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateRecordSchema } from './validation';
import { validateMediaSignature, MAX_PHOTO_SIZE_BYTES } from './middleware/mediaValidation';
import { checkRateLimit, resetRateLimits } from './middleware/rateLimit';
import { extractDeviceAuth } from './middleware/auth';

describe('API Storage Engine & Handler Unit Tests', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  describe('Validation on Storage Put', () => {
    it('approves compliant inspection record', () => {
      const record = {
        id: 'insp-put-1',
        siteId: 'site-a',
        status: 'COMPLETED',
        pallets: [],
        photos: [],
        lastEditedAt: '2026-08-13T10:00:00.000Z',
      };
      const res = validateRecordSchema('inspections', record);
      expect(res.valid).toBe(true);
    });

    it('rejects inspection missing id or containing bad fields', () => {
      const record = {
        id: '',
        pallets: 'invalid',
      };
      const res = validateRecordSchema('inspections', record);
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Photo Upload Validation & Constraints', () => {
    it('accepts valid JPEG photo binary payload under 8MB', () => {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const res = validateMediaSignature(jpeg, ['image/jpeg', 'image/png', 'image/webp']);
      expect(res.valid).toBe(true);
      expect(res.mediaType).toBe('image/jpeg');
    });

    it('rejects oversized photo payload', () => {
      const oversized = Buffer.alloc(MAX_PHOTO_SIZE_BYTES + 100);
      oversized[0] = 0xff;
      oversized[1] = 0xd8;
      oversized[2] = 0xff;
      const res = validateMediaSignature(oversized, ['image/jpeg', 'image/png']);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('exceeds maximum limit');
    });

    it('rejects script or malicious text disguised as photo', () => {
      const bad = Buffer.from('<?php echo "exploit"; ?>');
      const res = validateMediaSignature(bad);
      expect(res.valid).toBe(false);
    });
  });

  describe('Device Auth and Rate Limiting on Protected Endpoints', () => {
    it('extracts device ID and site ID headers', () => {
      const req = {
        headers: new Map([
          ['x-loadout-device-id', 'device-ipad-42'],
          ['x-loadout-site-id', 'site-cedar-rapids'],
          ['x-forwarded-for', '192.168.1.100, 10.0.0.1'],
        ]),
        query: new Map(),
      } as any;

      const auth = extractDeviceAuth(req);
      expect(auth.deviceId).toBe('device-ipad-42');
      expect(auth.siteId).toBe('site-cedar-rapids');
      expect(auth.clientIp).toBe('192.168.1.100');
      expect(auth.authenticated).toBe(true);
    });

    it('throttles rapid sequential requests from same device', () => {
      const deviceId = 'scanner-gun-10';
      const config = { maxRequestsPerMinute: 3 };

      expect(checkRateLimit(deviceId, config).allowed).toBe(true);
      expect(checkRateLimit(deviceId, config).allowed).toBe(true);
      expect(checkRateLimit(deviceId, config).allowed).toBe(true);

      const blocked = checkRateLimit(deviceId, config);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    });
  });
});
