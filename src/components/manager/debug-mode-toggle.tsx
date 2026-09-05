/**
 * 全局调试 / 生产模式切换。
 *
 * 控制后端主配置的 system.debug。切换时先拉最新配置再合并 PUT，避免覆盖
 * 其他字段；菜单项与旧按钮共用同一份状态和更新流程。
 */
import { useEffect, useState } from 'react'
import { Bug } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { getMainConfig, updateMainConfig } from '@/@admin-port/api/dashboard'
import type { MainConfig } from '@/@admin-port/types/admin'

export function DebugModeToggle() {
  const [debug, setDebug] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    getMainConfig()
      .then((data: MainConfig) => {
        if (!cancelled) setDebug(Boolean(data?.system?.debug))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = async () => {
    const next = !debug
    setPending(true)
    try {
      const fresh = await getMainConfig()
      const patch = { ...fresh, system: { ...fresh.system, debug: next } } as Record<string, unknown>
      await updateMainConfig(patch)
      setDebug(next)
      toast.success(`已切换至${next ? '调试' : '生产'}模式`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <DropdownMenuItem
      disabled={loading || pending}
      onSelect={(event) => {
        event.preventDefault()
        void toggle()
      }}
    >
      <Bug className={debug ? 'text-yellow-500' : undefined} />
      <span className="flex-1">运行模式</span>
      <span className="text-xs text-muted-foreground">
        {loading || pending ? '处理中…' : debug ? '调试' : '生产'}
      </span>
    </DropdownMenuItem>
  )
}
