// GitHub 仓库识别（add-MCP/Skill/Plugin/项目提示词 的「从 GitHub 识别」入口）。
// 调 /api/v1/github/recognize 纯预览；引用落库走 resourceReferences.ts 的
// createReferenceFromGithub。识别端点包装服务端现成的 leaderboard_probe
// （仓库形态探测：.mcp.json / SKILL.md / .claude-plugin/marketplace.json /
// AGENTS.md / README 命令提示）。

export type GithubRecognizeSkillEntry = {
  name: string
  path: string
  entry: string
  editors: string[]
}

export type GithubRecognizeType = "skills" | "plugin" | "skill" | "mcp" | "prompt"

export type GithubRecognizeResult = {
  repo_full_name: string
  ref: string
  head_sha: string
  /** 单选主类型（skills|plugin|skill|mcp|prompt），优先级 skills>plugin>skill>mcp>prompt。 */
  type: GithubRecognizeType | ""
  /** 自动判定类型（force_type 前的值，便于 UI 显示“自动识别为 X”）。 */
  auto_type: GithubRecognizeType | ""
  modules: string[]
  install_spec: Record<string, any>
  launch_spec: Record<string, any>
  /** skill 列表：type=skill 恰 1 项；type=skills N 项（集合整包安装，任务期再勾子技能）。 */
  skill_entries: GithubRecognizeSkillEntry[]
  /** 仓库元数据（识别时一次拉取）：预填描述等编辑默认值。 */
  repo_meta: {
    description: string
    default_branch: string
    stars?: number | null
    homepage: string
    topics: string[]
  }
  summary: {
    tree_count: number
    truncated: boolean
    hit_files: string[]
    hints: Record<string, { pkg: string; text: string }[]>
  }
}

async function postRecognize(body: Record<string, unknown>): Promise<GithubRecognizeResult> {
  const response = await fetch("/api/v1/github/recognize", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload ? (payload as { detail: unknown }).detail : undefined
    throw new Error(typeof detail === "string" ? detail : `HTTP ${response.status}`)
  }
  const envelope = payload as { code: number; message: string; data: GithubRecognizeResult }
  if (envelope.code !== 0) throw new Error(envelope.message || "识别失败")
  return envelope.data
}

/** 探测一个 GitHub 仓库（纯预览，不落库）。ref 可空（默认分支）；type 非空=用户改类型后重新识别。 */
export function recognizeGithubRepo(repo: string, ref?: string, type?: GithubRecognizeType): Promise<GithubRecognizeResult> {
  const body: Record<string, unknown> = { repo }
  if (ref) body.ref = ref
  if (type) body.type = type
  return postRecognize(body)
}
