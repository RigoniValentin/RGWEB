import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ParsedReceiptResponse } from '../services/purchases.api';
import type { ProductoCandidato } from '../services/purchases.api';

// ═══════════════════════════════════════════════════════════════════════════
//  Receipt Draft Store — persistencia del comprobante cargado vía imagen
//
//  Mientras el usuario revisa los datos extraídos por la IA, este store guarda
//  todo el estado en localStorage. Así, si cierra el modal accidentalmente,
//  refresca la página o navega, al reabrir "Cargar comprobante por imagen"
//  encuentra la revisión exactamente donde la dejó.
//
//  Al confirmar (botón "Aplicar al carrito") el draft se limpia y el path de
//  la imagen queda persistido en el purchaseDraftStore del modal principal
//  de Nueva Compra, desde donde viajará al backend al confirmar la compra.
// ═══════════════════════════════════════════════════════════════════════════

export interface ReceiptDraftLineItemDecision {
  cantidad: number;
  precio_unitario: number;
  descuento_porcentaje: number;
  /** Producto al que quedó ligado (manual desde candidatos o creado on-the-fly). */
  linked_producto_id: number | null;
  linked_producto?: ProductoCandidato;
  /** Si el usuario lo marcó para crear. */
  mark_as_new: boolean;
  /** Si el usuario lo excluye del envío. */
  excluded: boolean;
}

export type ReceiptDraftStatus = 'idle' | 'review';

export interface ReceiptDraft {
  /** Snapshot completo de lo que devolvió la IA (incluye saved_path de la imagen). */
  parsed: ParsedReceiptResponse | null;
  /** Estado del modal al persistir: 'review' si el usuario ya está revisando. */
  status: ReceiptDraftStatus;

  // Encabezado editable
  proveedorId: number | null;
  proveedorNombre: string;
  proveedorCUIT: string;
  proveedorCrear: boolean;
  tipoComprobante: string;
  ptoVta: string;
  nroComprobante: string;
  fechaEmision: string | null; // ISO

  /** Decisiones por índice de ítem. */
  decisions: Record<number, ReceiptDraftLineItemDecision>;
  /** Overrides del código de proveedor por índice. */
  codigoProveedorOverrides: Record<number, string>;
  /** Fila cuyo código está en modo edición. */
  editingCode: number | null;
}

const EMPTY_DRAFT: ReceiptDraft = {
  parsed: null,
  status: 'idle',
  proveedorId: null,
  proveedorNombre: '',
  proveedorCUIT: '',
  proveedorCrear: false,
  tipoComprobante: 'FB',
  ptoVta: '0000',
  nroComprobante: '00000000',
  fechaEmision: null,
  decisions: {},
  codigoProveedorOverrides: {},
  editingCode: null,
};

interface ReceiptDraftState {
  draft: ReceiptDraft;
  /** Update one or more fields on the draft */
  updateDraft: (partial: Partial<ReceiptDraft>) => void;
  /** Clear back to defaults */
  clearDraft: () => void;
  /** Returns true if the draft has meaningful data (a parsed receipt persisted) */
  hasDraft: () => boolean;
  /** Replace a single decision entry */
  setDecision: (idx: number, decision: ReceiptDraftLineItemDecision) => void;
}

export const useReceiptDraftStore = create<ReceiptDraftState>()(
  persist(
    (set, get) => ({
      draft: { ...EMPTY_DRAFT },

      updateDraft: (partial) => {
        set({ draft: { ...get().draft, ...partial } });
      },

      clearDraft: () => {
        set({ draft: { ...EMPTY_DRAFT } });
      },

      setDecision: (idx, decision) => {
        const next = { ...get().draft.decisions, [idx]: decision };
        set({ draft: { ...get().draft, decisions: next } });
      },

      hasDraft: () => Boolean(get().draft.parsed),
    }),
    {
      name: 'rg-receipt-draft',
      version: 1,
      partialize: (state) => ({ draft: state.draft }),
    }
  )
);

// ── Helpers ──────────────────────────────────────────────────────────────
export function derivePublicUrlFromSavedPath(savedPath: string): string {
  // savedPath viene como 'uploads/comprobantes/2026-08/3_xxx.jpg'
  // El frontend sirve /uploads/* estáticamente.
  if (!savedPath) return '';
  return savedPath.startsWith('/') ? savedPath : `/${savedPath}`;
}
