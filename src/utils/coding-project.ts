/**
 * 「上次进入的项目」：Coding 模式下次进入时直接打开它。
 *
 * 只存 id，不存项目对象——项目可能被删、被移出可见范围。读取方（App.tsx 的
 * CodingIndexRoute）必须拿服务端返回的项目列表校验这个 id 是否还在，不在就回落到
 * 项目选择页，避免直接跳到一个 404 的详情页。
 */
const STORAGE_KEY = "ai-lubricant.coding.lastProjectId"

/** 记住/清除上次进入的项目；传空值即清除。 */
export function rememberCodingProject(projectId?: string | null): void {
  try {
    if (projectId) window.localStorage.setItem(STORAGE_KEY, projectId)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 隐私模式 / 配额满：记不住就退回「每次都要选一次」，不影响功能。
  }
}

/** 上次进入的项目 id；没有或读不到时返回 null。 */
export function rememberedCodingProjectId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || null
  } catch {
    return null
  }
}
