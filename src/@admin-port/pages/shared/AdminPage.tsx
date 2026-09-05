import type { CSSProperties, ReactNode } from 'react'
import {
  Card,
  Col,
  Descriptions,
  Empty,
  Row,
  Space,
  Statistic,
  Table,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'

const { Title, Paragraph } = Typography

// ============================================================================
// AdminPage - 管理后台页面壳（AntD 重构版，保持原有 props API 完全兼容）
// ============================================================================

interface AdminPageProps {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  contentStyle?: CSSProperties
}

export function AdminPage({ title, description, actions, children, contentStyle }: AdminPageProps) {
  const showHeader = (title !== undefined && title !== null && title !== '') || description || actions
  const fill = contentStyle !== undefined
  return (
    <div
      style={{
        padding: '20px 24px 32px',
        overflow: fill ? 'hidden' : 'auto',
        height: '100%',
        ...(fill ? { display: 'flex', flexDirection: 'column' } : null),
      }}
    >
      {showHeader ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 18,
            gap: 16,
            flexWrap: 'wrap',
            flex: '0 0 auto',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {title !== undefined && title !== null && title !== '' ? (
              <Title level={3} style={{ margin: 0 }}>
                {title}
              </Title>
            ) : null}
            {description ? (
              <Paragraph type="secondary" style={{ margin: '6px 0 0', fontSize: 13 }}>
                {description}
              </Paragraph>
            ) : null}
          </div>
          {actions ? <Space wrap>{actions}</Space> : null}
        </div>
      ) : null}
      {fill ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', ...contentStyle }}>
          {children}
        </div>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {children}
        </Space>
      )}
    </div>
  )
}

// ============================================================================
// SectionCard - 区块卡片
// 兼容旧 props: title, description, toolbar(=extra), extra, children
// ============================================================================

interface SectionCardProps {
  title?: ReactNode
  description?: ReactNode
  toolbar?: ReactNode
  extra?: ReactNode
  children: ReactNode
  bodyStyle?: CSSProperties
  style?: CSSProperties
}

export function SectionCard({
  title,
  description,
  toolbar,
  extra,
  children,
  bodyStyle,
  style,
}: SectionCardProps) {
  const header =
    title || description ? (
      <div>
        {title ? <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div> : null}
        {description ? (
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2, fontWeight: 400 }}>
            {description}
          </div>
        ) : null}
      </div>
    ) : null

  return (
    <Card
      size="small"
      title={header}
      extra={extra ?? toolbar}
      style={style}
      styles={{ body: { padding: 16, ...bodyStyle } }}
    >
      {children}
    </Card>
  )
}

// ============================================================================
// StatGrid - 统计指标网格
// ============================================================================

interface StatGridProps {
  columns?: number
  children: ReactNode
}

export function StatGrid({ columns = 4, children }: StatGridProps) {
  const span = Math.max(1, Math.floor(24 / columns))
  const items = Array.isArray(children) ? children : [children]
  return (
    <Row gutter={[12, 12]}>
      {items.map((item, idx) => (
        <Col key={idx} xs={24} sm={12} md={span} lg={span}>
          {item}
        </Col>
      ))}
    </Row>
  )
}

// ============================================================================
// StatCard - 单个统计指标卡（兼容旧 trend/icon props）
// ============================================================================

interface StatCardTrend {
  value: string
  direction: 'up' | 'down' | 'neutral'
}

interface StatCardProps {
  label: ReactNode
  value: ReactNode
  subText?: ReactNode
  tone?: 'default' | 'blue' | 'green' | 'yellow' | 'red'
  trend?: StatCardTrend
  icon?: ReactNode
}

const TONE_COLORS: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'var(--text)',
  blue: 'var(--blue)',
  green: 'var(--green)',
  yellow: 'var(--yellow)',
  red: 'var(--red)',
}

export function StatCard({
  label,
  value,
  subText,
  tone = 'default',
  trend,
  icon,
}: StatCardProps) {
  const color = TONE_COLORS[tone]
  const isPrimitive = typeof value === 'string' || typeof value === 'number'
  return (
    <Card size="small" styles={{ body: { padding: 14 } }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 4 }}>{label}</div>
        {icon ? <span style={{ color: 'var(--text2)' }}>{icon}</span> : null}
      </div>
      {isPrimitive ? (
        <Statistic
          value={value as string | number}
          valueStyle={{ color, fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}
        />
      ) : (
        <div style={{ color, fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>{value}</div>
      )}
      {trend ? (
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color:
              trend.direction === 'up'
                ? 'var(--green)'
                : trend.direction === 'down'
                  ? 'var(--red)'
                  : 'var(--text2)',
          }}
        >
          {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'} {trend.value}
        </div>
      ) : null}
      {subText ? (
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>{subText}</div>
      ) : null}
    </Card>
  )
}

export const SummaryCard = StatCard

// ============================================================================
// InfoList - 信息描述列表
// 兼容旧 props: items[].tone, layout
// ============================================================================

type InfoTone = 'default' | 'blue' | 'green' | 'yellow' | 'red' | 'muted'

export interface InfoListItem {
  label: ReactNode
  value: ReactNode
  tone?: InfoTone
}

interface InfoListProps {
  items: InfoListItem[]
  columns?: number
  layout?: 'horizontal' | 'vertical'
}

const INFO_TONE_COLORS: Record<InfoTone, string> = {
  default: 'var(--text)',
  blue: 'var(--blue)',
  green: 'var(--green)',
  yellow: 'var(--yellow)',
  red: 'var(--red)',
  muted: 'var(--text2)',
}

export function InfoList({ items, columns = 2, layout = 'horizontal' }: InfoListProps) {
  return (
    <Descriptions
      column={columns}
      layout={layout}
      size="small"
      bordered={false}
      colon={false}
      items={items.map((item, idx) => ({
        key: idx,
        label: <span style={{ color: 'var(--text2)', fontSize: 12 }}>{item.label}</span>,
        children: (
          <span style={{ color: INFO_TONE_COLORS[item.tone || 'default'], fontSize: 13 }}>
            {item.value}
          </span>
        ),
      }))}
    />
  )
}

// ============================================================================
// SimpleTable - 简单表格
// 兼容旧 props: columns[{label,key,render(value,row,index),width,align}], rows, emptyText, rowKey
// ============================================================================

export interface SimpleTableColumn<T> {
  key: string
  label: ReactNode
  render?: (value: unknown, row: T, index: number) => ReactNode
  width?: number | string
  align?: 'left' | 'center' | 'right'
}

interface SimpleTableProps<T> {
  columns: SimpleTableColumn<T>[]
  rows: T[]
  emptyText?: ReactNode
  rowKey?: keyof T | ((row: T) => string | number)
  size?: 'small' | 'middle' | 'large'
}

export function SimpleTable<T extends Record<string, unknown>>({
  columns,
  rows,
  emptyText = '暂无数据',
  rowKey,
  size = 'small',
}: SimpleTableProps<T>) {
  const antColumns: ColumnsType<T> = columns.map((col) => ({
    key: col.key,
    title: col.label,
    dataIndex: col.key,
    width: col.width,
    align: col.align,
    render: col.render
      ? (value: unknown, record: T, index: number) => col.render!(value, record, index)
      : undefined,
  }))

  const resolveRowKey = (record: T, index?: number): string => {
    if (typeof rowKey === 'function') return String(rowKey(record))
    if (rowKey && record[rowKey] != null) return String(record[rowKey])
    if (record.id != null) return String(record.id)
    return String(index ?? 0)
  }

  return (
    <Table<T>
      columns={antColumns}
      dataSource={rows}
      rowKey={resolveRowKey}
      size={size}
      pagination={false}
      locale={{ emptyText: emptyText ?? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      scroll={{ x: 'max-content' }}
    />
  )
}
