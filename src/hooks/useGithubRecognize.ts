// 「从 GitHub 识别」共享状态机：输入 → 探测 → 预览结果 + 错误。
// 只管调 /api/v1/github/recognize 与状态；展示与「引用 / 安装」二选一由各对话框自渲染
// （四类资源 add 表单字段差异大，强行抽一个通用 UI 反而绕）。
//
// 识别端点服务端包装现成的 leaderboard_probe，不重复探测逻辑；返回的 install_spec
// 是 GitHub 坐标（github_clone / download_url），「引用」模式据此建 ResourceReference
// （服务器零拷贝），「安装」模式仍走各资源既有的 import/url 下载 zip 入库。

import { useCallback, useRef, useState } from "react"

import {
  recognizeGithubRepo,
  type GithubRecognizeResult,
  type GithubRecognizeType,
} from "@/api/githubRecognition"

export type UseGithubRecognize = {
  input: string
  setInput: (value: string) => void
  loading: boolean
  result: GithubRecognizeResult | null
  error: string
  /** 识别（type 非空 = 用户改类型后重新识别，按所选类型重派生）。 */
  recognize: (input?: string, type?: GithubRecognizeType) => Promise<GithubRecognizeResult | null>
  reset: () => void
}

export function useGithubRecognize(): UseGithubRecognize {
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GithubRecognizeResult | null>(null)
  const [error, setError] = useState("")
  // 丢弃过期响应：快速连点「识别」时只认最后一次。
  const reqIdRef = useRef(0)

  const recognize = useCallback(async (override?: string, type?: GithubRecognizeType) => {
    const repo = (override ?? input).trim()
    if (!repo) {
      setError("请输入 GitHub 仓库地址")
      return null
    }
    const reqId = ++reqIdRef.current
    setLoading(true)
    setError("")
    try {
      const data = await recognizeGithubRepo(repo, undefined, type)
      if (reqId !== reqIdRef.current) return null
      setResult(data)
      return data
    } catch (e) {
      if (reqId !== reqIdRef.current) return null
      setError((e as Error)?.message || "识别失败")
      setResult(null)
      return null
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [input])

  const reset = useCallback(() => {
    reqIdRef.current++
    setInput("")
    setResult(null)
    setError("")
    setLoading(false)
  }, [])

  return { input, setInput, loading, result, error, recognize, reset }
}
