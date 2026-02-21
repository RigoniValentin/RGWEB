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

  getDepositos: () =>
    api.get<Deposito[]>('/catalog/depositos').then(r => r.data),

  getPuntosVenta: () =>
    api.get<PuntoVenta[]>('/catalog/puntos-venta').then(r => r.data),
};
