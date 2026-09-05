import { Outlet } from 'react-router-dom'
import { Layout as AntLayout } from 'antd'
import Sidebar from './Sidebar'

const { Sider, Content } = AntLayout

export default function Layout() {
  return (
    <AntLayout style={{ height: '100vh' }}>
      <Sider
        width={196}
        theme="dark"
        style={{
          background: 'var(--surface)',
          borderRight: '1px solid var(--admin-border)',
          height: '100vh',
          overflow: 'auto',
        }}
      >
        <Sidebar />
      </Sider>
      <AntLayout style={{ background: 'var(--bg)' }}>
        <Content style={{ overflow: 'auto', height: '100vh' }}>
          <Outlet />
        </Content>
      </AntLayout>
    </AntLayout>
  )
}
