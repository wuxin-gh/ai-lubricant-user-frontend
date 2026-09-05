import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { editorDisplayName, getManagerEditors, getManagerEditor, closeManagerEditorSession, type EditorInstance } from "@/api/editorClient"

export default function ManagerEditorsPage() {
  const [rows, setRows] = useState<EditorInstance[]>([])
  const [selected, setSelected] = useState<EditorInstance | null>(null)
  const [projectFilter, setProjectFilter] = useState("")
  const [loading, setLoading] = useState(true)
  const load = async () => {
    setLoading(true)
    try {
      const result = await getManagerEditors(projectFilter ? { project_id: projectFilter } : {})
      setRows(result.rows)
    } catch (error) { toast.error(error instanceof Error ? error.message : "加载编辑器失败") } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  return <div className="flex h-full min-h-0 flex-col gap-5 overflow-auto p-4 md:p-6"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">编辑器管理</h1><p className="text-sm text-muted-foreground">跨用户、跨项目查看编辑器实例、会话和运行状态。</p></div><Button onClick={() => void load()} disabled={loading}>{loading ? <Spinner /> : "刷新"}</Button></header><div className="flex gap-2"><Input className="max-w-sm" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} placeholder="按项目 ID 筛选" /><Button variant="outline" onClick={() => void load()}>查询</Button></div><div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.6fr)]"><Card><CardHeader><CardTitle className="text-base">编辑器列表</CardTitle></CardHeader><CardContent className="space-y-2">{rows.map((editor) => <button key={editor.id} type="button" onClick={() => void getManagerEditor(editor.id).then(setSelected).catch(() => toast.error("加载详情失败"))} className="w-full rounded border p-3 text-left hover:bg-muted/50"><div className="flex items-center justify-between"><span className="font-medium">{editorDisplayName(editor)}</span><Badge variant="secondary">{editor.provider}</Badge></div><div className="mt-1 text-xs text-muted-foreground">project: {editor.project_id || "未绑定"} · node: {editor.node_id || "自动"}</div></button>)}{!rows.length && !loading ? <p className="py-8 text-center text-sm text-muted-foreground">暂无编辑器</p> : null}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">编辑器详情</CardTitle></CardHeader><CardContent>{selected ? <div className="space-y-4"><div className="flex flex-wrap gap-2"><Badge>{selected.provider}</Badge><Badge variant="outline">{selected.status}</Badge><span className="text-sm text-muted-foreground">项目：{selected.project_id || "未绑定"}</span></div><div><h3 className="mb-2 font-medium">会话</h3><div className="space-y-2">{(selected.sessions || []).map((session) => <div key={session.id} className="flex items-center justify-between rounded border p-3 text-sm"><div><span className="font-mono">{session.id}</span><span className="ml-2 text-muted-foreground">{session.model || "默认模型"}</span><Badge className="ml-2" variant="outline">{session.status}</Badge></div>{session.status !== "closed" ? <Button size="sm" variant="outline" onClick={() => void closeManagerEditorSession(selected.id, session.id).then(() => getManagerEditor(selected.id)).then(setSelected).catch(() => toast.error("关闭会话失败"))}>关闭</Button> : null}</div>)}</div></div></div> : <p className="py-12 text-center text-sm text-muted-foreground">选择一个编辑器查看详情</p>}</CardContent></Card></div></div>
}
