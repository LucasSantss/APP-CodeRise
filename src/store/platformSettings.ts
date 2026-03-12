import { create } from 'zustand';

interface PlatformSettingsState {
  chatbotEnabled: boolean;
  ecommerceEnabled: boolean;
  loaded: boolean;
  setSettings: (settings: { chatbot_enabled: boolean; ecommerce_enabled: boolean }) => void;
}

export const usePlatformSettingsStore = create<PlatformSettingsState>((set) => ({
  chatbotEnabled: true,
  ecommerceEnabled: true,
  loaded: false,
  setSettings: (settings) =>
    set({
      chatbotEnabled: settings.chatbot_enabled,
      ecommerceEnabled: settings.ecommerce_enabled,
      loaded: true,
    }),
}));
