import { create } from 'zustand';
import { settingsApi, type ConfigResuelto, type SaveSettingInput } from '../services/settings.api';

// ═══════════════════════════════════════════════════
//  Settings Store — Global access to user settings
//  Loads once on login, provides getters by clave
// ═══════════════════════════════════════════════════

interface SettingsState {
  settings: ConfigResuelto[];
  loaded: boolean;
  loading: boolean;

  /** Fetch all settings from the server */
  fetchSettings: () => Promise<void>;

  /** Get a resolved value by CLAVE (returns string or null) */
  get: (clave: string) => string | null;

  /** Get a boolean value by CLAVE */
  getBool: (clave: string) => boolean;

  /** Get a setting object by CLAVE */
  getParam: (clave: string) => ConfigResuelto | undefined;

  /** Get settings grouped by module → submodule */
  getGrouped: () => Record<string, Record<string, ConfigResuelto[]>>;

  /** Save user-level settings and refresh */
  saveUserSettings: (items: SaveSettingInput[]) => Promise<void>;

  /** Reset one setting to default and refresh */
  resetSetting: (parametroId: number) => Promise<void>;

  /** Reset all settings to default and refresh */
  resetAll: () => Promise<void>;

  /** Clear store (on logout) */
  clear: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: [],
  loaded: false,
  loading: false,

  fetchSettings: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const data = await settingsApi.getAll();
      set({ settings: data, loaded: true, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  get: (clave: string) => {
    const param = get().settings.find(s => s.CLAVE === clave);
    return param?.VALOR ?? param?.VALOR_DEFECTO ?? null;
  },

  getBool: (clave: string) => {
    const val = get().get(clave);
    return val === 'true' || val === '1';
  },

  getParam: (clave: string) => {
    return get().settings.find(s => s.CLAVE === clave);
  },

  getGrouped: () => {
    const grouped: Record<string, Record<string, ConfigResuelto[]>> = {};
    for (const s of get().settings) {
      const mod = s.MODULO;
      const sub = s.SUBMODULO || '_general';
      if (!grouped[mod]) grouped[mod] = {};
      if (!grouped[mod][sub]) grouped[mod][sub] = [];
      grouped[mod][sub].push(s);
    }
    return grouped;
  },

  saveUserSettings: async (items) => {
    await settingsApi.saveUser(items);
    await get().fetchSettings();
  },

  resetSetting: async (parametroId) => {
    await settingsApi.resetOne(parametroId);
    await get().fetchSettings();
  },

  resetAll: async () => {
    await settingsApi.resetAll();
    await get().fetchSettings();
  },

  clear: () => set({ settings: [], loaded: false, loading: false }),
}));
