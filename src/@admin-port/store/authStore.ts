import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface AuthState {
  isAuthenticated: boolean
  token: string | null
  setAuth: (token: string) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      token: null,
      setAuth: (token: string) => set({ token, isAuthenticated: true }),
      clearAuth: () => set({ token: null, isAuthenticated: false }),
    }),
    {
      name: 'auth_token',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)