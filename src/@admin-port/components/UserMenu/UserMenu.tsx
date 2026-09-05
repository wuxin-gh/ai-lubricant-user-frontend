import { useEffect, useState } from 'react'
import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Form,
  Input,
  Modal,
  Space,
  Typography,
  message,
} from 'antd'
import type { MenuProps } from 'antd'
import { useNavigate } from 'react-router-dom'
import {
  DownOutlined,
  KeyOutlined,
  LogoutOutlined,
  SettingOutlined,
  SmileOutlined,
} from '@ant-design/icons'
import { useThemeStore } from '../../store/themeStore'
import { useAuthStore } from '../../store/authStore'
import { changePassword, extractApiErrorMessage, logout } from '../../api/auth'
import { MainConfig } from '../../pages/MainConfig/MainConfig'
import { NotificationsDialog, fetchUnreadCount } from '../NotificationsDialog/NotificationsDialog'

const MIN_PASSWORD_LENGTH = 4

const THEME_OPTIONS: Array<{ key: string; label: string; emoji: string; theme: string }> = [
  { key: 'midnight', label: '深夜黑', emoji: '🌙', theme: 'midnight' },
  { key: 'slate', label: '蓝灰深色', emoji: '🔷', theme: 'slate' },
  { key: 'emerald', label: '墨绿控制台', emoji: '🟢', theme: 'emerald' },
  { key: 'light', label: '明亮浅色', emoji: '☀️', theme: 'light' },
]

export function UserMenu() {
  const [isChangePwdOpen, setIsChangePwdOpen] = useState(false)
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [isNotifOpen, setIsNotifOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [changing, setChanging] = useState(false)
  const [changePwdError, setChangePwdError] = useState<string | null>(null)

  const navigate = useNavigate()
  const setTheme = useThemeStore((state) => state.setTheme)
  const clearAuth = useAuthStore((state) => state.clearAuth)

  const refreshUnread = () => {
    void fetchUnreadCount().then(setUnreadCount)
  }

  useEffect(() => {
    refreshUnread()
  }, [])

  const handleLogout = async () => {
    try {
      await logout()
    } catch (error) {
      console.error('退出登录失败:', error)
    } finally {
      clearAuth()
      navigate('/admin/login')
    }
  }

  const openChangePassword = () => {
    setChangePwdError(null)
    setIsChangePwdOpen(true)
  }

  const closeChangePassword = () => {
    if (changing) return
    setIsChangePwdOpen(false)
  }

  const handleChangePwd = async (values: {
    oldPassword: string
    newPassword: string
    confirmPassword: string
  }) => {
    setChanging(true)
    setChangePwdError(null)
    try {
      await changePassword(values.oldPassword, values.newPassword)
      message.success('密码修改成功，下次登录请使用新密码。')
      setIsChangePwdOpen(false)
    } catch (err) {
      setChangePwdError(extractApiErrorMessage(err, '修改密码失败'))
    } finally {
      setChanging(false)
    }
  }

  const handleNotifClose = () => {
    setIsNotifOpen(false)
    refreshUnread()
  }

  const items: MenuProps['items'] = [
    {
      key: 'config',
      label: '全局配置',
      icon: <SettingOutlined />,
      onClick: () => setIsConfigOpen(true),
    },
    {
      key: 'notif',
      label: (
        <Space>
          通知中心
          {unreadCount > 0 ? <Badge count={unreadCount} size="small" /> : null}
        </Space>
      ),
      icon: <SmileOutlined />,
      onClick: () => setIsNotifOpen(true),
    },
    { type: 'divider' as const },
    {
      key: 'theme',
      label: '切换主题',
      icon: <SettingOutlined />,
      children: THEME_OPTIONS.map((opt) => ({
        key: `theme:${opt.key}`,
        label: (
          <Space>
            <span>{opt.emoji}</span>
            <span>{opt.label}</span>
          </Space>
        ),
        onClick: () => setTheme(opt.theme),
      })),
    },
    {
      key: 'pwd',
      label: '修改密码',
      icon: <KeyOutlined />,
      onClick: openChangePassword,
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      label: '退出登录',
      icon: <LogoutOutlined />,
      danger: true,
      onClick: handleLogout,
    },
  ]

  return (
    <div style={{ padding: '12px' }}>
      <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
        <Button
          type="text"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            height: 'auto',
            padding: '8px 10px',
            color: 'var(--text)',
          }}
        >
          <Avatar style={{ background: 'var(--blue)', flexShrink: 0 }}>A</Avatar>
          <span style={{ flex: 1, textAlign: 'left' }}>
            <Typography.Text
              strong
              style={{ display: 'block', lineHeight: 1.2, fontSize: 13 }}
            >
              管理员
            </Typography.Text>
            <Typography.Text
              type="secondary"
              style={{ display: 'block', fontSize: 11, lineHeight: 1.2 }}
            >
              文档、通知与账户
            </Typography.Text>
          </span>
          <DownOutlined style={{ fontSize: 10 }} />
        </Button>
      </Dropdown>

      <Modal
        title="修改密码"
        open={isChangePwdOpen}
        onCancel={closeChangePassword}
        footer={null}
        destroyOnClose
        maskClosable={!changing}
        width={460}
      >
        <Form
          layout="vertical"
          onFinish={(values) =>
            handleChangePwd(
              values as {
                oldPassword: string
                newPassword: string
                confirmPassword: string
              },
            )
          }
          initialValues={{ oldPassword: '', newPassword: '', confirmPassword: '' }}
          disabled={changing}
          style={{ marginTop: 12 }}
        >
          <Form.Item
            label="旧密码"
            name="oldPassword"
            rules={[{ required: true, message: '请输入旧密码' }]}
          >
            <Input.Password autoComplete="current-password" autoFocus />
          </Form.Item>
          <Form.Item
            label={`新密码（至少 ${MIN_PASSWORD_LENGTH} 位）`}
            name="newPassword"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: MIN_PASSWORD_LENGTH, message: `新密码至少 ${MIN_PASSWORD_LENGTH} 位` },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || value !== getFieldValue('oldPassword')) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('新密码不能与旧密码相同'))
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="确认新密码"
            name="confirmPassword"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve()
                  }
                  return Promise.reject(new Error('两次输入的新密码不一致'))
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          {changePwdError ? (
            <div
              style={{
                marginBottom: 12,
                color: 'var(--red)',
                background: 'rgba(251,113,133,0.10)',
                border: '1px solid var(--red)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 13,
              }}
            >
              {changePwdError}
            </div>
          ) : null}
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={closeChangePassword} disabled={changing}>
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={changing}>
                保存新密码
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="全局配置"
        open={isConfigOpen}
        onCancel={() => setIsConfigOpen(false)}
        footer={null}
        destroyOnClose
        width="min(1100px, 92vw)"
      >
        <MainConfig />
      </Modal>

      <NotificationsDialog open={isNotifOpen} onClose={handleNotifClose} />
    </div>
  )
}
