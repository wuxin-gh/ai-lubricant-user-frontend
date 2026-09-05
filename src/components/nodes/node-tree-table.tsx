/**
 * 节点父子树表格——管理端与用户侧共用的渲染骨架。
 *
 * 只负责"怎么画"：管理节点父行 + 其下执行节点子行 + 末尾未受管合成组，以及每列
 * 展示什么。**不负责"能做什么"**——操作列由调用方通过 `renderManagerActions` /
 * `renderExecutionActions` 注入。这是两侧权限差异的唯一落点：用户侧不注入审批/
 * 移动/删除，这些操作就天然不存在，不需要在表格内部写 `mode === "admin"` 分支。
 *
 * 列集合用 `columns` 声明（管理端 3 列 + 用户侧 6 列的差异），避免条件渲染散落。
 */
import { Fragment, type ReactNode } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Spinner } from "@/components/ui/spinner"
import { ROLE_LABEL } from "@/pages/manager/platform/nodes/types"
import {
  EditorsCell,
  MachineFactCell,
  NodeCell,
  NodeStatusBadge,
  VersionCell,
} from "./node-cells"
import type { NodeGroup, NodeView } from "./node-view"

/** 可选列。`node` 与 `actions` 恒在，不在这里声明。 */
export type NodeColumn = "system" | "cpu" | "memory" | "version" | "editors" | "status"

const COLUMN_META: Record<NodeColumn, { label: string; width: string }> = {
  system: { label: "系统", width: "w-[150px]" },
  cpu: { label: "CPU", width: "w-[180px]" },
  memory: { label: "内存", width: "w-[110px]" },
  version: { label: "节点客户端版本", width: "w-[130px]" },
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
  actionsWidth = "w-[440px]",
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
            return (
              <Fragment key={group.key}>
                {/* 父行：管理节点（分组容器 / 管理客户端）或未受管合成组。 */}
                <TableRow className="bg-muted/40">
                  <TableCell className="align-middle text-center whitespace-normal">
                    {manager ? (
                      <NodeCell
                        view={manager}
                        kindLabel={ROLE_LABEL.management}
                        badgeClass="text-purple-600 dark:text-purple-400"
                        subTag={
                          manager.displayOnly
                            ? { label: "仅归属展示", className: "text-slate-500 dark:text-slate-400" }
                            : manager.isPassive
                              ? { label: "不可管理", className: "text-slate-600 dark:text-slate-300" }
                              : { label: "可管理", className: "text-emerald-600 dark:text-emerald-400" }
                        }
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-center">
                        <span className="font-medium text-muted-foreground">未受管 / 直连</span>
                        <span className="text-xs text-muted-foreground">
                          未归属任何管理节点的执行节点
                        </span>
                      </div>
                    )}
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

                {/* 子行：该管理节点下的执行节点。 */}
                {group.children.length === 0 ? (
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
                      <TableCell className="align-middle pl-10 text-center whitespace-normal">
                        <NodeCell
                          view={node}
                          kindLabel={ROLE_LABEL.execution}
                          badgeClass="text-blue-600 dark:text-blue-400"
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
