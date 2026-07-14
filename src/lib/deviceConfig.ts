// Device-level configuration. Set once during initial device setup; persists
// in localStorage so the app knows which site it's at on every launch.
//
// Note: site list is now managed via the sites service (admin-editable).

const DEVICE_CONFIG_KEY = 'inspection.device.config';

export interface DeviceConfig {
  siteId: string;
  siteName: string;
  configuredAt: string;
  configuredBy: string;
}

export function getDeviceConfig(): DeviceConfig | null {
  const raw = localStorage.getItem(DEVICE_CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setDeviceConfig(config: DeviceConfig): void {
  localStorage.setItem(DEVICE_CONFIG_KEY, JSON.stringify(config));
}

export function clearDeviceConfig(): void {
  localStorage.removeItem(DEVICE_CONFIG_KEY);
}
