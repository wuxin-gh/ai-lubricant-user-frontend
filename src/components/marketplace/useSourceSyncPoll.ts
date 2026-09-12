/**
 * 内容源同步状态轮询 hook（agentscope / skillhub / agency-agents / leaderboard 共用）。
 *
 * 为什么需要它：同步是后端 asyncio 后台任务，``_progress.running`` 是进程内内存标志。
 * 前端按钮的「禁用/进度条」必须认这个**后端真值**，而不是本地 ``syncing`` 状态——
 * 否则一刷新页面本地状态归零、按钮又可点，但后端其实还在跑，再点就是 409「已有同步
 * 在运行中」；进度条也只在本地 ``syncing`` 为真时显示，刷新后看不到在跑的同步。
 *
 * 本 hook 统一三件事：
 * 1. ``running`` = 后端当前是否在跑（由调用方 ``isRunning`` 从状态里取）——按钮禁用、
 *    进度条、日志区 spinner 全认它；
 * 2. 只要 ``running`` 为真（含刷新后/load 时发现后端在跑）或本会话刚发起（``syncing``）
 *    就持续轮询，跑到 ``running`` 翻 false 停；
 * 3. 用 ``sawRunning`` 防抖完成判定——只有「见过 running=true 再变 false」才算跑完，
 *    避免在「刚 POST、后端还没置 running」的空窗期误判成完成。
 */
import { useEffect, useRef, useState } from "react"

export function useSourceSyncPoll<T>(
  fetchStatus: () => Promise<T>,
  isRunning: (status: T | null) => boolean,
  onDone?: (status: T) => void,
) {
  const [last, setLast] = useState<T | null>(null)
  /** 本会话点过「立即同步」按钮（POST 已发出，后端可能还没把 running 置 true）。 */
  const [syncing, setSyncing] = useState(false)

  // 调用方函数每次渲染可能换 identity（inline 箭头），用 ref 存最新值，effect 不依赖它们。
  const fetchRef = useRef(fetchStatus); fetchRef.current = fetchStatus
  const isRunningRef = useRef(isRunning); isRunningRef.current = isRunning
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone
  // 见过 running=true（本轮同步真正启动过的证据），用于区分「还没启动」与「已跑完」。
  const sawRunning = useRef(false)

  const running = isRunning(last)

  useEffect(() => {
    if (!syncing && !running) return
    let active = true
    let timer: number | null = null
    // 用 setTimeout 自调度（非 setInterval）：一次 tick 慢了不会与下一次重叠，且
    // 在 running/syncing 翻转时能干净停掉。
    const tick = async () => {
      try {
        const st = await fetchRef.current()
        if (!active) return
        setLast(st)
        const nowRunning = isRunningRef.current(st)
        if (nowRunning) sawRunning.current = true
        if (sawRunning.current && !nowRunning) {
          // 跑完了：复位、停轮询、通知调用方出 toast
          sawRunning.current = false
          setSyncing(false)
          onDoneRef.current?.(st)
        }
      } catch { /* 轮询失败静默，下一轮继续 */ }
      if (active) timer = window.setTimeout(tick, 2000)
    }
    timer = window.setTimeout(tick, 2000)
    return () => { active = false; if (timer != null) window.clearTimeout(timer) }
  }, [syncing, running])

  return { last, setLast, syncing, setSyncing, running }
}
