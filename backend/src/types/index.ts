// ═══════════════════════════════════════════════════
//  SesamoDB Type Definitions
// ═══════════════════════════════════════════════════

// ── Auth / Usuarios ──────────────────────────────
export interface Usuario {
  USUARIO_ID: number;
  NOMBRE: string;
  CLAVE: string;
}

export interface PermisoAccion {
  USUARIO_ID: number;
  ACCION_ID: number;
  ACTIVO: boolean;
}

export interface AccionAcceso {
  ACCION_ID: number;
  DESCRIPCION: string;
  LLAVE: string;
}

// ── Productos ────────────────────────────────────
export interface Producto {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  DESCRIPCION: string | null;
  CANTIDAD: number;
  CATEGORIA_ID: number | null;
  PRECIO_COMPRA: number | null;
  MARCA_ID: number | null;
  FECHA_VENCIMIENTO: string | null;
  STOCK_MINIMO: number | null;
  UNIDAD_ID: number | null;
  ACTIVO: boolean;
  LISTA_1: number;
  LISTA_2: number;
  LISTA_3: number;
  LISTA_4: number;
  LISTA_5: number;
  LISTA_DEFECTO: number | null;
  COSTO_USD: number | null;
  MARGEN_INDIVIDUAL: boolean | null;
  TASA_IVA_ID: number | null;
  ES_CONJUNTO: boolean | null;
  DESCUENTA_STOCK: boolean;
  PRECIO_COMPRA_BASE: number;
  IMP_INT: number;
  // Joined fields
  CATEGORIA_NOMBRE?: string;
  MARCA_NOMBRE?: string;
  UNIDAD_NOMBRE?: string;
  UNIDAD_ABREVIACION?: string;
}

export interface ProductoCodBarras {
  ID: number;
  PRODUCTO_ID: number;
  CODIGO_BARRAS: string;
}

// ── Categorías ───────────────────────────────────
export interface Categoria {
  CATEGORIA_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  GUARDA_VENCIMIENTO: number | null;
  ACTIVA: boolean;
}

// ── Marcas ───────────────────────────────────────
export interface Marca {
  MARCA_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  ACTIVA: boolean;
}

// ── Clientes ─────────────────────────────────────
export interface Cliente {
  CLIENTE_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string | null;
  DOMICILIO: string | null;
  PROVINCIA: string | null;
  TELEFONO: string | null;
  EMAIL: string | null;
  ACTIVO: boolean;
  CTA_CORRIENTE: boolean;
  TIPO_DOCUMENTO: string;
  NUMERO_DOC: string;
  CONDICION_IVA: string | null;
}

// ── Proveedores ──────────────────────────────────
export interface Proveedor {
  PROVEEDOR_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  TELEFONO: string | null;
  EMAIL: string | null;
  DIRECCION: string | null;
  CIUDAD: string | null;
  CP: string | null;
  ACTIVO: boolean;
  CTA_CORRIENTE: boolean;
  TIPO_DOCUMENTO: string | null;
  NUMERO_DOC: string | null;
}

// ── Ventas ───────────────────────────────────────
export interface Venta {
  VENTA_ID: number;
  CLIENTE_ID: number;
  FECHA_VENTA: string;
  TOTAL: number;
  GANANCIAS: number | null;
  ES_CTA_CORRIENTE: boolean;
  MONTO_EFECTIVO: number | null;
  MONTO_DIGITAL: number | null;
  VUELTO: number | null;
  NUMERO_FISCAL: string | null;
  CAE: string | null;
  PUNTO_VENTA: string | null;
  TIPO_COMPROBANTE: string | null;
  COBRADA: boolean;
  PUNTO_VENTA_ID: number | null;
  USUARIO_ID: number | null;
  // Joined
  CLIENTE_NOMBRE?: string;
  USUARIO_NOMBRE?: string;
}

export interface VentaItem {
  ITEM_ID: number;
  VENTA_ID: number;
  PRODUCTO_ID: number;
  PRECIO_UNITARIO: number;
  CANTIDAD: number;
  PRECIO_UNITARIO_DTO: number;
  DESCUENTO: number;
  PROMOCION_ID: number | null;
  PRECIO_COMPRA: number | null;
  DEPOSITO_ID: number | null;
  LISTA_ID: number | null;
  // Joined
  PRODUCTO_NOMBRE?: string;
  PRODUCTO_CODIGO?: string;
}

// ── Compras ──────────────────────────────────────
export interface Compra {
  COMPRA_ID: number;
  PROVEEDOR_ID: number;
  FECHA_COMPRA: string;
  TOTAL: number;
  ES_CTA_CORRIENTE: boolean;
  COBRADA: boolean;
  TIPO_COMPROBANTE: string | null;
  PTO_VTA: string;
  NRO_COMPROBANTE: string;
  // Joined
  PROVEEDOR_NOMBRE?: string;
}

// ── Caja ─────────────────────────────────────────
export interface Caja {
  CAJA_ID: number;
  USUARIO_ID: number;
  FECHA_APERTURA: string;
  FECHA_CIERRE: string | null;
  MONTO_APERTURA: number;
  MONTO_CIERRE: number | null;
  OBSERVACIONES: string | null;
  ESTADO: string;
  PUNTO_VENTA_ID: number | null;
}

// ── Lista de Precios ─────────────────────────────
export interface ListaPrecio {
  LISTA_ID: number;
  CODIGOPARTICULAR: string | null;
  NOMBRE: string;
  DESCRIPCION: string | null;
  MARGEN: number;
  ACTIVA: boolean;
  MARGEN_REAL: number | null;
}

// ── Depósitos ────────────────────────────────────
export interface Deposito {
  DEPOSITO_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
}

// ── Unidades de Medida ───────────────────────────
export interface UnidadMedida {
  UNIDAD_ID: number;
  NOMBRE: string;
  ABREVIACION: string;
}

// ── Stock por depósito ───────────────────────────
export interface StockDeposito {
  ITEM_ID: number;
  PRODUCTO_ID: number;
  DEPOSITO_ID: number;
  CANTIDAD: number;
  DEPOSITO_NOMBRE?: string;
}

// ── Punto de Venta ───────────────────────────────
export interface PuntoVenta {
  PUNTO_VENTA_ID: number;
  NOMBRE: string;
  DIRECCION: string;
  COMENTARIOS: string | null;
  ACTIVO: boolean;
}

// ── Pagination helpers ───────────────────────────
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  search?: string;
}
