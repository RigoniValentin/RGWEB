import api from './api';
import type { Categoria, Marca, UnidadMedida, ListaPrecio, Deposito, PuntoVenta } from '../types';

export const catalogApi = {
  getCategorias: () =>
    api.get<Categoria[]>('/catalog/categorias').then(r => r.data),

  getMarcas: () =>
    api.get<Marca[]>('/catalog/marcas').then(r => r.data),

  getUnidades: () =>
    api.get<UnidadMedida[]>('/catalog/unidades').then(r => r.data),

  getListasPrecios: () =>
    api.get<ListaPrecio[]>('/catalog/listas-precios').then(r => r.data),

  getDepositos: (puntoVentaIds?: number[]) => {
    const params = puntoVentaIds && puntoVentaIds.length > 0
      ? { puntoVentaIds: puntoVentaIds.join(',') }
      : undefined;
    return api.get<Deposito[]>('/catalog/depositos', { params }).then(r => r.data);
  },

  getPuntosVenta: () =>
    api.get<PuntoVenta[]>('/catalog/puntos-venta').then(r => r.data),
};
