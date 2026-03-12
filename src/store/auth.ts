import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

interface AuthState {
  token: string | null;
  user: User | null;
  darkMode: boolean;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  setDarkMode: (dark: boolean) => void;
  isAdmin: () => boolean;
  isAuthenticated: () => boolean;
}

// Aplica o tema no <html> imediatamente
function applyTheme(dark: boolean) {
  if (dark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      darkMode: false,

      setAuth: (token, user) => {
        set({ token, user });
        // Ao logar, aplica o tema salvo no store
        applyTheme(get().darkMode);
      },

      logout: () => {
        set({ token: null, user: null });
        // Mantém preferência de tema ao deslogar
      },

      setDarkMode: (dark: boolean) => {
        set({ darkMode: dark });
        applyTheme(dark);
      },

      isAdmin: () => get().user?.role === 'admin',
      isAuthenticated: () => !!get().token && !!get().user,
    }),
    {
      name: 'suri-auth',
      // Persiste token, user e darkMode
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        darkMode: state.darkMode,
      }),
      // Ao reidratar (ex: F5 ou nova aba), aplica o tema salvo
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.darkMode);
        }
      },
    }
  )
);
