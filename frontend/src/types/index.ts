// ═══════════════════════════════════════════════════
//  Frontend Type Definitions (mirrors SesamoDB)
// ═══════════════════════════════════════════════════

// ── Auth ─────────────────────────────────────────
export interface Usuario {
  USUARIO_ID: number;
  NOMBRE: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  user: Usuario;
  permisos: string[];
  puntosVenta: PuntoVentaAsignado[];
  token: string;
}

export interface PuntoVentaAsignado {
  PUNTO_VENTA_ID: number;
  NOMBRE: string;
  ES_PREFERIDO: boolean;
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
  TASA_IVA_ID: number | null;
  ES_CONJUNTO: boolean | null;
  DESCUENTA_STOCK: boolean;
  PRECIO_COMPRA_BASE: number;
  IMP_INT: number;
  FECHA_VENCIMIENTO: string | null;
  MARGEN_INDIVIDUAL: boolean | null;
  // Joined
  CATEGORIA_NOMBRE?: string;
  MARCA_NOMBRE?: string;
  UNIDAD_NOMBRE?: string;
  UNIDAD_ABREVIACION?: string;
  codigosBarras?: string[];
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

// ── Métodos de Pago ──────────────────────────────
export interface MetodoPago {
  METODO_PAGO_ID: number;
  NOMBRE: string;
  CATEGORIA: 'EFECTIVO' | 'DIGITAL';
  IMAGEN_BASE64: string | null;
  ACTIVA: boolean;
  POR_DEFECTO: boolean;
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
  MONTO_ANTICIPO: number | null;
  DTO_GRAL: number | null;
  ERROR_FE: string | null;
  ERRORES: string | null;
  NRO_ENVIO_DETALLE: string | null;
  NOMBRE_ENVIO_DETALLE: string | null;
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
  CANTIDAD_PROMO: number | null;
  PRECIO_PROMOCION: number | null;
  PRECIO_COMPRA: number | null;
  DEPOSITO_ID: number | null;
  LISTA_ID: number | null;
  IMPUESTO_INTERNO_PORCENTAJE: number | null;
  IMPUESTO_INTERNO_MONTO: number | null;
  IMPUESTO_INTERNO_TIPO: number | null;
  IVA_ALICUOTA: number | null;
  IVA_MONTO: number | null;
  CANTIDAD_PRODUCTOS_PROMO: number | null;
  PRODUCTO_NOMBRE?: string;
  PRODUCTO_CODIGO?: string;
  UNIDAD_ABREVIACION?: string;
}

export interface VentaMetodoPago {
  ID: number;
  VENTA_ID: number;
  METODO_PAGO_ID: number;
  MONTO: number;
  METODO_NOMBRE?: string;
  METODO_CATEGORIA?: 'EFECTIVO' | 'DIGITAL';
}

export interface MetodoPagoItem {
  METODO_PAGO_ID: number;
  MONTO: number;
}

export interface DesgloseMetodo {
  METODO_PAGO_ID: number;
  NOMBRE: string;
  CATEGORIA: 'EFECTIVO' | 'DIGITAL';
  IMAGEN_BASE64: string | null;
  TOTAL: number;
}

export interface VentaDetalle extends Venta {
  items: VentaItem[];
}

export interface VentaItemInput {
  PRODUCTO_ID: number;
  PRECIO_UNITARIO: number;
  CANTIDAD: number;
  DESCUENTO: number;
  PRECIO_COMPRA: number;
  DEPOSITO_ID?: number;
  LISTA_ID?: number;
  PROMOCION_ID?: number | null;
  CANTIDAD_PROMO?: number | null;
  PRECIO_PROMOCION?: number | null;
  IMPUESTO_INTERNO_PORCENTAJE?: number;
  IMPUESTO_INTERNO_MONTO?: number;
  IMPUESTO_INTERNO_TIPO?: number;
  IVA_ALICUOTA?: number;
  IVA_MONTO?: number;
  CANTIDAD_PRODUCTOS_PROMO?: number;
  NOMBRE?: string;
  CODIGO?: string;
}

export interface VentaInput {
  CLIENTE_ID: number;
  FECHA_VENTA?: string;
  TIPO_COMPROBANTE?: string;
  PUNTO_VENTA_ID: number;
  ES_CTA_CORRIENTE?: boolean;
  MONTO_EFECTIVO?: number;
  MONTO_DIGITAL?: number;
  VUELTO?: number;
  DTO_GRAL?: number;
  COBRADA?: boolean;
  items: VentaItemInput[];
  metodos_pago?: MetodoPagoItem[];
  PEDIDO_ID?: number;
  MESA_ID?: number;
}

export interface PaymentInput {
  MONTO_EFECTIVO: number;
  MONTO_DIGITAL: number;
  VUELTO: number;
  parcial?: boolean;
  metodos_pago?: MetodoPagoItem[];
}

export interface ProductoSearch {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  PRECIO_VENTA: number;
  LISTA_DEFECTO: number;
  PRECIO_COMPRA: number;
  STOCK: number;
  ES_CONJUNTO: boolean | null;
  DESCUENTA_STOCK: boolean;
  IMP_INT: number;
  TASA_IVA_ID: number | null;
  UNIDAD_ID: number | null;
  UNIDAD_NOMBRE: string;
  UNIDAD_ABREVIACION: string;
  IVA_PORCENTAJE: number;
}

export interface ProductoSearchAdvanced extends ProductoSearch {
  MARCA: string;
  CATEGORIA: string;
}

export interface ClienteVenta {
  CLIENTE_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  CONDICION_IVA: string | null;
  CTA_CORRIENTE: boolean;
  TIPO_DOCUMENTO: string;
  NUMERO_DOC: string;
}

// ── Catálogos ────────────────────────────────────
export interface ListaPrecio {
  LISTA_ID: number;
  NOMBRE: string;
  MARGEN: number;
  ACTIVA: boolean;
}

export interface Deposito {
  DEPOSITO_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
}

export interface UnidadMedida {
  UNIDAD_ID: number;
  NOMBRE: string;
  ABREVIACION: string;
}

export interface PuntoVenta {
  PUNTO_VENTA_ID: number;
  NOMBRE: string;
  ACTIVO: boolean;
}

export interface StockDeposito {
  ITEM_ID: number;
  PRODUCTO_ID: number;
  DEPOSITO_ID: number;
  CANTIDAD: number;
  DEPOSITO_NOMBRE?: string;
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
  USUARIO_NOMBRE?: string;
  PUNTO_VENTA_NOMBRE?: string;
}

export interface CajaItem {
  ITEM_ID: number;
  CAJA_ID: number;
  FECHA: string;
  ORIGEN_TIPO: string;
  ORIGEN_ID: number | null;
  MONTO_EFECTIVO: number;
  MONTO_DIGITAL: number;
  DESCRIPCION: string | null;
  USUARIO_ID: number;
  USUARIO_NOMBRE?: string;
}

export interface CajaDetalle extends Caja {
  items: CajaItem[];
  totales: {
    efectivo: number;
    digital: number;
    ingresos: number;
    egresos: number;
  };
}

export interface AbrirCajaInput {
  MONTO_APERTURA: number;
  PUNTO_VENTA_ID: number;
  OBSERVACIONES?: string;
}

export interface CerrarCajaInput {
  MONTO_CIERRE?: number;
  OBSERVACIONES?: string;
  DEPOSITO_FONDO?: number;
  DESCRIPCION_DEPOSITO?: string;
}

export interface IngresoEgresoInput {
  tipo: 'INGRESO' | 'EGRESO';
  monto: number;
  descripcion: string;
}

// ── Caja Central ─────────────────────────────────
export interface MovimientoCaja {
  ID: number;
  ID_ENTIDAD: number | null;
  CAJA_ID: number | null;
  TIPO_ENTIDAD: string;
  FECHA: string;
  MOVIMIENTO: string;
  USUARIO_ID: number | null;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  CTA_CTE: number;
  TOTAL: number;
  PUNTO_VENTA_ID: number | null;
  ES_MANUAL: boolean;
  USUARIO_NOMBRE?: string;
}

export interface CajaCentralTotales {
  totalIngresos: number;
  totalEgresos: number;
  balance: number;
  efectivo: number;
  digital: number;
  cheques: number;
  ctaCte: number;
}

export interface NuevoMovimientoInput {
  tipo: 'INGRESO' | 'EGRESO';
  descripcion: string;
  cheques?: number;
  ctaCte?: number;
  puntoVentaId?: number;
  metodos_pago?: MetodoPagoItem[];
}

export interface FondoCambio {
  ID: number;
  FECHA: string;
  CAJA_ID: number | null;
  TIPO_MOVIMIENTO: string;
  MONTO: number;
  SALDO_RESULTANTE: number;
  USUARIO_ID: number | null;
  PUNTO_VENTA_ID: number | null;
  OBSERVACIONES: string | null;
  USUARIO_NOMBRE?: string;
}

// ── Dashboard ────────────────────────────────────
export interface DashboardStats {
  totalClientes: number;
  totalProductos: number;
  totalProveedores: number;
  ventasHoy: number;
  montoHoy: number;
  gananciaHoy: number;
  efectivoHoy: number;
  digitalHoy: number;
  ventasMes: number;
  montoMes: number;
  gananciaMes: number;
  productosStockBajo: { PRODUCTO_ID: number; CODIGOPARTICULAR: string; NOMBRE: string; CANTIDAD: number; STOCK_MINIMO: number }[];
  ventasRecientes: { VENTA_ID: number; FECHA_VENTA: string; TOTAL: number; TIPO_COMPROBANTE: string; CLIENTE_NOMBRE: string }[];
  cajasAbiertas: { CAJA_ID: number; FECHA_APERTURA: string; MONTO_APERTURA: number; ESTADO: string; USUARIO_NOMBRE: string; PUNTO_VENTA_NOMBRE: string }[];
}

export interface VentaDiaria {
  fecha: string;
  cantidad: number;
  total: number;
  ganancia: number;
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
  PTO_VTA: string | null;
  NRO_COMPROBANTE: string | null;
  MONTO_EFECTIVO: number;
  MONTO_DIGITAL: number;
  VUELTO: number;
  MONTO_ANTICIPO: number;
  PRECIOS_SIN_IVA: boolean;
  PERCEPCION_IVA: number;
  PERCEPCION_IIBB: number;
  IMPUESTO_INTERNO: number;
  IVA_TOTAL: number;
  BONIFICACION_TOTAL: number;
  IMP_INT_GRAVA_IVA: boolean;
  PROVEEDOR_NOMBRE?: string;
  PROVEEDOR_CODIGO?: string;
}

export interface CompraItem {
  COMPRA_ID: number;
  PRODUCTO_ID: number;
  PRECIO_COMPRA: number;
  CANTIDAD: number;
  TOTAL_PRODUCTO: number;
  DEPOSITO_ID: number | null;
  PORCENTAJE_DESCUENTO: number;
  DESCUENTO_IMPORTE: number;
  TASA_IVA_ID: number | null;
  IVA_ALICUOTA: number;
  IVA_IMPORTE: number;
  IMP_INTERNO_IMPORTE: number;
  PRODUCTO_NOMBRE?: string;
  PRODUCTO_CODIGO?: string;
  UNIDAD_ABREVIACION?: string;
}

export interface CompraDetalle extends Compra {
  items: CompraItem[];
}

export interface CompraItemInput {
  PRODUCTO_ID: number;
  PRECIO_COMPRA: number;
  CANTIDAD: number;
  DEPOSITO_ID?: number;
  BONIFICACION: number;
  IMP_INTERNOS: number;
  IVA_ALICUOTA?: number;
  TASA_IVA_ID?: number | null;
  NOMBRE?: string;
  CODIGO?: string;
}

export interface CompraInput {
  PROVEEDOR_ID: number;
  FECHA_COMPRA?: string;
  TIPO_COMPROBANTE?: string;
  PTO_VTA?: string;
  NRO_COMPROBANTE?: string;
  ES_CTA_CORRIENTE?: boolean;
  MONTO_EFECTIVO?: number;
  MONTO_DIGITAL?: number;
  VUELTO?: number;
  COBRADA?: boolean;
  PRECIOS_SIN_IVA?: boolean;
  IMP_INT_GRAVA_IVA?: boolean;
  PERCEPCION_IVA?: number;
  PERCEPCION_IIBB?: number;
  IVA_TOTAL?: number;
  ACTUALIZAR_COSTOS?: boolean;
  ACTUALIZAR_PRECIOS?: boolean;
  DESTINO_PAGO?: 'CAJA_CENTRAL' | 'CAJA';
  items: CompraItemInput[];
  metodos_pago?: MetodoPagoItem[];
}

export interface ProveedorCompra {
  PROVEEDOR_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  CTA_CORRIENTE: boolean;
  TIPO_DOCUMENTO: string | null;
  NUMERO_DOC: string | null;
}

export interface ProductoSearchCompra {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  PRECIO_COMPRA: number;
  STOCK: number;
  ES_CONJUNTO: boolean | null;
  DESCUENTA_STOCK: boolean;
  IMP_INT: number;
  TASA_IVA_ID: number | null;
  UNIDAD_ID: number | null;
  UNIDAD_NOMBRE: string;
  UNIDAD_ABREVIACION: string;
  IVA_PORCENTAJE: number;
}

// ── Pagination ───────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
// ── Fondo de Cambio Transfers ────────────────────────────
export type TransferEntity = 'CAJA_CENTRAL' | 'FONDO_CAMBIO' | 'CAJA';

export interface TransferFCInput {
  origen: TransferEntity;
  destino: TransferEntity;
  monto: number;
  observaciones?: string;
  cajaId?: number;
  puntoVentaId?: number;
}

export interface CajaAbierta {
  CAJA_ID: number;
  USUARIO_ID: number;
  FECHA_APERTURA: string;
  MONTO_APERTURA: number;
  PUNTO_VENTA_ID: number | null;
  USUARIO_NOMBRE: string;
  PUNTO_VENTA_NOMBRE: string;
  EFECTIVO_DISPONIBLE: number;
}

// ── Gastronomía (Mesas) ──────────────────────────
export interface Sector {
  SECTOR_ID: number;
  NOMBRE: string;
  ACTIVO: boolean;
  PUNTO_VENTA_ID: number | null;
}

export interface Mesa {
  MESA_ID: number;
  NUMERO_MESA: string;
  SECTOR_ID: number;
  CAPACIDAD: number;
  ESTADO: 'LIBRE' | 'OCUPADA' | 'RESERVADA';
  ACTIVO: boolean;
  POSICION_X: number;
  POSICION_Y: number;
  PUNTO_VENTA_ID: number | null;
  SECTOR_NOMBRE?: string;
  PEDIDOS_ACTIVOS?: number;
}

export interface Pedido {
  PEDIDO_ID: number;
  MESA_ID: number | null;
  ESTADO: 'ABIERTO' | 'EN_PREPARACION' | 'CERRADO';
  FECHA_CREACION: string;
  FECHA_CIERRE: string | null;
  TOTAL: number;
  PUNTO_VENTA_ID: number | null;
  MOZO: string | null;
  MESA_NUMERO?: string;
}

export interface PedidoItem {
  PEDIDO_ITEM_ID: number;
  PEDIDO_ID: number;
  PRODUCTO_ID: number | null;
  PROMOCION_ID: number | null;
  CANTIDAD: number;
  PRECIO_UNITARIO: number;
  PUNTO_VENTA_ID: number | null;
  TIPO_SERVICIO_ID: number | null;
  LISTA_PRECIO_SELECCIONADA: number;
  PRODUCTO_NOMBRE?: string;
  PRODUCTO_CODIGO?: string;
}

export interface PedidoDetalle extends Pedido {
  items: PedidoItem[];
}

export interface ProductoSearchMesa {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  PRECIO_VENTA: number;
  LISTA_DEFECTO: number;
  STOCK: number;
  UNIDAD_ABREVIACION: string;
}