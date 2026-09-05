/**
 * shadcn 版平台管理页壳（替代 admin-frontend 的 antd `AdminPage`）。
 *
 * 目的：把 ai-lubricant 的平台管理页从 antd 逐页重写为 shadcn 时，view 层不必
 * 重新发明脚手架。这里以「与原 antd `shared/AdminPage.tsx` 完全一致的 props
 * 契约」提供 shadcn 实现，重写各页时只需把
 *   import { AdminPage, SectionCard, StatGrid, StatCard, InfoList, SimpleTable } from '../shared/AdminPage'
 * 换成
 *   import { AdminPage, SectionCard, StatGrid, StatCard, InfoList, SimpleTable } from '@/components/manager/platform-page'
 * 其余 JSX 基本照搬（antd 原子组件 → shadcn 原子组件另行替换）。
 *
 * 数据层复用 `@/@admin-port/api/*`（纯 axios，无 UI 依赖）。此文件仅是视图脚手架。
 */
import { Fragment } from "react"
import type { CSSProperties, ReactNode } from "react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { ManagerPageActions } from "@/components/manager/manager-header-actions"

// ============================================================================
// AdminPage — 页面壳。保持与 antd 版完全一致的 props（title/description/actions/
// children/contentStyle），使各页重写为纯替换。
// ============================================================================

interface AdminPageProps {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  primaryActions?: ReactNode
  overflowActions?: ReactNode
  children: ReactNode
  /** 传入即进入「填充布局」（内容区 flex 撑满、隐藏外层滚动），对齐 antd 版语义。 */
  contentStyle?: CSSProperties
}

export function AdminPage({ actions, primaryActions, overflowActions, children, contentStyle }: AdminPageProps) {
  const fill = contentStyle !== undefined
  return (
    <div
      className={cn(
        "min-h-0 min-w-0 flex-1 pb-4",
        fill ? "flex flex-col overflow-hidden" : "overflow-y-auto",
      )}
    >
      <ManagerPageActions primary={primaryActions ?? actions} overflow={overflowActions} />
      {fill ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={contentStyle}>
          {children}
        </div>
      ) : (
        <div className="flex w-full flex-col gap-4">{children}</div>
      )}
    </div>
  )
}

// ============================================================================
// SectionCard — 区块卡片。兼容旧 props: title/description/toolbar(=extra)/extra。
// ============================================================================

interface SectionCardProps {
  title?: ReactNode
  description?: ReactNode
  toolbar?: ReactNode
  extra?: ReactNode
  children: ReactNode
  bodyStyle?: CSSProperties
  style?: CSSProperties
  className?: string
}

export function SectionCard({
  title,
  description,
  toolbar,
  extra,
  children,
  bodyStyle,
  style,
  className,
}: SectionCardProps) {
  const hasHeader = title || description || extra || toolbar
  return (
    <Card size="sm" className={cn("shadow-none", className)} style={style}>
      {hasHeader ? (
        <CardHeader>
          {title ? <CardTitle>{title}</CardTitle> : null}
          {description ? <CardDescription>{description}</CardDescription> : null}
          {extra ?? toolbar ? <CardAction>{extra ?? toolbar}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent style={bodyStyle}>{children}</CardContent>
    </Card>
  )
}

// ============================================================================
// StatGrid / StatCard — 统计指标网格。兼容旧 props（columns / label,value,
// subText,tone,trend,icon）。
// ============================================================================

interface StatGridProps {
  columns?: number
  children: ReactNode
}

export function StatGrid({ columns = 4, children }: StatGridProps) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${Math.floor(100 / columns)}%, 1fr))` }}
    >
      {children}
    </div>
  )
}

interface StatCardTrend {
  value: string
  direction: "up" | "down" | "neutral"
}

interface StatCardProps {
  label: ReactNode
  value: ReactNode
  subText?: ReactNode
  tone?: "default" | "blue" | "green" | "yellow" | "red"
  trend?: StatCardTrend
  icon?: ReactNode
}

const TONE_TEXT: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-foreground",
  blue: "text-blue-600 dark:text-blue-400",
  green: "text-green-600 dark:text-green-400",
  yellow: "text-yellow-600 dark:text-yellow-400",
  red: "text-red-600 dark:text-red-400",
}

export function StatCard({ label, value, subText, tone = "default", trend, icon }: StatCardProps) {
  return (
    <Card size="sm" className="shadow-none">
      <CardContent className="flex flex-col gap-1 py-1">
        <div className="flex items-start justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        </div>
        <div className={cn("text-2xl font-semibold leading-tight", TONE_TEXT[tone])}>{value}</div>
        {trend ? (
          <div
            className={cn(
              "text-xs",
              trend.direction === "up"
                ? "text-green-600 dark:text-green-400"
                : trend.direction === "down"
                  ? "text-red-600 dark:text-red-400"
                  : "text-muted-foreground",
            )}
          >
            {trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "→"} {trend.value}
          </div>
        ) : null}
        {subText ? <div className="text-xs text-muted-foreground">{subText}</div> : null}
      </CardContent>
    </Card>
  )
}

export const SummaryCard = StatCard

// ============================================================================
// InfoList — 信息描述列表。兼容旧 props: items[].tone / columns / layout。
// ============================================================================

type InfoTone = "default" | "blue" | "green" | "yellow" | "red" | "muted"

export interface InfoListItem {
  label: ReactNode
  value: ReactNode
  tone?: InfoTone
}

interface InfoListProps {
  items: InfoListItem[]
  columns?: number
  layout?: "horizontal" | "vertical"
}

const INFO_TONE_TEXT: Record<InfoTone, string> = {
  default: "text-foreground",
  blue: "text-blue-600 dark:text-blue-400",
  green: "text-green-600 dark:text-green-400",
  yellow: "text-yellow-600 dark:text-yellow-400",
  red: "text-red-600 dark:text-red-400",
  muted: "text-muted-foreground",
}

export function InfoList({ items, columns = 2, layout = "horizontal" }: InfoListProps) {
  return (
    <div className="grid gap-x-6 gap-y-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {items.map((item, idx) => (
        <div key={idx} className={cn("flex gap-2", layout === "vertical" ? "flex-col" : "items-baseline")}>
          <span className="shrink-0 text-xs text-muted-foreground">{item.label}</span>
          <span className={cn("text-sm", INFO_TONE_TEXT[item.tone || "default"])}>{item.value}</span>
        </div>
      ))}
    </div>
  )
}

// ============================================================================
// SimpleTable — 简单表格。兼容旧 props: columns[{key,label,render,width,align}],
// rows, emptyText, rowKey, size。render 签名保持 (value, row, index)。
// ============================================================================

export interface SimpleTableColumn<T> {
  key: string
  label: ReactNode
  render?: (value: unknown, row: T, index: number) => ReactNode
  width?: number | string
  align?: "left" | "center" | "right"
}

interface SimpleTableProps<T> {
  columns: SimpleTableColumn<T>[]
  rows: T[]
  emptyText?: ReactNode
  rowKey?: keyof T | ((row: T) => string | number)
  size?: "small" | "middle" | "large"
  /** Optional detail row rendered immediately below a matching data row. */
  expandedRowKeys?: ReadonlySet<string>
  renderExpandedRow?: (row: T, index: number) => ReactNode
}

export function SimpleTable<T extends Record<string, unknown>>({
  columns,
  rows,
  emptyText = "暂无数据",
  rowKey,
  expandedRowKeys,
  renderExpandedRow,
}: SimpleTableProps<T>) {
  const resolveRowKey = (record: T, index: number): string => {
    if (typeof rowKey === "function") return String(rowKey(record))
    if (rowKey && record[rowKey as keyof T] != null) return String(record[rowKey as keyof T])
    if (record.id != null) return String(record.id)
    return String(index)
  }

  const alignClass = (align?: "left" | "center" | "right") =>
    align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left"

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key} className={alignClass(col.align)} style={col.width ? { width: col.width } : undefined}>
              {col.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
              {emptyText}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row, index) => {
            const key = resolveRowKey(row, index)
            const expanded = expandedRowKeys?.has(key) && renderExpandedRow
            return (
              <Fragment key={key}>
                <TableRow>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={alignClass(col.align)}>
                      {col.render ? col.render(row[col.key], row, index) : (row[col.key] as ReactNode)}
                    </TableCell>
                  ))}
                </TableRow>
                {expanded ? (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="bg-muted/30 p-0">
                      {renderExpandedRow(row, index)}
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}
