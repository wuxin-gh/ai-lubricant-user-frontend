import { useMemo, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Menu } from 'antd'
import { UserMenu } from '../UserMenu/UserMenu'

type NavItem = {
  page: string
  label: string
  icon: ReactNode
  color?: string
}

const navItems: NavItem[] = [
  {
    page: 'data-dashboard',
    label: '数据看板',
    color: '#0ea5e9',
    icon: (
      <>
        <path d="M3 3v18h18" />
        <rect x="7" y="12" width="3" height="5" />
        <rect x="12" y="8" width="3" height="9" />
        <rect x="17" y="5" width="3" height="12" />
      </>
    ),
  },
  {
    page: 'test-model',
    label: '聊天',
    color: '#f43f5e',
    icon: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
  },
  {
    page: 'agent-chat',
    label: 'Agent 对话',
    color: '#a78bfa',
    icon: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  },
  {
    page: 'api-keys',
    label: 'API Keys',
    color: '#f59e0b',
    icon: <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />,
  },
  {
    page: 'proxy-pool',
    label: '代理池',
    color: '#06b6d4',
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </>
    ),
  },
  {
    page: 'channels',
    label: '渠道',
    color: '#3b82f6',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="14" rx="2" />
        <path d="M7 8h10M7 12h6M8 20h8" />
      </>
    ),
  },
  {
    page: 'relay-sites',
    label: '中转站',
    color: '#10b981',
    icon: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="8" cy="6" r="1" />
        <circle cx="8" cy="12" r="1" />
        <circle cx="8" cy="18" r="1" />
      </>
    ),
  },
  {
    page: 'model-metadata',
    label: '模型',
    color: '#8b5cf6',
    icon: (
      <>
        <path d="M12 2l9 4.5v11L12 22l-9-4.5v-11L12 2z" />
        <path d="M3 7l9 4.5L21 7" />
        <path d="M12 22V11.5" />
      </>
    ),
  },
  {
    page: 'mcp-market',
    label: 'MCP 市场',
    color: '#10b981',
    icon: (
      <>
        <path d="M12 2l9 5v10l-9 5-9-5V7l9-5z" />
        <path d="M8.5 8.5h7v7h-7z" />
      </>
    ),
  },
  {
    page: 'request-logs',
    label: '请求日志',
    color: '#64748b',
    icon: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h8M8 9h2" />
      </>
    ),
  },
  {
    page: 'security',
    label: '安全',
    color: '#22c55e',
    icon: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </>
    ),
  },
  {
    page: 'usage-guide',
    label: '使用方法',
    color: '#94a3b8',
    icon: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <path d="M8 7h8M8 11h8M8 15h5" />
      </>
    ),
  },
]

function NavIcon({ icon, color }: { icon: ReactNode; color?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || 'currentColor'}
      strokeWidth={2}
      width={18}
      height={18}
      aria-hidden="true"
    >
      {icon}
    </svg>
  )
}

function activeKey(pathname: string): string | undefined {
  const match = navItems.find(
    (item) => pathname === `/admin/${item.page}` || pathname.startsWith(`/admin/${item.page}/`),
  )
  return match?.page
}

export default function Sidebar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const menuItems = useMemo(
    () =>
      navItems.map((item) => ({
        key: item.page,
        icon: <NavIcon icon={item.icon} color={item.color} />,
        label: item.label,
      })),
    [],
  )

  const selected = activeKey(pathname)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '18px 20px',
          fontSize: 15,
          fontWeight: 700,
          color: 'var(--textH)',
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: 'var(--blue)',
            boxShadow: '0 0 10px var(--blue)',
          }}
        />
        Ai Lubricant Admin
      </div>
      <Menu
        mode="inline"
        theme="light"
        selectedKeys={selected ? [selected] : []}
        items={menuItems}
        onClick={({ key }) => navigate(`/admin/${key}`)}
        style={{ flex: 1, background: 'transparent', borderInlineEnd: 'none' }}
        inlineIndent={20}
      />
      <div style={{ borderTop: '1px solid var(--admin-border)' }}>
        <UserMenu />
      </div>
    </div>
  )
}
