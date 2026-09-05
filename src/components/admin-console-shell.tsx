// The admin base styles are scoped to ``.admin-scope`` so they never leak onto
// the Tailwind-based user pages (login/console).
//
// NOTE: we deliberately do NOT import ``antd/dist/reset.css``. In Vite a CSS
// ``import`` is injected globally no matter which module it sits in, so antd's
// reset (which targets bare ``html``/``body``/``*``) would clobber Tailwind's
// preflight and strip the user pages. antd 6 is CSS-in-JS: components style
// themselves via ConfigProvider without the reset sheet, so we skip it.
import '@/styles/admin-scoped.css'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import AdminLayout from '@/@admin-port/components/Layout/Layout'
import { useAuthStore } from '@/@admin-port/store/authStore'
import { useThemeStore } from '@/@admin-port/store/themeStore'
import { buildAntdTheme } from '@/@admin-port/styles/antdTheme'
import { useAppRuntime } from '@/components/app-runtime-provider'

function AdminProviders({ children }: { children: ReactNode }) {
  const theme = useThemeStore((state) => state.theme)
  return (
    <ConfigProvider locale={zhCN} theme={buildAntdTheme(theme)}>
      <AntApp>
        <div className="admin-scope">{children}</div>
      </AntApp>
    </ConfigProvider>
  )
}

export function AdminLoginShell({ children }: { children: ReactNode }) {
  return <AdminProviders>{children}</AdminProviders>
}

export function AdminProtectedShell() {
  // 主路径：C 端用户会话 + role==admin（同一 cookie，无需额外登录）。
  const { auth } = useAppRuntime()
  const isAdminUser = auth.user?.role === 'admin'
  // 应急兜底：admin 独立登录换取的 token 存在（compat 关闭 / session 异常时用）。
  const hasAdminToken = useAuthStore((s) => s.isAuthenticated)

  // 会话仍在解析中：不要过早重定向，避免刷新时闪回登录页。
  if (auth.loading && !hasAdminToken) {
    return null
  }
  if (!isAdminUser && !hasAdminToken) {
    // 主入口是 C 端登录；应急管理员可手动访问 /admin/login。
    return <Navigate to="/login" replace />
  }
  return (
    <AdminProviders>
      <AdminLayout />
    </AdminProviders>
  )
}

/**
 * 统一管理端 /manager 的鉴权守卫。
 *
 * 鉴权判定与 AdminProtectedShell 一致（C 端 session+role==admin 主路径，
 * admin 单密码 token 应急兜底），但渲染的是 shadcn 的 ManagerConsolePage
 * （由 children 传入），而非 antd 的 AdminLayout。这样只有一个管理端 /manager，
 * ai-lubricant 平台页以 PlatformPageEmbed 内嵌其中。
 */
export function ManagerProtectedRoute({ children }: { children: ReactNode }) {
  const { auth } = useAppRuntime()
  const isAdminUser = auth.user?.role === 'admin'
  const hasAdminToken = useAuthStore((s) => s.isAuthenticated)

  if (auth.loading && !hasAdminToken) {
    return null
  }
  if (!isAdminUser && !hasAdminToken) {
    // 管理端自成闭环：未登录跳应急管理员登录页（/manager/login），
    // 而非用户侧 /login。role==admin 的 C 端用户走 cookie 自动放行。
    return <Navigate to="/manager/login" replace />
  }
  return <>{children}</>
}
