import { create } from 'zustand';

// ═══════════════════════════════════════════════════
//  Tab Store — Multi-tab workspace management
// ═══════════════════════════════════════════════════

export interface TabItem {
  key: string;      // route path e.g. '/products'
  label: string;    // display name e.g. 'Productos'
  closable: boolean;
}

interface TabState {
  tabs: TabItem[];
  activeKey: string;
  /** Open (or activate) a tab. Returns the active key. */
  openTab: (tab: TabItem) => void;
  /** Close a tab. Returns the new active key for navigation. */
  closeTab: (key: string) => string;
  /** Switch to an already-open tab. */
  setActiveTab: (key: string) => void;
  /** Close all closable tabs. */
  closeAll: () => string;
  /** Close all closable tabs *except* the given key. */
  closeOthers: (key: string) => void;
}

const DEFAULT_TAB: TabItem = { key: '/dashboard', label: 'Dashboard', closable: false };

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [DEFAULT_TAB],
  activeKey: '/dashboard',

  openTab: (tab) => {
    const { tabs } = get();
    const exists = tabs.find(t => t.key === tab.key);
    if (!exists) {
      set({ tabs: [...tabs, tab], activeKey: tab.key });
    } else {
      set({ activeKey: tab.key });
    }
  },

  closeTab: (key) => {
    const { tabs, activeKey } = get();
    const target = tabs.find(t => t.key === key);
    if (!target || !target.closable) return activeKey;

    const newTabs = tabs.filter(t => t.key !== key);
    let newActive = activeKey;
    if (activeKey === key) {
      // Activate the next tab, or the previous one
      const idx = tabs.findIndex(t => t.key === key);
      newActive = newTabs[Math.min(idx, newTabs.length - 1)]?.key || '/dashboard';
    }
    set({ tabs: newTabs, activeKey: newActive });
    return newActive;
  },

  setActiveTab: (key) => {
    const { tabs } = get();
    if (tabs.find(t => t.key === key)) {
      set({ activeKey: key });
    }
  },

  closeAll: () => {
    set({ tabs: [DEFAULT_TAB], activeKey: '/dashboard' });
    return '/dashboard';
  },

  closeOthers: (key) => {
    const { tabs } = get();
    const kept = tabs.filter(t => !t.closable || t.key === key);
    const newActive = kept.find(t => t.key === key) ? key : '/dashboard';
    set({ tabs: kept, activeKey: newActive });
  },
}));
