import { create } from 'zustand';

// All known platform keys
export const CHATBOT_PLATFORMS = ['suri', 'evolution_api', 'kommo', 'take_blip', 'manychat', 'weni'] as const;
export const ECOMMERCE_PLATFORMS = ['shopify', 'woocommerce', 'tray', 'nuvemshop', 'vtex', 'custom'] as const;

export type PlatformKey = typeof CHATBOT_PLATFORMS[number] | typeof ECOMMERCE_PLATFORMS[number];

interface PlatformSettingsState {
  platforms: Record<string, boolean>;
  loaded: boolean;
  isPlatformEnabled: (key: string) => boolean;
  setSettings: (platforms: Record<string, boolean>) => void;
}

export const usePlatformSettingsStore = create<PlatformSettingsState>((set, get) => ({
  platforms: {},
  loaded: false,
  isPlatformEnabled: (key: string) => {
    const { platforms, loaded } = get();
    if (!loaded) return true; // default: enabled while loading
    // If a key was never set in DB, default to enabled (true)
    return platforms[key] !== false;
  },
  setSettings: (platforms) => set({ platforms, loaded: true }),
}));
