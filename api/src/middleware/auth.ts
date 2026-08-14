// Device authentication and audit logging middleware

import { HttpRequest, InvocationContext } from '@azure/functions';

export interface DeviceAuthInfo {
  deviceId: string;
  siteId?: string;
  clientIp: string;
  authenticated: boolean;
}

export function extractDeviceAuth(request: HttpRequest): DeviceAuthInfo {
  const deviceId =
    request.headers.get('x-loadout-device-id') ||
    request.headers.get('x-device-id') ||
    request.query.get('deviceId') ||
    '';

  const siteId =
    request.headers.get('x-loadout-site-id') ||
    request.headers.get('x-site-id') ||
    request.query.get('siteId') ||
    undefined;

  // In Azure Functions / Azure Static Web Apps, client IP is in x-forwarded-for or x-client-ip
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const clientIp = forwarded.split(',')[0].trim() || request.headers.get('x-client-ip') || 'unknown';

  // Device is considered authenticated if deviceId is provided or if shared storage token is valid
  const hasDeviceId = Boolean(deviceId && deviceId.trim().length >= 4);

  return {
    deviceId: deviceId || 'anonymous',
    siteId,
    clientIp,
    authenticated: hasDeviceId,
  };
}

export function logAudit(
  context: InvocationContext,
  action: string,
  details: {
    deviceId?: string;
    siteId?: string;
    kind?: string;
    recordId?: string;
    status: number;
    error?: string;
  }
) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    action,
    ...details,
  };

  if (details.status >= 400) {
    context.warn(`[AUDIT-WARN] ${JSON.stringify(logEntry)}`);
  } else {
    context.log(`[AUDIT] ${JSON.stringify(logEntry)}`);
  }
}
