import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import {
  clearMyShellPolicies,
  deleteMyShellPolicy,
  getShellApprovalCatalog,
  listMyShellPolicies,
  putMyShellPolicy,
  type MyShellPolicy,
  type PresetCatalogItem,
  type ShellFlavor,
} from "@/api/shellApproval"

const SHELLS: { value: ShellFlavor; label: string }[] = [
  { value: "posix", label: "POSIX" },
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "unknown", label: "未知" },
]

/**
 * 设置弹框内的「命令审批策略」分区：当前用户管理自己的 node_shell_exec 免审清单。
 *
 * 顶部切换 shell（POSIX/PowerShell/CMD/未知），下方列出该 shell 的预置命令目录，
 * 勾选即 PUT 入库、取消即 DELETE。再下方可追加自定义命令，仅当能归一化为单一安全
 * token 时入库（后端会拒绝重定向/管道/命令替换/脚本块）。仅作用于本人发起的 Agent
 * 终端命令；危险结构即使勾选仍会要求确认（与平台默认分类器底线一致）。
 */
export default function ShellApprovalSettings() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [shell, setShell] = useState<ShellFlavor>("posix")
  const [catalog, setCatalog] = useState<Record<ShellFlavor, PresetCatalogItem[]>>({} as Record<ShellFlavor, PresetCatalogItem[]>)
  const [policies, setPolicies] = useState<MyShellPolicy[]>([])
  const [customInput, setCustomInput] = useState("")
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [cat, mine] = await Promise.all([getShellApprovalCatalog(), listMyShellPolicies()])
      setCatalog(cat.catalog)
      setPolicies(mine.policies ?? [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载审批策略失败")
      setCatalog({} as Record<ShellFlavor, PresetCatalogItem[]>)
      setPolicies([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const checkedKeys = useMemo(() => {
    const s = shell
    return new Set(policies.filter((p) => p.shell_flavor === s).map((p) => p.command_key))
  }, [policies, shell])

  const presetItems = catalog[shell] ?? []
  const customKeys = useMemo(() => {
    const preset = new Set(presetItems.map((i) => i.key))
    return policies
      .filter((p) => p.shell_flavor === shell && !preset.has(p.command_key))
      .map((p) => p.command_key)
  }, [policies, shell, presetItems])

  async function toggle(key: string, on: boolean) {
    if (busy) return
    setBusy(true)
    try {
      if (on) {
        await putMyShellPolicy(key, shell)
      } else {
        await deleteMyShellPolicy(key, shell)
      }
      setPolicies((prev) =>
        on
          ? prev.some((p) => p.command_key === key && p.shell_flavor === shell)
            ? prev
            : [...prev, { command_key: key, shell_flavor: shell }]
          : prev.filter((p) => !(p.command_key === key && p.shell_flavor === shell)),
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新审批策略失败")
    } finally {
      setBusy(false)
    }
  }

  async function addCustom() {
    const value = customInput.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      await putMyShellPolicy(value, shell)
      setPolicies((prev) =>
        prev.some((p) => p.command_key === value.toLowerCase() && p.shell_flavor === shell)
          ? prev
          : [...prev, { command_key: value.toLowerCase(), shell_flavor: shell }],
      )
      setCustomInput("")
      toast.success("已加入免审清单")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "添加失败")
    } finally {
      setBusy(false)
    }
  }

  async function clearAll() {
    if (busy) return
    setBusy(true)
    try {
      await clearMyShellPolicies()
      setPolicies([])
      toast.success("已清空")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清空失败")
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">{t("consoleSettings.shellApproval.title", "命令审批策略")}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t(
              "consoleSettings.shellApproval.description",
              "管理你自己发起的 Agent 终端命令免审清单：勾选的命令在本人对话中跳过审批卡直接执行；未勾选维持平台默认。仅作用于本人发起的命令，危险结构（重定向、管道给 shell、脚本块等）即使勾选仍要求确认。",
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()}>
          <RefreshCw className="size-4" />
          {t("consoleSettings.shellApproval.refresh", "刷新")}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("consoleSettings.shellApproval.shell", "终端类型")}</span>
        <div className="flex flex-wrap gap-1">
          {SHELLS.map((s) => (
            <Button
              key={s.value}
              size="sm"
              variant={shell === s.value ? "default" : "outline"}
              onClick={() => setShell(s.value)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {/* 预置目录 */}
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("consoleSettings.shellApproval.presetTitle", "预置命令")}
          </h3>
          {presetItems.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
              {t("consoleSettings.shellApproval.presetEmpty", "该终端类型暂无预置命令。")}
            </div>
          ) : (
            <ul className="space-y-1.5">
              {presetItems.map((item) => {
                const on = checkedKeys.has(item.key)
                return (
                  <li
                    key={`${shell}:${item.key}`}
                    className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{item.label}</span>
                        <code className="text-[11px] text-muted-foreground">{item.key}</code>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <Switch checked={on} onCheckedChange={(v) => void toggle(item.key, v)} disabled={busy} />
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* 自定义命令 */}
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("consoleSettings.shellApproval.customTitle", "自定义命令")}
          </h3>
          <div className="flex items-center gap-2">
            <Input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void addCustom()
                }
              }}
              placeholder={t(
                "consoleSettings.shellApproval.customPlaceholder",
                "输入单条命令名，如 rm 或 git:reset",
              )}
              disabled={busy}
            />
            <Button size="sm" onClick={() => void addCustom()} disabled={busy || !customInput.trim()}>
              {t("consoleSettings.shellApproval.add", "添加")}
            </Button>
          </div>
          {customKeys.length > 0 ? (
            <ul className="space-y-1.5">
              {customKeys.map((key) => (
                <li
                  key={`custom:${shell}:${key}`}
                  className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">自定义</Badge>
                    <code className="truncate text-sm">{key}</code>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    title="移除"
                    onClick={() => void toggle(key, false)}
                    disabled={busy}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("consoleSettings.shellApproval.customHint", "仅能加入可归一化为单一安全命令的条目；含重定向、管道给 shell、脚本块等的复合命令会被拒绝。")}
            </p>
          )}
        </section>
      </div>

      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-xs text-muted-foreground">
          {t("consoleSettings.shellApproval.scopeNote", "仅作用于本人发起的 Agent 终端命令；管理员代发不受个人策略影响。")}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void clearAll()} disabled={busy || policies.length === 0}>
          {t("consoleSettings.shellApproval.clearAll", "清空全部")}
        </Button>
      </div>
    </div>
  )
}
