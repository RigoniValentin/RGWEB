import api from './api';

// ═══════════════════════════════════════════════════
//  Cliente API – Módulo Integraciones Externas
// ═══════════════════════════════════════════════════

export interface ApiKey {
  API_KEY_ID: number;
  NOMBRE: string;
  KEY_PREFIX: string;
  SCOPES: string | null;
  ACTIVA: boolean;
  CREATED_AT: string;
  LAST_USED_AT: string | null;
  REVOKED_AT: string | null;
  CREATED_BY: number | null;
  NOTAS: string | null;
}

export interface ApiKeyCreated extends ApiKey {
  RAW_KEY: string;
}

export interface IntegracionesConfig {
  webhook_url: string | null;
  webhook_secret_set: boolean;
  webhook_enabled: boolean;
  webhook_max_retries: number;
  orders_default_cliente_id: number | null;
  orders_default_punto_venta_id: number | null;
}

export interface IntegracionesConfigInput {
  webhook_url?: string | null;
  webhook_secret?: string | null;
  webhook_enabled?: boolean;
  webhook_max_retries?: number;
  orders_default_cliente_id?: number | null;
  orders_default_punto_venta_id?: number | null;
}

export interface SyncLog {
  LOG_ID: number;
  EVENT_TYPE: string;
  DIRECTION: 'INBOUND' | 'OUTBOUND';
  STATUS: 'SUCCESS' | 'ERROR' | 'PENDING';
  HTTP_STATUS: number | null;
  TARGET_URL: string | null;
  REQUEST_BODY: string | null;
  RESPONSE_BODY: string | null;
  ERROR_MESSAGE: string | null;
  DURATION_MS: number | null;
  API_KEY_ID: number | null;
  CREATED_AT: string;
}

export const integracionesApi = {
  // API Keys
  listApiKeys: () => api.get<ApiKey[]>('/integraciones/api-keys').then(r => r.data),
  createApiKey: (data: { nombre: string; scopes?: string; notas?: string }) =>
    api.post<ApiKeyCreated>('/integraciones/api-keys', data).then(r => r.data),
  revokeApiKey: (id: number) =>
    api.post<{ ok: true }>(`/integraciones/api-keys/${id}/revoke`).then(r => r.data),
  deleteApiKey: (id: number) =>
    api.delete<{ ok: true }>(`/integraciones/api-keys/${id}`).then(r => r.data),

  // Config
  getConfig: () => api.get<IntegracionesConfig>('/integraciones/config').then(r => r.data),
  updateConfig: (data: IntegracionesConfigInput) =>
    api.put<IntegracionesConfig>('/integraciones/config', data).then(r => r.data),
  testWebhook: () =>
    api.post<{ ok: boolean; message: string }>('/integraciones/webhook/test').then(r => r.data),

  // Logs
  listLogs: (limit = 10) =>
    api.get<SyncLog[]>('/integraciones/logs', { params: { limit } }).then(r => r.data),
};
