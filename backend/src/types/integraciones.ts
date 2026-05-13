// ═══════════════════════════════════════════════════
//  Tipos del Módulo de Integración Externa
// ═══════════════════════════════════════════════════

export interface ApiKey {
  API_KEY_ID: number;
  NOMBRE: string;
  KEY_PREFIX: string;
  SCOPES: string | null;
  ACTIVA: boolean;
  CREATED_AT: Date;
  LAST_USED_AT: Date | null;
  REVOKED_AT: Date | null;
  CREATED_BY: number | null;
  NOTAS: string | null;
}

export interface ApiKeyCreated extends ApiKey {
  /** Solo se devuelve UNA VEZ tras la creación. No se almacena en claro. */
  RAW_KEY: string;
}

export interface IntegracionesConfig {
  webhook_url: string | null;
  webhook_secret: string | null;
  webhook_enabled: boolean;
  webhook_max_retries: number;
  orders_default_cliente_id: number | null;
  orders_default_punto_venta_id: number | null;
}

export type SyncDirection = 'INBOUND' | 'OUTBOUND';
export type SyncStatus = 'SUCCESS' | 'ERROR' | 'PENDING';

export interface SyncLog {
  LOG_ID: number;
  EVENT_TYPE: string;
  DIRECTION: SyncDirection;
  STATUS: SyncStatus;
  HTTP_STATUS: number | null;
  TARGET_URL: string | null;
  REQUEST_BODY: string | null;
  RESPONSE_BODY: string | null;
  ERROR_MESSAGE: string | null;
  DURATION_MS: number | null;
  API_KEY_ID: number | null;
  CREATED_AT: Date;
}

/** Item de stock devuelto a la tienda online */
export interface StockSyncItem {
  PRODUCTO_ID: number;
  CODIGO: string | null;
  NOMBRE: string;
  PRECIO: number;
  STOCK: number;
  ACTIVO: boolean;
  CODIGO_BARRAS: string | null;
}

/** Item de pedido recibido desde la tienda */
export interface ExternalOrderItem {
  productoId: number;
  cantidad: number;
  precioUnitario?: number;
  descuento?: number;
}

export interface ExternalOrderInput {
  externalOrderId: string;
  cliente?: {
    nombre?: string;
    documento?: string;
    email?: string;
    telefono?: string;
  };
  items: ExternalOrderItem[];
  observaciones?: string;
  metodoPago?: 'EFECTIVO' | 'DIGITAL' | 'CTA_CORRIENTE';
}
