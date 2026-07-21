import api from './api';

// ═══════════════════════════════════════════════════
//  Cliente API – Mobile Tunnel (Cloudflare Quick Tunnel)
//  Prefijo: /api/integraciones/tunnel
// ═══════════════════════════════════════════════════

export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface TunnelInfo {
  status: TunnelStatus;
  publicUrl: string | null;
  startedAt: string | null;
  pid: number | null;
  backendPort: number;
  cloudflaredPath: string;
  uptimeSec: number | null;
  lastError: string | null;
}

export interface QrPayload {
  v: 2;
  type: 'rg-tunnel';
  name: string;
  url: string;
  issuedAt: string;
  expiresAt: string;
  /** One-time registration token. El mobile lo canjea por su propia API key. */
  regToken: string;
}

export interface TunnelCheckResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface RotateTokenResult {
  ok: boolean;
  revokedCount: number;
  message: string;
}

export interface MobileDevice {
  DEVICE_ID: number;
  API_KEY_ID: number | null;
  DEVICE_NAME: string;
  DEVICE_UUID: string;
  REGISTERED_AT: string;
  LAST_SEEN_AT: string | null;
  LAST_IP: string | null;
  REVOKED_AT: string | null;
  KEY_PREFIX: string | null;
  EXPIRES_AT: string | null;
  KEY_REVOKED_AT: string | null;
  KEY_ACTIVA: boolean | null;
}

export interface MessageResult {
  ok: boolean;
  message?: string;
}

export const tunnelApi = {
  status: () => api.get<TunnelInfo>('/integraciones/tunnel/status').then((r) => r.data),

  start: () => api.post<TunnelInfo>('/integraciones/tunnel/start').then((r) => r.data),

  stop: () => api.post<{ ok: boolean }>('/integraciones/tunnel/stop').then((r) => r.data),

  logs: (tail = 50) =>
    api.get<{ lines: string[] }>('/integraciones/tunnel/logs', { params: { tail } }).then((r) => r.data.lines),

  check: () => api.get<TunnelCheckResult>('/integraciones/tunnel/check').then((r) => r.data),

  qrPayload: () =>
    api.get<QrPayload>('/integraciones/tunnel/qr-payload').then((r) => r.data),

  rotateToken: () =>
    api.post<RotateTokenResult>('/integraciones/tunnel/rotate-token').then((r) => r.data),

  listDevices: () =>
    api.get<MobileDevice[]>('/integraciones/tunnel/devices').then((r) => r.data),

  revokeDevice: (id: number) =>
    api.post<MessageResult>(`/integraciones/tunnel/devices/${id}/revoke`).then((r) => r.data),

  unlinkDevice: (id: number) =>
    api.post<MessageResult>(`/integraciones/tunnel/devices/${id}/unlink`).then((r) => r.data),

  deleteDevice: (id: number) =>
    api.delete<MessageResult>(`/integraciones/tunnel/devices/${id}`).then((r) => r.data),

  keyDevicesCount: (id: number) =>
    api.get<{ count: number }>(`/integraciones/tunnel/keys/${id}/devices`).then((r) => r.data),
};
