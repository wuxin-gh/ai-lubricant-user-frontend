/**
 * 统一复制动作：走 @/utils/clipboard 的 copyToClipboard（禁裸 navigator.clipboard，
 * 见 [[frontend-clipboard-compat-util]]），带统一 toast 反馈。
 *
 * 原是 resources.tsx 的私有 copyText；快捷操作弹框与该页共用同一口径。
 */
import { toast } from "sonner"
import { copyToClipboard } from "@/utils/clipboard"

export async function copyText(text: string) {
  if (await copyToClipboard(text)) {
    toast.success("已复制")
  } else {
    toast.error("复制失败，请手动选择")
  }
}
