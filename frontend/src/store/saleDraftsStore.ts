import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ═══════════════════════════════════════════════════
//  Sale Drafts Store — Multiple simultaneous sales
//  Persisted to localStorage so drafts survive refresh
// ═══════════════════════════════════════════════════

export interface CartItem {
  key: string;
  PRODUCTO_ID: number;
  NOMBRE: string;
  CODIGO: string;
  PRECIO_UNITARIO: number;
  CANTIDAD: number;
  DESCUENTO: number;
  PRECIO_COMPRA: number;
  STOCK: number;
  UNIDAD: string;
  UNIDAD_NOMBRE: string;
  DEPOSITO_ID?: number;
  LISTA_ID?: number;
  DESDE_REMITO?: boolean;
  LISTA_1?: number;
  LISTA_2?: number;
  LISTA_3?: number;
  LISTA_4?: number;
  LISTA_5?: number;
}

export type ModalStep = 'cart' | 'cobro';

export interface SaleDraft {
  id: string;
  createdAt: number;
  label: string;

  // Cart
  cart: CartItem[];
  clienteId: number;
  depositoId: number | null;
  tipoComprobante: string;
  esCtaCorriente: boolean;
  dtoGral: number;

  // Item modes
  gramosMode: Record<string, boolean>;
  precioFinalMode: Record<string, boolean>;
  precioFinalValues: Record<string, number>;

  // Payment step
  step: ModalStep;
  selectedMetodos: number[];
  montosPorMetodo: Record<number, number>;

  // Print / delivery toggles
  wantPrint: boolean;
  wantWhatsApp: boolean;
  wantFacturar: boolean;
  wantFEPdf: boolean;
  wantFETicket: boolean;

  // Remitos
  selectedRemitoIds: number[];
}

const MAX_DRAFTS = 10;

let draftCounter = 1;

function createEmptyDraft(): SaleDraft {
  const id = crypto.randomUUID();
  const label = `Venta ${draftCounter++}`;
  return {
    id,
    createdAt: Date.now(),
    label,
    cart: [],
    clienteId: 1,
    depositoId: null,
    tipoComprobante: '',
    esCtaCorriente: false,
    dtoGral: 0,
    gramosMode: {},
    precioFinalMode: {},
    precioFinalValues: {},
    step: 'cart',
    selectedMetodos: [],
    montosPorMetodo: {},
    wantPrint: false,
    wantWhatsApp: false,
    wantFacturar: false,
    wantFEPdf: false,
    wantFETicket: false,
    selectedRemitoIds: [],
  };
}

interface SaleDraftsState {
  drafts: SaleDraft[];
  activeDraftId: string | null;

  /** Get the currently active draft (or undefined) */
  getActiveDraft: () => SaleDraft | undefined;

  /** Create a new empty draft and make it active. Returns the new draft id. */
  createDraft: () => string;

  /** Create a draft pre-populated with data (e.g. from pedido). Returns the new draft id. */
  createDraftFrom: (partial: Partial<SaleDraft>) => string;

  /** Remove a draft by id. Returns the new active draft id (or null). */
  removeDraft: (id: string) => string | null;

  /** Switch active draft */
  setActiveDraft: (id: string) => void;

  /** Partially update a draft */
  updateDraft: (id: string, partial: Partial<SaleDraft>) => void;

  /** Remove all drafts */
  clearAllDrafts: () => void;

  /** Remove drafts with empty carts; reset counter if none remain */
  purgeEmptyDrafts: () => void;

  /** Get draft count */
  draftCount: () => number;
}

export const useSaleDraftsStore = create<SaleDraftsState>()(
  persist(
    (set, get) => ({
      drafts: [],
      activeDraftId: null,

      getActiveDraft: () => {
        const { drafts, activeDraftId } = get();
        return drafts.find(d => d.id === activeDraftId);
      },

      createDraft: () => {
        const { drafts } = get();
        if (drafts.length >= MAX_DRAFTS) {
          return get().activeDraftId || '';
        }
        const draft = createEmptyDraft();
        set({ drafts: [...drafts, draft], activeDraftId: draft.id });
        return draft.id;
      },

      createDraftFrom: (partial) => {
        const { drafts } = get();
        if (drafts.length >= MAX_DRAFTS) {
          return get().activeDraftId || '';
        }
        const draft = { ...createEmptyDraft(), ...partial };
        // Ensure id is always fresh
        draft.id = crypto.randomUUID();
        draft.createdAt = Date.now();
        set({ drafts: [...drafts, draft], activeDraftId: draft.id });
        return draft.id;
      },

      removeDraft: (id) => {
        const { drafts, activeDraftId } = get();
        const newDrafts = drafts.filter(d => d.id !== id);
        let newActive = activeDraftId;
        if (activeDraftId === id) {
          const idx = drafts.findIndex(d => d.id === id);
          newActive = newDrafts[Math.min(idx, newDrafts.length - 1)]?.id ?? null;
        }
        set({ drafts: newDrafts, activeDraftId: newActive });
        return newActive;
      },

      setActiveDraft: (id) => {
        const { drafts } = get();
        if (drafts.find(d => d.id === id)) {
          set({ activeDraftId: id });
        }
      },

      updateDraft: (id, partial) => {
        set({
          drafts: get().drafts.map(d =>
            d.id === id ? { ...d, ...partial } : d
          ),
        });
      },

      clearAllDrafts: () => {
        draftCounter = 1;
        set({ drafts: [], activeDraftId: null });
      },

      purgeEmptyDrafts: () => {
        const { drafts, activeDraftId } = get();
        const remaining = drafts.filter(d => d.cart.length > 0);
        if (remaining.length === drafts.length) return; // nothing to purge
        if (remaining.length === 0) {
          draftCounter = 1;
          set({ drafts: [], activeDraftId: null });
          return;
        }
        let newActive = activeDraftId;
        if (!remaining.find(d => d.id === activeDraftId)) {
          newActive = remaining[0]!.id;
        }
        set({ drafts: remaining, activeDraftId: newActive });
      },

      draftCount: () => get().drafts.length,
    }),
    {
      name: 'rg-sale-drafts',
      version: 1,
      partialize: (state) => ({
        drafts: state.drafts,
        activeDraftId: state.activeDraftId,
      }),
      onRehydrateStorage: () => {
        // After rehydration, restore the counter to avoid label collisions
        return (state: SaleDraftsState | undefined) => {
          if (state?.drafts?.length) {
            const maxNum = state.drafts.reduce((max: number, d: SaleDraft) => {
              const match = d.label.match(/^Venta (\d+)$/);
              return match ? Math.max(max, parseInt(match[1]!, 10)) : max;
            }, 0);
            draftCounter = maxNum + 1;
          }
        };
      },
    }
  )
);
