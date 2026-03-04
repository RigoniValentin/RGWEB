import api from './api';

// ═══════════════════════════════════════════════════
//  Settings API — System configuration endpoints
// ═══════════════════════════════════════════════════

export interface ConfigResuelto {
  PARAMETRO_ID: number;
  MODULO: string;
  SUBMODULO: string | null;
  CLAVE: string;
  DESCRIPCION: string;
  TIPO: 'boolean' | 'text' | 'number' | 'select' | 'shortcut';
  OPCIONES: string | null;
  VALOR_DEFECTO: string | null;
  ORDEN: number;
  ACTIVO: boolean;
  VALOR: string | null;
  ORIGEN: 'usuario' | 'global' | 'defecto';
}

export interface SaveSettingInput {
  PARAMETRO_ID: number;
  VALOR: string;
}

export const settingsApi = {
  /** Get all resolved settings for the current user */
  getAll: () =>
    api.get<ConfigResuelto[]>('/settings').then(r => r.data),

  /** Get a single resolved value by CLAVE */
  getValue: (clave: string) =>
    api.get<{ clave: string; valor: string | null }>(`/settings/value/${clave}`).then(r => r.data),

  /** Save user-level settings (batch) */
  saveUser: (settings: SaveSettingInput[]) =>
    api.put('/settings/user', { settings }).then(r => r.data),

  /** Save global settings (admin) */
  saveGlobal: (settings: SaveSettingInput[]) =>
    api.put('/settings/global', { settings }).then(r => r.data),

  /** Reset a single user setting back to default */
  resetOne: (parametroId: number) =>
    api.delete(`/settings/user/${parametroId}`).then(r => r.data),

  /** Reset ALL user settings */
  resetAll: () =>
    api.delete('/settings/user').then(r => r.data),
};
