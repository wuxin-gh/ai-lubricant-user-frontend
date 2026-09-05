import { QrCode } from "lucide-react"
import { cn } from "@/lib/utils"

// 技术交流群 / 客服群二维码占位。原 monkeycode 群二维码 PNG 已删除，此处预留：
// 后续把自己的群二维码 PNG 放回 public/，把调用处换回 <img src={publicUrl(...)}> 即可恢复。
export function CommunityQrPlaceholder({
  className,
  label,
}: {
  className?: string
  label?: string
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "flex items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 text-muted-foreground/50",
        className,
      )}
    >
      <QrCode className="size-8 shrink-0" />
    </div>
  )
}
