/**
 * 节点父子树表格——管理端与用户侧共用的渲染骨架。
 *
 * 只负责"怎么画"：管理节点父行 + 其下执行节点子行 + 末尾未受管合成组，以及每列
 * 展示什么。**不负责"能做什么"**——操作列由调用方通过 `renderManagerActions` /
 * `renderExecutionActions` 注入。这是两侧权限差异的唯一落点：用户侧不注入审批/
 * 移动/删除，这些操作就天然不存在，不需要在表格内部写 `mode === "admin"` 分支。
 *
 * 列集合由共用的 `NODE_LIST_COLUMNS` 声明；两侧只通过操作回调注入权限差异，避免管理端与用户侧
 * 因各自传参产生视觉分叉。
 *
 * 每个分组（管理节点父行）可折叠：父行节点列带 chevron，折叠时隐藏子行与
 * 「暂无执行节点」占位行。折叠状态是组件内部 UI 态，列表刷新（同实例重渲染）不丢。
 */
import { Fragment, useState, type ReactNode } from "react"
import { Minus, Plus } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { ROLE_LABEL } from "@/pages/manager/platform/nodes/types"
import {
  EditorsCell,
  MachineFactCell,
  NodeCell,
  NodeStatusBadge,
  StartupMethodCell,
  VersionCell,
} from "./node-cells"
import type { NodeGroup, NodeView } from "./node-view"

/** 可选列。`node` 与 `actions` 恒在，不在这里声明。 */
export type NodeColumn = "system" | "cpu" | "memory" | "version" | "startup" | "editors" | "status"

/**
 * 节点列表统一列集合：节点客户端版本、启动方式、编辑器、状态。系统/CPU/内存等
 * 机器详情放在「详情」弹框查看，不在列表重复占宽——管理端与用户侧共用同一集合，
 * 保持一致。
 */
export const NODE_LIST_COLUMNS: NodeColumn[] = ["version", "startup", "editors", "status"]

/** 操作区域统一宽度：两侧按钮数量不同，但列宽固定，页面布局不随权限跳变。 */
export const NODE_ACTIONS_WIDTH = "w-[440px]"

const COLUMN_META: Record<NodeColumn, { label: string; width: string }> = {
  system: { label: "系统", width: "w-[150px]" },
  cpu: { label: "CPU", width: "w-[180px]" },
  memory: { label: "内存", width: "w-[110px]" },
  version: { label: "节点客户端版本", width: "w-[130px]" },
  startup: { label: "启动方式", width: "w-[110px]" },
  editors: { label: "支持的编辑器", width: "w-[180px]" },
  status: { label: "状态", width: "w-[120px]" },
}

function ColumnCell({ view, column }: { view: NodeView | null; column: NodeColumn }) {
  switch (column) {
    case "system":
    case "cpu":
    case "memory":
      return <MachineFactCell view={view} fact={column} />
    case "version":
      return <VersionCell view={view} />
    case "startup":
      return <StartupMethodCell view={view} />
    case "editors":
      return <EditorsCell view={view} />
    case "status":
      return view ? <NodeStatusBadge view={view} /> : null
  }
}

export function NodeTreeTable({
  groups,
  columns,
  loading = false,
  emptyHint,
  noExecutionHint = "该管理节点下暂无执行节点。",
  renderManagerActions,
  renderExecutionActions,
  actionsWidth = NODE_ACTIONS_WIDTH,
}: {
  groups: NodeGroup[]
  columns: NodeColumn[]
  loading?: boolean
  emptyHint: ReactNode
  /** 管理节点下没有执行节点时的占位文案（管理端会附带引导创建）。 */
  noExecutionHint?: ReactNode
  /** 管理节点父行的操作。未提供即该侧不给管理节点任何操作。 */
  renderManagerActions?: (manager: NodeView) => ReactNode
  /** 执行节点子行的操作。 */
  renderExecutionActions?: (node: NodeView) => ReactNode
  actionsWidth?: string
}) {
  const totalColumns = columns.length + 2
  // 折叠的分组 key 集合。默认全展开；toggleGroup 切换某组。跨列表刷新保留
  // （NodeTreeTable 在 Nodes 页是同实例重渲染，useState 不重置）。
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set())
  const toggleGroup = (key: string) =>
    setCollapsedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[260px] text-center">节点</TableHead>
          {columns.map((column) => (
            <TableHead key={column} className={`${COLUMN_META[column].width} text-center`}>
              {COLUMN_META[column].label}
            </TableHead>
          ))}
          <TableHead className={`${actionsWidth} text-center`}>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow>
            <TableCell colSpan={totalColumns} className="h-24 text-center">
              <Spinner />
            </TableCell>
          </TableRow>
        ) : groups.length === 0 ? (
          <TableRow>
            <TableCell colSpan={totalColumns} className="h-24 text-center text-muted-foreground">
              {emptyHint}
            </TableCell>
          </TableRow>
        ) : (
          groups.map((group) => {
            const manager = group.manager
            const collapsed = collapsedKeys.has(group.key)
            const childCount = group.children.length
            const countTag =
              childCount > 0
                ? { label: `${childCount} 个执行节点`, className: "text-slate-500 dark:text-slate-400" }
                : undefined
            return (
              <Fragment key={group.key}>
                {/* 父行：管理节点（分组容器 / 管理客户端）或未受管合成组。 */}
                <TableRow className="bg-muted/40">
                  <TableCell className="align-middle whitespace-normal">
                    <div className="flex items-start gap-2.5">
                      {/* 无子节点的分组不给折叠钮——折叠只会藏掉「暂无执行节点」提示，没有意义。
                          占一个等宽空位，让各父行名称左缘对齐。展开态用主色描边，更醒目。 */}
                      {childCount > 0 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          onClick={() => toggleGroup(group.key)}
                          aria-label={collapsed ? "展开子节点" : "折叠子节点"}
                          aria-expanded={!collapsed}
                          title={collapsed ? "展开子节点" : "折叠子节点"}
                          className={cn(
                            "mt-0.5 shrink-0 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground",
                            collapsed ? "" : "border-primary/40 text-primary hover:border-primary/60 hover:text-primary",
                          )}
                        >
                          {collapsed ? <Plus className="size-3.5" /> : <Minus className="size-3.5" />}
                        </Button>
                      ) : (
                        <span className="mt-0.5 size-6 shrink-0" aria-hidden />
                      )}
                      {manager ? (
                        <NodeCell
                          view={manager}
                          kindLabel={ROLE_LABEL.management}
                          badgeClass="text-purple-600 dark:text-purple-400"
                          align="start"
                          subTag={
                            manager.displayOnly
                              ? { label: "仅归属展示", className: "text-slate-500 dark:text-slate-400" }
                              : manager.isPassive
                                ? { label: "不可管理", className: "text-slate-600 dark:text-slate-300" }
                                : { label: "可管理", className: "text-emerald-600 dark:text-emerald-400" }
                          }
                          extraTag={countTag}
                        />
                      ) : (
                        <div className="flex flex-col items-start gap-1 text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-muted-foreground">未受管 / 直连</span>
                            {countTag ? (
                              <Badge variant="secondary" className={countTag.className}>
                                {countTag.label}
                              </Badge>
                            ) : null}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            未归属任何管理节点的执行节点
                          </span>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell key={column} className="align-middle text-center whitespace-normal">
                      <ColumnCell view={manager} column={column} />
                    </TableCell>
                  ))}
                  <TableCell className="align-middle text-center">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {manager && renderManagerActions ? renderManagerActions(manager) : null}
                    </div>
                  </TableCell>
                </TableRow>

                {/* 子行：该管理节点下的执行节点。折叠时整组隐藏（含占位行）。 */}
                {collapsed ? null : group.children.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={totalColumns}
                      className="py-2 pl-10 text-xs text-muted-foreground"
                    >
                      {manager ? noExecutionHint : "无未受管执行节点。"}
                    </TableCell>
                  </TableRow>
                ) : (
                  group.children.map((node) => (
                    <TableRow key={node.nodeId}>
                      <TableCell className="align-middle pl-10 whitespace-normal">
                        <NodeCell
                          view={node}
                          kindLabel={ROLE_LABEL.execution}
                          badgeClass="text-blue-600 dark:text-blue-400"
                          align="start"
                        />
                      </TableCell>
                      {columns.map((column) => (
                        <TableCell key={column} className="align-middle text-center whitespace-normal">
                          <ColumnCell view={node} column={column} />
                        </TableCell>
                      ))}
                      <TableCell className="align-middle text-center">
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {renderExecutionActions ? renderExecutionActions(node) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </Fragment>
            )
          })
        )}
      </TableBody>
    </Table>
  )
}
