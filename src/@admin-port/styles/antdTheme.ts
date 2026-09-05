import { theme as antdTheme } from 'antd'
import type { ThemeConfig } from 'antd'

// ============================================================================
// Ant Design 主题桥接
// 将现有主题（src/styles/variables.css）映射到 AntD design token，
// 使 AntD 组件与原有自定义样式视觉一致，并跟随 body 主题切换。
// ============================================================================

export type ThemeName = 'midnight' | 'slate' | 'emerald' | 'light'

interface Palette {
  bg: string
  bg2: string
  bg3: string
  border: string
  text: string
  text2: string
  textH: string
  blue: string
  green: string
  red: string
  yellow: string
  surface: string
  surface2: string
  hover: string
}

// 与 variables.css 中各 body.theme-* 定义保持一致
const PALETTES: Record<ThemeName, Palette> = {
  slate: {
    bg: '#0f172a',
    bg2: '#111827',
    bg3: '#1f2937',
    border: '#334155',
    text: '#cbd5e1',
    text2: '#94a3b8',
    textH: '#f8fafc',
    blue: '#60a5fa',
    green: '#34d399',
    red: '#fb7185',
    yellow: '#fbbf24',
    surface: '#111827',
    surface2: '#1f2937',
    hover: 'rgba(255, 255, 255, 0.06)',
  },
  midnight: {
    bg: '#0b0e14',
    bg2: '#131720',
    bg3: '#1a1f2b',
    border: '#252b36',
    text: '#aab2c0',
    text2: '#697180',
    textH: '#e2e7f0',
    blue: '#4d8cf7',
    green: '#26b752',
    red: '#e5484d',
    yellow: '#e8a828',
    surface: '#131720',
    surface2: '#1a1f2b',
    hover: 'rgba(255, 255, 255, 0.06)',
  },
  emerald: {
    bg: '#071412',
    bg2: '#0d1f1b',
    bg3: '#16332c',
    border: '#24534a',
    text: '#b8d7cf',
    text2: '#72a39a',
    textH: '#ecfffa',
    blue: '#2dd4bf',
    green: '#34d399',
    red: '#fb7185',
    yellow: '#facc15',
    surface: '#0d1f1b',
    surface2: '#16332c',
    hover: 'rgba(255, 255, 255, 0.06)',
  },
  light: {
    bg: '#ffffff',
    bg2: '#ffffff',
    bg3: '#f8fafc',
    border: '#e2e8f0',
    text: '#475569',
    text2: '#64748b',
    textH: '#0f172a',
    blue: '#2563eb',
    green: '#059669',
    red: '#dc2626',
    yellow: '#d97706',
    surface: '#ffffff',
    surface2: '#f8fafc',
    hover: '#f1f5f9',
  },
}

const DARK_THEMES: ThemeName[] = ['midnight', 'slate', 'emerald']

export function buildAntdTheme(themeName: ThemeName): ThemeConfig {
  const palette = PALETTES[themeName] ?? PALETTES.slate
  const isDark = DARK_THEMES.includes(themeName)

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: palette.blue,
      colorSuccess: palette.green,
      colorError: palette.red,
      colorWarning: palette.yellow,
      colorInfo: palette.blue,

      colorBgBase: palette.bg,
      colorBgContainer: palette.bg2,
      colorBgElevated: palette.surface,
      colorBgLayout: palette.bg,

      colorText: palette.text,
      colorTextSecondary: palette.text2,
      colorTextHeading: palette.textH,
      colorBorder: palette.border,
      colorBorderSecondary: palette.border,

      borderRadius: 7,
      fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
      fontSize: 14,
    },
    components: {
      Layout: {
        bodyBg: palette.bg,
        siderBg: palette.surface,
        headerBg: palette.surface,
      },
      Menu: {
        itemBg: 'transparent',
        itemSelectedBg: isDark ? 'rgba(96, 165, 250, 0.16)' : 'rgba(37, 99, 235, 0.10)',
        itemHoverBg: palette.hover,
        itemColor: palette.text,
        itemSelectedColor: palette.textH,
        darkItemBg: 'transparent',
        darkItemSelectedBg: 'rgba(96, 165, 250, 0.16)',
        darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
        darkItemColor: palette.text,
        darkItemSelectedColor: palette.textH,
      },
      Card: {
        colorBgContainer: palette.surface,
        colorBorderSecondary: palette.border,
      },
      Modal: {
        contentBg: palette.surface,
        headerBg: palette.surface,
        footerBg: 'transparent',
        titleColor: palette.textH,
      },
      Table: {
        headerBg: palette.bg3,
        headerColor: palette.text2,
        rowHoverBg: palette.hover,
        colorBgContainer: 'transparent',
        borderColor: palette.border,
      },
      Statistic: {
        colorTextDescription: palette.text2,
      },
      Descriptions: {
        labelBg: palette.bg3,
        titleColor: palette.textH,
        colorText: palette.text,
      },
      Dropdown: {
        colorBgElevated: palette.surface,
      },
      Select: {
        colorBgElevated: palette.surface,
        optionSelectedBg: palette.hover,
      },
      Input: {
        colorBgContainer: palette.bg2,
      },
      InputNumber: {
        colorBgContainer: palette.bg2,
      },
    },
  }
}

// 默认主题（首屏渲染用，App 内会根据 store 动态切换）
export const antdThemeConfig: ThemeConfig = buildAntdTheme('slate')
