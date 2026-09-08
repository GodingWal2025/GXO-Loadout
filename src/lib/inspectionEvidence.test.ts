import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { emptyInspection } from '../shared/hooks/useInspection';
import { dbGetPhotoBlob } from '../shared/services/db';
import { buildInspectionEvidence } from './inspectionEvidence';

vi.mock('../shared/services/db', () => ({ dbGetPhotoBlob: vi.fn(), dbSaveInspection: vi.fn() }));
const t = (_key: string, english: string) => english;
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('evidence archive', () => {
  it('packages available images and explicitly records missing remote evidence', async () => {
    const inspection = emptyInspection('site');
    inspection.picklist.photoIds = ['local', 'missing'];
    inspection.operationalNotes = [{ id: 'note', by: 'Inspector', at: '2026-09-07', kind: 'resolution', text: '<script>alert(1)</script>' }];
    vi.mocked(dbGetPhotoBlob).mockImplementation(async id => id === 'local' ? new Blob(['image bytes'], { type: 'image/png' }) : undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const result = await buildInspectionEvidence(inspection, t);
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(result.missing).toBe(1);
    expect(manifest.complete).toBe(false);
    expect(manifest.photos[0]).toMatchObject({ id: 'local', path: 'photos/1.png', label: 'Picklist 1' });
    expect(manifest.photos[1]).toMatchObject({ id: 'missing', missing: true });
    expect(await zip.file('photos/1.png')!.async('string')).toBe('image bytes');
    const html = await zip.file('index.html')!.async('string');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Image unavailable');
    expect(zip.file('inspection.json')).not.toBeNull();
  });
});
