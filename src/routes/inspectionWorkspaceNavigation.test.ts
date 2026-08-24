import { describe, expect, it } from 'vitest';
import { getInspectionWorkspaceRedirect } from './inspectionWorkspaceNavigation';

describe('getInspectionWorkspaceRedirect', () => {
  it.each(['COMPLETED', 'FLAGGED'] as const)(
    'keeps an outbound %s load in its workspace',
    (status) => {
      expect(
        getInspectionWorkspaceRedirect({ id: 'load-1', type: 'outbound', status })
      ).toBeNull();
    }
  );

  it('keeps a completed returns load in its workspace', () => {
    expect(
      getInspectionWorkspaceRedirect({ id: 'return-1', type: 'returns', status: 'COMPLETED' })
    ).toBeNull();
  });

  it('continues routing inbound loads to their dedicated workspace', () => {
    expect(
      getInspectionWorkspaceRedirect({ id: 'inbound-1', type: 'inbound', status: 'COMPLETED' })
    ).toBe('/inspection/inbound-1/verify-inbound');
  });
});
