import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Usuario, PuntoVentaAsignado } from '../types';

interface AuthState {
  user: Usuario | null;
  token: string | null;
  permisos: string[];
  puntosVenta: PuntoVentaAsignado[];
  puntoVentaActivo: number | null;
  isAuthenticated: boolean;
  setAuth: (user: Usuario, token: string, permisos: string[], puntosVenta: PuntoVentaAsignado[]) => void;
  setPuntoVentaActivo: (id: number) => void;
  logout: () => void;
  hasPermiso: (llave: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      permisos: [],
      puntosVenta: [],
      puntoVentaActivo: null,
      isAuthenticated: false,

      setAuth: (user, token, permisos, puntosVenta) => {
        const preferido = puntosVenta.find(pv => pv.ES_PREFERIDO);
        set({
          user,
          token,
          permisos,
          puntosVenta,
          puntoVentaActivo: preferido?.PUNTO_VENTA_ID || puntosVenta[0]?.PUNTO_VENTA_ID || null,
          isAuthenticated: true,
        });
      },

      setPuntoVentaActivo: (id) => set({ puntoVentaActivo: id }),

      logout: () =>
        set({
          user: null,
          token: null,
          permisos: [],
          puntosVenta: [],
          puntoVentaActivo: null,
          isAuthenticated: false,
        }),

      hasPermiso: (llave) => get().permisos.includes(llave),
    }),
    {
      name: 'rg-erp-auth',
    }
  )
);
