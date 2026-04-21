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

  /** Reset user settings for a specific module */
  resetModule: (modulo: string) =>
    api.delete('/settings/user', { params: { modulo } }).then(r => r.data),

  /** Get company logo as blob URL */
  getLogo: async (): Promise<string | null> => {
    try {
      const res = await api.get('/settings/logo', { responseType: 'blob' });
      return URL.createObjectURL(res.data);
    } catch {
      return null;
    }
  },

  /** Get company logo as base64 data URL (for PDF embedding) */
  getLogoDataUrl: async (): Promise<string | null> => {
    try {
      const res = await api.get('/settings/logo', { responseType: 'blob' });
      const blob: Blob = res.data;
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  },

  /** Upload company logo */
  uploadLogo: (file: File) =>
    api.put('/settings/logo', file, {
      headers: { 'Content-Type': file.type },
    }).then(r => r.data),

  /** Delete company logo */
  deleteLogo: () =>
    api.delete('/settings/logo').then(r => r.data),
};
