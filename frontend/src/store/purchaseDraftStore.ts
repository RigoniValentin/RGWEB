import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CompraItemInput } from '../types';

// ═══════════════════════════════════════════════════
//  Purchase Draft Store — single draft persistence
//  Persisted to localStorage so the draft survives
//  accidental modal close or page refresh
// ═══════════════════════════════════════════════════

export interface PurchaseCartItem extends CompraItemInput {
  key: string;
  NOMBRE: string;
  CODIGO: string;
  STOCK: number;
  UNIDAD: string;
  IVA_PORCENTAJE: number;
  PRECIO_FINAL: number;
}

export type PurchaseModalStep = 'cart' | 'pago';

export interface PurchaseDraft {
  cart: PurchaseCartItem[];
  proveedorId: number | null;
  depositoId: number | null;
  tipoComprobante: string;
  ptoVta: string;
  nroComprobante: string;
  esCtaCorriente: boolean;
  ivaIncluido: boolean;
  ivaManual: number;
  actualizarCostos: boolean;
  actualizarPrecios: boolean;
  percepcionIva: number;
  percepcionIibb: number;
  tipoCarga: 'simple' | 'detallada';
  impIntGravaIva: boolean;
  step: PurchaseModalStep;
  selectedMetodos: number[];
  montosPorMetodo: Record<number, number>;
  destinoPago: 'CAJA_CENTRAL' | 'CAJA';
}

const EMPTY_DRAFT: PurchaseDraft = {
  cart: [],
  proveedorId: null,
  depositoId: null,
  tipoComprobante: 'FB',
  ptoVta: '0000',
  nroComprobante: '00000000',
  esCtaCorriente: false,
  ivaIncluido: true,
  ivaManual: 0,
  actualizarCostos: true,
  actualizarPrecios: true,
  percepcionIva: 0,
  percepcionIibb: 0,
  tipoCarga: 'detallada',
  impIntGravaIva: false,
  step: 'cart',
  selectedMetodos: [],
  montosPorMetodo: {},
  destinoPago: 'CAJA_CENTRAL',
};

interface PurchaseDraftState {
  draft: PurchaseDraft;

  /** Update one or more fields on the draft */
  updateDraft: (partial: Partial<PurchaseDraft>) => void;

  /** Clear the draft back to defaults */
  clearDraft: () => void;

  /** Returns true if the draft has meaningful data (non-empty cart) */
  hasDraft: () => boolean;

  /** Purge draft if cart is empty */
  purgeIfEmpty: () => void;
}

export const usePurchaseDraftStore = create<PurchaseDraftState>()(
  persist(
    (set, get) => ({
      draft: { ...EMPTY_DRAFT },

      updateDraft: (partial) => {
        set({ draft: { ...get().draft, ...partial } });
      },

      clearDraft: () => {
        set({ draft: { ...EMPTY_DRAFT } });
      },

      hasDraft: () => get().draft.cart.length > 0,

      purgeIfEmpty: () => {
        if (get().draft.cart.length === 0) {
          set({ draft: { ...EMPTY_DRAFT } });
        }
      },
    }),
    {
      name: 'rg-purchase-draft',
      version: 1,
      partialize: (state) => ({ draft: state.draft }),
    }
  )
);
