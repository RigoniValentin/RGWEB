import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Usuario, PuntoVentaAsignado, RolBasico } from '../types';

interface AuthState {
  user: Usuario | null;
  token: string | null;
  permisos: string[];
  roles: RolBasico[];
  puntosVenta: PuntoVentaAsignado[];
  puntoVentaActivo: number | null;
  isAuthenticated: boolean;
  setAuth: (user: Usuario, token: string, permisos: string[], puntosVenta: PuntoVentaAsignado[], roles?: RolBasico[]) => void;
  setPuntoVentaActivo: (id: number) => void;
  logout: () => void;
  hasPermiso: (llave: string) => boolean;
  isCajero: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      permisos: [],
      roles: [],
      puntosVenta: [],
      puntoVentaActivo: null,
      isAuthenticated: false,

      setAuth: (user, token, permisos, puntosVenta, roles = []) => {
        const preferido = puntosVenta.find(pv => pv.ES_PREFERIDO);
        set({
          user,
          token,
          permisos,
          roles,
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
          roles: [],
          puntosVenta: [],
          puntoVentaActivo: null,
          isAuthenticated: false,
        }),

      hasPermiso: (llave) => get().permisos.includes(llave),
      isCajero: () => (get().roles ?? []).some(r => r.NOMBRE.toUpperCase() === 'CAJERO'),
    }),
    {
      name: 'rg-erp-auth',
    }
  )
);
