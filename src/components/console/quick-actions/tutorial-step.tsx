/**
 * 接入引导里的单个步骤卡：序号圆徽 + 标题 + 任意内容。
 *
 * 原是 resources.tsx 的私有组件（设备/浏览器接入引导共用）；随「首页快捷操作」
 * 需要在首页弹框内复用，提为共享组件。视觉与语义与原版完全一致。
 */
import type { ReactNode } from "react"

export function TutorialStep({
  index,
  title,
  children,
}: {
  index: number
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex gap-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {index}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="font-medium">{title}</div>
        {children}
      </div>
    </div>
  )
}
