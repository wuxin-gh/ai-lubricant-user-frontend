// 在统一 /manager 控制台内嵌入 ai-lubricant 平台管理页的包装器。
//
// 平台页当前仍是 antd 实现（源码已迁移到 @admin-port）。
// 这里提供 antd 的 ConfigProvider + App 上下文，并用 .admin-scope 把 antd 的
// 基础样式限定在容器内，避免污染外层 shadcn/Tailwind 的 manager 壳。
//
// 这是「先融合、可用」的过渡形态：侧边栏与路由已统一为一个管理端；
// 各平台页的 view 会分批被重写为 shadcn，届时替换本包装的子节点即可，
// 路由/侧边栏不变。
import '@/styles/admin-scoped.css'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'
import { useThemeStore } from '@/@admin-port/store/themeStore'
import { buildAntdTheme } from '@/@admin-port/styles/antdTheme'

export default function PlatformPageEmbed({ children }: { children: ReactNode }) {
  const theme = useThemeStore((state) => state.theme)
  return (
    <ConfigProvider locale={zhCN} theme={buildAntdTheme(theme)}>
      <AntApp>
        <div className="admin-scope">{children}</div>
      </AntApp>
    </ConfigProvider>
  )
}
