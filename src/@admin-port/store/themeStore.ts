import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

type ThemeValue = 'midnight' | 'slate' | 'emerald' | 'light'

interface ThemeState {
  theme: ThemeValue
  setTheme: (theme: string) => void
}

const VALID_THEMES: ThemeValue[] = ['midnight', 'slate', 'emerald', 'light']

function applyTheme(theme: ThemeValue): void {
  document.body.className = 'theme-' + theme
  document.body.classList.toggle('light', theme === 'light')
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'slate',
      setTheme: (theme: string) => {
        if (!VALID_THEMES.includes(theme as ThemeValue)) return
        const validated = theme as ThemeValue
        set({ theme: validated })
        applyTheme(validated)
      },
    }),
    {
      name: 'theme',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme)
        }
      },
    },
  ),
)