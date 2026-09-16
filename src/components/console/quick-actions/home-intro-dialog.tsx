/**
 * 首页首次引导 —— 向导式：不是罗列「每个入口是干啥的」，而是带用户把第一件事做完。
 *
 * 三步：
 *   ① 先让用户明白"这一步要做什么"（一句话，不说功能说明）
 *   ② 选一个想先做的事（就是那 8 张卡的入口，选中即进入下一步）
 *   ③ 带他直接进入那件事的流程（关掉引导、打开对应弹框），事做完再回来
 *
 * 只做一次（localStorage 记已看过）；用户跳过也不拦。
 */
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Code2,
  Globe,
  Network,
  Server,
  Sparkles,
  Store,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { QuickActionId } from "./quick-actions"

const SEEN_KEY = "home-quick-actions-intro-seen"

/** 让用户挑的"第一件事"：只放能直接做成一件事的入口（文档/密钥/群这类不算）。 */
const FIRST_CHOICES: Array<{ id: QuickActionId; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "coding", icon: Sparkles },
  { id: "editor", icon: Code2 },
  { id: "provider", icon: Server },
  { id: "external", icon: Globe },
  { id: "resources", icon: Blocks },
  { id: "browser", icon: Network },
  { id: "phone", icon: Network },
  { id: "proxy", icon: Store },
]

export function HomeIntroDialog({
  onStart,
  onShowCommunity,
}: {
  /**
   * 用户选好第一件事。父层负责排序：先弹技术交流群，群关掉后再打开这个流程
   * （同时弹两个 modal 会叠在一起）。
   */
  onStart: (id: QuickActionId) => void
  /** 引导结束（开始或跳过都算）：父层据此展示技术交流群。 */
  onShowCommunity?: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<QuickActionId | null>(null)

  // 首次进入才弹：已看过（localStorage 有标记）就不打扰。
  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY) !== "1") setOpen(true)
    } catch {
      // 隐私模式下 localStorage 可能不可用：不弹引导，别把首页搞崩。
    }
  }, [])

  const markSeen = () => {
    try {
      localStorage.setItem(SEEN_KEY, "1")
    } catch {
      // 写不进去也无所谓。
    }
  }

  const close = () => {
    markSeen()
    setPicked(null)
    setOpen(false)
  }

  /** 跳过引导：同样记已看过，并按需求展示技术交流群。 */
  const skip = () => {
    close()
    onShowCommunity?.()
  }

  const begin = () => {
    if (!picked) return
    markSeen()
    const id = picked
    setPicked(null)
    setOpen(false)
    onStart(id)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
        {picked === null ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("quickActions.intro.welcomeTitle", "先带你做一件事")}</DialogTitle>
              <DialogDescription>
                {t(
                  "quickActions.intro.welcomeDesc",
                  "第一次来不用先研究功能。下面挑一件你现在最想做的事，我直接带你走一遍，做完你就知道怎么用了。",
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {FIRST_CHOICES.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPicked(id)}
                  className="flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
                >
                  <Icon className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {t(`quickActions.items.${id}.title`, id)}
                  </span>
                </button>
              ))}
            </div>

            <DialogFooter className="justify-between sm:justify-between">
              <Button variant="ghost" onClick={skip}>
                {t("quickActions.intro.skip", "我先自己看看")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                {t("quickActions.intro.confirmTitle", "带你做：{{title}}", {
                  title: t(`quickActions.items.${picked}.title`, picked),
                })}
              </DialogTitle>
              <DialogDescription>
                {t(
                  "quickActions.intro.confirmDesc",
                  "点「开始」，我把这个流程打开并一步步带你走。中途不想继续随时可以关掉。",
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              {FIRST_CHOICES.map(({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPicked(id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
                    picked === id ? "border-primary bg-primary/5" : "hover:bg-muted/30",
                  )}
                >
                  <Icon className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {t(`quickActions.items.${id}.title`, id)}
                  </span>
                </button>
              ))}
            </div>

            <DialogFooter className="justify-between sm:justify-between">
              <Button variant="ghost" onClick={() => setPicked(null)}>
                <ArrowLeft className="size-4" />
                {t("quickActions.back", "上一步")}
              </Button>
              <Button onClick={begin}>
                {t("quickActions.intro.start", "开始")}
                <ArrowRight className="size-4" />
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
