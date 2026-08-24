import { describe, expect, it } from 'vitest';
import {
  getInspectionWorkspaceRedirect,
  getPreviousInspectionStep,
} from './inspectionWorkspaceNavigation';

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

describe('getPreviousInspectionStep', () => {
  it.each([
    ['outbound', '/inspection/load-1/verify'],
    ['retag', '/inspection/load-1/verify'],
    ['discard', '/inspection/load-1/verify'],
    ['returns', '/inspection/load-1/verify-returns'],
    ['inbound', '/inspection/load-1/verify-inbound'],
  ] as const)('moves %s back exactly one workflow screen', (type, expected) => {
    expect(getPreviousInspectionStep({ id: 'load-1', type })).toBe(expected);
  });
});
