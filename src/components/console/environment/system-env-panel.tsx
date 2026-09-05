/**
 * 系统内置环境（env_mode=system）面板：看清、装进、卸下、归档节点操作者本机 HOME 的资源。
 *
 * 为什么单独一个面板而不是复用 EnvironmentPanel：共用环境是平台建的目录，可以"期望集合
 * 同步 + 多余就删"；操作者的 HOME 不是我们的，里面有他手工装的东西。所以这里的规则是：
 *   - 默认只读：清单是主体，先让用户看见系统档实际会拿到什么；
 *   - 写是增量：同名默认跳过，覆盖要用户显式勾选；
 *   - 卸载有边界：只能卸平台装过的（节点侧按自己的 manifest 复核，拒绝其他一切）。
 *
 * 「本机自有」的条目可以归档入库——打包上传成平台资源，其他节点/共用环境就能复用。
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Archive, Download, RefreshCw, Trash2 } from "lucide-react"

import {
  archiveSystemEnvResource,
  getSystemEnv,
  installSystemEnvResource,
  refreshSystemEnv,
  removeSystemEnvResource,
  type SystemEnvDetail,
  type SystemEnvEntry,
  type SystemEnvFileKind,
  type SystemEnvTouched,
} from "@/api/systemEnvClient"
import { listEffectiveResources, type ResourceReference } from "@/api/resourceReferences"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"

const KIND_SECTIONS = [
  { kind: "skill", label: "技能", installable: true },
  { kind: "plugin", label: "插件", installable: true },
  // MCP 是配置不是文件：节点故意不写操作者的 ~/.mcp.json（会把任务凭据落到他目录里），
  // 所以这里只展示他自己配了什么，不提供装/卸。
  { kind: "mcp", label: "MCP", installable: false },
] as const

/** 节点回报的 path 字段在 install/remove 回执里承载动作名。 */
function touchedLabel(entry: SystemEnvTouched): string {
  switch (entry.path) {
    case "installed": return "已安装"
    case "skipped": return "已存在，跳过"
    case "removed": return "已卸载"
    default: return entry.path || "完成"
  }
}

export interface SystemEnvPanelProps {
  nodeId: string
}

export function SystemEnvPanel({ nodeId }: SystemEnvPanelProps) {
  const [detail, setDetail] = useState<SystemEnvDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [installKind, setInstallKind] = useState<SystemEnvFileKind | null>(null)
  const [removeTarget, setRemoveTarget] = useState<SystemEnvEntry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDetail(await getSystemEnv(nodeId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载系统环境失败")
    } finally {
      setLoading(false)
    }
  }, [nodeId])

  useEffect(() => { void load() }, [load])

  const doRefresh = async () => {
    setBusy("refresh")
    try {
      await refreshSystemEnv(nodeId)
      toast.success("已重新扫描节点本机环境")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "扫描失败")
    } finally {
      setBusy(null)
    }
  }

  const doInstall = async (kind: SystemEnvFileKind, resourceId: string, overwrite: boolean) => {
    setBusy(`install:${resourceId}`)
    try {
      const touched = await installSystemEnvResource(nodeId, { kind, resource_id: resourceId, overwrite })
      const skipped = touched.filter((item) => item.path === "skipped")
      if (skipped.length > 0 && !overwrite) {
        toast.warning(`本机已存在同名${kind === "skill" ? "技能" : "插件"}，已跳过；勾选「覆盖同名」可替换`)
      } else {
        toast.success(touched.map(touchedLabel).join("；") || "已下发安装")
      }
      setInstallKind(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "安装失败")
    } finally {
      setBusy(null)
    }
  }

  const doArchive = async (entry: SystemEnvEntry) => {
    setBusy(`archive:${entry.id}`)
    try {
      const result = await archiveSystemEnvResource(nodeId, {
        kind: entry.kind as SystemEnvFileKind,
        name: entry.name,
      })
      toast.success(`已归档入库：${result.reference_name || entry.name}`)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "归档失败")
    } finally {
      setBusy(null)
    }
  }

  const doRemove = async (entry: SystemEnvEntry) => {
    setBusy(`remove:${entry.id}`)
    try {
      await removeSystemEnvResource(nodeId, entry.kind, entry.name)
      toast.success(`已卸载 ${entry.name}`)
      setRemoveTarget(null)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "卸载失败")
    } finally {
      setBusy(null)
    }
  }

  const total = useMemo(
    () => Object.values(detail?.resources || {}).reduce((sum, rows) => sum + rows.length, 0),
    [detail],
  )

  if (loading) {
    return <div className="flex h-32 items-center justify-center"><Spinner /></div>
  }

  if (detail && !detail.system_env_enabled) {
    return (
      <div className="flex flex-col gap-3 rounded border border-dashed p-4 text-sm">
        <span className="font-medium">该节点未开启系统内置环境</span>
        <p className="text-muted-foreground">
          系统内置环境让任务直接跑在节点操作者的本机 HOME 上，复用他已装的 CLI 与登录态。
          宿主机安装的节点默认开启，容器节点默认关闭（容器里的 HOME 是镜像的，不是操作者的）。
        </p>
        <p className="text-muted-foreground">
          开启方式：节点启动时设置环境变量{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            AGENT_COMPOSE_NODE_ALLOW_SYSTEM_ENV=on
          </code>
          （或 <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">--allow-system-env=on</code>），
          重启后节点会重新上报能力位。
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">节点本机环境（系统内置档实际会用到的资源）</span>
          <span className="text-xs text-muted-foreground">
            共 {total} 项
            {detail?.last_reported_at ? ` · 最近扫描 ${new Date(detail.last_reported_at).toLocaleString()}` : " · 尚未扫描"}
            {detail && !detail.online ? " · 节点当前离线" : ""}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || !detail?.online}
          title={detail?.online ? "让节点重新扫描本机 HOME" : "节点离线，无法扫描"}
          onClick={() => void doRefresh()}
        >
          <RefreshCw className="size-3.5" /> 刷新清单
        </Button>
      </div>

      {KIND_SECTIONS.map((section) => {
        const rows = detail?.resources?.[section.kind] || []
        return (
          <div key={section.kind} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {section.label}（{rows.length}）
                {section.kind === "mcp" ? " · 配置项，仅展示" : ""}
              </span>
              {section.installable ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !detail?.online}
                  onClick={() => setInstallKind(section.kind as SystemEnvFileKind)}
                >
                  <Download className="size-3.5" /> 从平台安装
                </Button>
              ) : null}
            </div>
            <div className="overflow-hidden rounded border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">名称</th>
                    <th className="px-3 py-2 text-left font-medium">版本</th>
                    <th className="px-3 py-2 text-left font-medium">来源</th>
                    <th className="px-3 py-2 text-left font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-3 text-xs text-muted-foreground">
                        暂无{section.label}。点「刷新清单」让节点重新扫描。
                      </td>
                    </tr>
                  ) : (
                    rows.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-3 py-2">
                          <div className="truncate font-medium">{entry.name}</div>
                          {entry.path ? (
                            <div className="truncate font-mono text-[11px] text-muted-foreground">
                              ~/{entry.path}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {entry.version ? `v${entry.version}` : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={entry.platform_managed ? "outline" : "secondary"}>
                            {entry.platform_managed ? "平台已装" : "本机自有"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          {section.installable ? (
                            entry.platform_managed ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy !== null || !detail?.online}
                                onClick={() => setRemoveTarget(entry)}
                              >
                                <Trash2 className="size-3.5" /> 卸载
                              </Button>
                            ) : entry.archived_reference_id ? (
                              <Badge variant="secondary">已入库</Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy !== null || !detail?.online}
                                title="打包上传，归档为平台资源，其他节点也能安装"
                                onClick={() => void doArchive(entry)}
                              >
                                <Archive className="size-3.5" /> 归档入库
                              </Button>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {installKind ? (
        <InstallResourceDialog
          kind={installKind}
          busy={busy !== null}
          onClose={() => setInstallKind(null)}
          onPick={(resourceId, overwrite) => void doInstall(installKind, resourceId, overwrite)}
        />
      ) : null}

      <AlertDialog open={removeTarget !== null} onOpenChange={(open) => (open ? undefined : setRemoveTarget(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认卸载 {removeTarget?.name}？</AlertDialogTitle>
            <AlertDialogDescription>
              会删除节点本机 HOME 里的这份文件，并移除平台侧的记录。只能卸载平台装过的资源；
              节点操作者自己装的不受影响。已归档进资源库的副本不会被撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { if (removeTarget) void doRemove(removeTarget) }}
            >
              卸载
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** 从已授权的平台资源里挑一个装进本机 HOME，底部可选「覆盖同名」。 */
function InstallResourceDialog({
  kind, busy, onClose, onPick,
}: {
  kind: SystemEnvFileKind
  busy: boolean
  onClose: () => void
  onPick: (resourceId: string, overwrite: boolean) => void
}) {
  const [rows, setRows] = useState<ResourceReference[]>([])
  const [loading, setLoading] = useState(true)
  const [overwrite, setOverwrite] = useState(false)
  const kindLabel = kind === "skill" ? "技能" : "插件"

  useEffect(() => {
    let active = true
    setLoading(true)
    void listEffectiveResources(kind)
      .then((items) => { if (active) setRows(items) })
      .catch((err) => { if (active) toast.error(err instanceof Error ? err.message : `加载${kindLabel}失败`) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [kind, kindLabel])

  return (
    <Dialog open onOpenChange={(v) => (v ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>安装{kindLabel}到节点本机</DialogTitle></DialogHeader>
        {loading ? (
          <div className="flex h-32 items-center justify-center"><Spinner /></div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            没有已授权的{kindLabel}。先在资源页引用并授权给你的分组。
          </p>
        ) : (
          <div className="max-h-[50vh] divide-y overflow-auto rounded border">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                disabled={busy}
                className="block w-full px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => onPick(row.id, overwrite)}
              >
                <div className="truncate text-sm">{row.display_name || row.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {row.version ? `v${row.version}` : "无版本"} · {row.market_id}
                </div>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-start gap-2 rounded border bg-muted/30 px-3 py-2">
          <Checkbox
            id="system-env-overwrite"
            checked={overwrite}
            onCheckedChange={(value) => setOverwrite(value === true)}
          />
          <Label htmlFor="system-env-overwrite" className="flex flex-col gap-0.5 text-xs font-normal">
            <span>覆盖同名资源</span>
            <span className="text-muted-foreground">
              不勾选时，本机已存在同名资源会跳过——那份可能是节点操作者自己装的。
            </span>
          </Label>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SystemEnvPanel
