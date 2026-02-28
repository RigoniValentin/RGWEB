import { create } from 'zustand';

// ═══════════════════════════════════════════════════
//  Navigation Store — Cross-tab navigation events
// ═══════════════════════════════════════════════════
// Used to pass context (e.g. a CLIENTE_ID) when navigating
// between tabs, since components stay mounted and don't
// receive route params.

interface NavigationEvent {
  target: string;       // e.g. '/cta-corriente'
  payload: any;         // e.g. { clienteId: 123 }
  timestamp: number;    // to detect new events
}

interface NavigationState {
  event: NavigationEvent | null;
  /** Fire a navigation event. Consumer should clear it after processing. */
  navigate: (target: string, payload: any) => void;
  /** Clear the event after it's been consumed. */
  clearEvent: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  event: null,
  navigate: (target, payload) =>
    set({ event: { target, payload, timestamp: Date.now() } }),
  clearEvent: () => set({ event: null }),
}));
