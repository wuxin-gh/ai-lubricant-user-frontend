/**
 * GET single-flight（在途合并）工具。
 *
 * 背景：入口在 dev 下是 React StrictMode，挂载 effect 会双跑；多条请求链路
 * （apiRequest / 管理端 axios / 生成版 Api）此前各自独立，同一时刻的相同
 * GET 会原样打满网络。这里提供一个公共的在途合并出口——并发发起的相同
 * GET 共享同一个 Promise，完成后 Map 清理，不做任何持久缓存，也不合并
 * 写请求（POST/PUT/PATCH/DELETE 语义各调各的）。
 *
 * 约束：
 * - key 由调用方拼（method + url + 稳定序列化后的参数），本模块只管合并。
 * - 调用方带了独立 AbortSignal 时不要走合并（一个调用者取消会误伤所有
 *   共享者），直接发独立请求。
 * - 失败不缓存：rejected 后 Map 即清，下一次 GET 正常重试。
 */

const inflight = new Map<string, Promise<unknown>>()

/** 稳定序列化：键按字典序排，避免对象键顺序不同导致漏合并。 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value !== "object") return JSON.stringify(value) ?? ""
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const body = keys
    .filter((key) => {
      const entry = (value as Record<string, unknown>)[key]
      return entry !== undefined && entry !== null && entry !== ""
    })
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(",")
  return `{${body}}`
}

/** 生成 single-flight 的 key：method + 路径 + 稳定序列化参数。 */
export function getSingleFlightKey(method: string, url: string, params?: unknown): string {
  const verb = method.toUpperCase()
  const query = params ? stableStringify(params) : ""
  return `${verb} ${url}${query ? ` ${query}` : ""}`
}

/**
 * 相同 key 的 GET 在途只发一次：并发调用共享同一 Promise，任一完成后
 * 释放（成功失败都清）。只应由无独立取消信号的调用方使用。
 */
export function singleFlightGet<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const request = load().finally(() => {
    if (inflight.get(key) === request) {
      inflight.delete(key)
    }
  })
  inflight.set(key, request)
  return request
}

/** 仅供测试/登出重置使用。 */
export function clearSingleFlight(): void {
  inflight.clear()
}

/** 当前在途请求数（测试断言用）。 */
export function singleFlightCount(): number {
  return inflight.size
}
