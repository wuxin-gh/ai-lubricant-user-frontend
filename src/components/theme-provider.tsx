import { useEffect, useMemo, useState } from "react"
import { ThemeProviderContext, type AppliedTheme, type Theme } from "./theme-context"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light" || value === "system"
}

function getSystemTheme(): AppliedTheme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
  } catch {
    return "light"
  }
}

// 新 key 读不到时从旧 key「monkeycode-theme」一次性迁移过来。
// index.html 的 pre-React 脚本只迁移了 localStorage，React 端（如另一台
// 浏览器 profile 或脚本被跳过时）也要兜底，否则老用户首屏主题丢失。
function getStoredTheme(storageKey: string, defaultTheme: Theme): Theme {
  try {
    const storedTheme = localStorage.getItem(storageKey)
    if (isTheme(storedTheme)) return storedTheme

    const legacy = localStorage.getItem("monkeycode-theme")
    if (isTheme(legacy)) {
      localStorage.setItem(storageKey, legacy)
      localStorage.removeItem("monkeycode-theme")
      return legacy
    }
  } catch {
    // Storage can be unavailable in restricted browsing contexts.
  }
  return defaultTheme
}

function setStoredTheme(storageKey: string, theme: Theme) {
  try {
    localStorage.setItem(storageKey, theme)
  } catch {
    // Storage can be unavailable in restricted browsing contexts.
  }
}

function resolveTheme(theme: Theme, systemTheme: AppliedTheme): AppliedTheme {
  return theme === "system" ? systemTheme : theme
}

function applyTheme(resolvedTheme: AppliedTheme) {
  const root = window.document.documentElement

  root.classList.remove("light", "dark")
  root.classList.add(resolvedTheme)
  root.style.colorScheme = resolvedTheme
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "vite-ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => getStoredTheme(storageKey, defaultTheme)
  )
  const [systemTheme, setSystemTheme] = useState<AppliedTheme>(() => getSystemTheme())
  const resolvedTheme = resolveTheme(theme, systemTheme)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? "dark" : "light")

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange)
      return () => mediaQuery.removeEventListener("change", handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  useEffect(() => {
    applyTheme(resolvedTheme)
  }, [resolvedTheme])

  const value = useMemo(() => ({
    theme,
    resolvedTheme,
    setTheme: (theme: Theme) => {
      setStoredTheme(storageKey, theme)
      setTheme(theme)
    },
  }), [resolvedTheme, storageKey, theme])

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}
