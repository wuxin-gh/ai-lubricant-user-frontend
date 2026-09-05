import { useState } from "react"
import type { MessageType } from "./message"
import { IconAlertTriangle, IconReload } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

export const ErrorMessageItem = ({ message }: { message: MessageType }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [retrying, setRetrying] = useState(false)

  // 错误正文有两个来源字段：任务/编辑器的流与历史日志写 `text`，旧的 handler 写
  // `details`。这里只读 `details` 时，凡是走流过来的错误（429 无可用账号、provider
  // 鉴权失败、崩掉的一轮）徽章都渲染成**空白** —— 用户只看到一个红条却读不到原因。
  // 两个字段都取，谁有用谁。
  const detail = message.data.details || message.data.text || ""
  // 两种补救各自独立：重试 = 重发原文（对配置类失败足够）；修复 = 重载运行时后
  // 换一句 prompt 继续（对话崩坏时才需要）。回调没注入就不渲染对应按钮，避免死按钮。
  const canRetry = Boolean(message.onRetry)
  const canRepair = Boolean(message.onUserInput)
  const busy = repairing || retrying

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={100} closeDelay={200}>
      <HoverCardTrigger asChild>
        <Badge variant="destructive" className="max-w-[80%] cursor-pointer">
          <IconAlertTriangle className="size-4" />
          <div className="min-w-0 flex-1 whitespace-normal line-clamp-1 break-all">
            {detail || t("taskDetail.error.details")}
          </div>
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent className="max-w-[500px] w-auto p-4 flex flex-col gap-4" side="bottom" align="start">
        <Label>{t("taskDetail.error.details")}</Label>

        <pre className="bg-muted px-3 py-2 rounded-md whitespace-pre-wrap break-all text-xs overflow-y-auto max-h-[70vh]">
          {detail}
        </pre>

        {canRetry && <div className="flex flex-row gap-2 items-center">
          <p className="text-sm text-muted-foreground flex-1">{t("taskDetail.error.retryTip")}</p>
          <Button
            variant="default"
            size="sm"
            className="cursor-pointer"
            disabled={busy}
            onClick={async () => {
              if (busy) return
              setRetrying(true)
              try {
                const sent = await message.onRetry?.()
                if (!sent) {
                  toast.error(t("taskDetail.error.retryFailed"))
                  return
                }
                setOpen(false)
              } catch (error) {
                toast.error(error instanceof Error ? error.message : t("taskDetail.error.retryFailed"))
              } finally {
                setRetrying(false)
              }
            }}
          >
            <IconReload className={retrying ? "size-3 mr-1 animate-spin" : "size-3 mr-1"} />
            {retrying ? t("taskDetail.error.retrying") : t("taskDetail.error.retry")}
          </Button>
        </div>}

        {canRepair && <div className="flex flex-row gap-2 items-center">
          <p className="text-sm text-muted-foreground flex-1">{t("taskDetail.error.repairTip")}</p>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            disabled={busy}
            onClick={async () => {
              if (busy) return

              setRepairing(true)

              try {
                // 重载会话是可选的补救步骤：只有调用方接了它才做，且失败即中止。
                // 对「无可用账号」这类不需要重建运行时的失败，直接重发即可 —— 早先
                // 无条件要求 reload 成功，导致没接该回调时永远弹「修复失败」。
                if (message.onReloadSession) {
                  const reloaded = await message.onReloadSession()
                  if (!reloaded) {
                    toast.error(t("taskDetail.error.repairFailed"))
                    return
                  }
                }

                const sent = await message.onUserInput?.(t("taskDetail.error.continueTask"))
                if (!sent) {
                  toast.error(t("taskDetail.error.repairFailed"))
                  return
                }

                setOpen(false)
              } catch (error) {
                toast.error(error instanceof Error ? error.message : t("taskDetail.error.repairFailed"))
              } finally {
                setRepairing(false)
              }
            }}
          >
            <IconReload className={repairing ? "size-3 mr-1 animate-spin" : "size-3 mr-1"} />
            {repairing ? t("taskDetail.error.repairing") : t("taskDetail.error.repair")}
          </Button>
        </div>}
      </HoverCardContent>
    </HoverCard>
  )
}
