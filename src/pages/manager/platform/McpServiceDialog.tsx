/**
 * MCP 服务注册/编辑/安装弹层。
 * 从 admin-frontend 的 antd 版重写为 shadcn；数据层继续复用 `@/@admin-port/api/mcp`（纯 axios）。
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { CreateMcpPayload, McpService, UpdateMcpPayload } from '@/@admin-port/api/mcp'

interface Props {
  service: McpService | null
  template?: McpService | null
  open?: boolean
  onClose: () => void
  onSave: (payload: CreateMcpPayload | UpdateMcpPayload, isEdit: boolean) => Promise<void>
}

const CATEGORY_OPTIONS = [
  { value: 'browser', label: '浏览器' },
  { value: 'search', label: '搜索' },
  { value: 'file', label: '文件' },
  { value: 'code', label: '代码' },
  { value: 'media', label: '媒体' },
  { value: 'custom', label: '自定义' },
]

const TRANSPORT_OPTIONS = [
  { value: 'stdio', label: 'stdio' },
  { value: 'streamable-http', label: 'streamable-http' },
]

interface FormState {
  name: string
  display_name: string
  description: string
  category: string
  transport: string
  command: string
  url: string
  version: string
  author: string
  docs_url: string
  enabled: boolean
}

// 小型受控字段：Label + 控件 + 可选补充说明。
function FieldRow({
  label,
  children,
  extra,
  className,
}: {
  label: string
  children: React.ReactNode
  extra?: React.ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className || ''}`}>
      <Label>{label}</Label>
      {children}
      {extra}
    </div>
  )
}

export function McpServiceDialog({ service, template, open, onClose, onSave }: Props) {
  const draft = service || template || null
  const isOpen = open ?? (!!service || !!template)
  const isEdit = !!service
  const isTemplateInstall = !service && !!template
  const [saving, setSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(() => buildInitial(draft, service))

  // 打开时以最新的 draft 重置表单（等价 antd 的 destroyOnClose + initialValues）。
  useEffect(() => {
    if (isOpen) {
      setForm(buildInitial(draft, service))
      setErrorText(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, service?.id, template?.id])

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const title = isEdit
    ? '编辑 MCP 服务'
    : isTemplateInstall
      ? `从市场安装：${template?.display_name || template?.name}`
      : '注册自定义 MCP 服务'

  const handleOk = async () => {
    setErrorText(null)

    const name = String(form.name || '').trim()
    if (!isEdit && !name) {
      setErrorText('名称不能为空')
      return
    }
    const transport = String(form.transport || 'stdio')
    if (transport === 'stdio' && !String(form.command || '').trim()) {
      setErrorText('stdio 模式需要填写启动命令')
      return
    }
    if (transport === 'streamable-http' && !String(form.url || '').trim()) {
      setErrorText('streamable-http 模式需要填写 URL')
      return
    }

    const envTemplate: Record<string, string> = {}

    setSaving(true)
    try {
      if (isEdit) {
        const payload: UpdateMcpPayload = {
          display_name: form.display_name || service?.display_name || service?.name || '',
          description: form.description || '',
          category: form.category,
          transport,
          version: form.version || '',
          author: form.author || '',
          docs_url: form.docs_url || '',
          env_template: envTemplate,
          source: draft?.source || undefined,
          template: false,
          enabled: !!form.enabled,
        }
        if (transport === 'stdio') payload.command = form.command || ''
        if (transport === 'streamable-http') payload.url = form.url || ''
        await onSave(payload, isEdit)
      } else {
        const payload: CreateMcpPayload = {
          name,
          display_name: form.display_name || name,
          description: form.description || '',
          category: form.category,
          transport,
          version: form.version || '',
          author: form.author || '',
          docs_url: form.docs_url || '',
          env_template: envTemplate,
          source: isTemplateInstall ? template?.source || 'catalog' : draft?.source || undefined,
          template: false,
          enabled: !!form.enabled,
        }
        if (transport === 'stdio') payload.command = form.command || ''
        if (transport === 'streamable-http') payload.url = form.url || ''
        await onSave(payload, isEdit)
      }
      toast.success(isEdit ? '保存成功' : '安装成功')
      onClose()
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { detail?: string } }; message?: string }
      setErrorText(anyErr?.response?.data?.detail || anyErr?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const categorySelect = (
    <Select value={form.category} onValueChange={(v) => setField('category', v)} disabled={saving}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CATEGORY_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const transportSelect = (
    <Select value={form.transport} onValueChange={(v) => setField('transport', v)} disabled={saving}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TRANSPORT_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  // 传输方式相关字段：内置服务在进程内加载，无传输协议，隐藏；否则按 transport 展示命令或 URL。
  const transportField = service?.builtin ? null : form.transport === 'stdio' ? (
    <FieldRow
      label="启动命令"
      extra={
        isEdit ? null : (
          <span className="text-[11px] text-muted-foreground">
            如：npx -y @modelcontextprotocol/server-github 或 python -m your_mcp_server
          </span>
        )
      }
    >
      <Input value={form.command} onChange={(e) => setField('command', e.target.value)} disabled={saving} />
    </FieldRow>
  ) : (
    <FieldRow label="服务 URL">
      <Input
        value={form.url}
        onChange={(e) => setField('url', e.target.value)}
        placeholder="http://localhost:8000/mcp"
        disabled={saving}
      />
    </FieldRow>
  )

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(o) => {
        if (!o && !saving) onClose()
      }}
    >
      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {isTemplateInstall ? (
          <Alert>
            <AlertDescription>
              市场模板只会预填命令、文档和环境变量占位。安装后会成为你的自定义 MCP
              服务，不会覆盖系统内置项。
            </AlertDescription>
          </Alert>
        ) : null}

        {errorText ? (
          <Alert variant="destructive">
            <AlertDescription>{errorText}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-4">
          {!isEdit ? (
            <div className="grid grid-cols-2 gap-4">
              <FieldRow label="名称">
                <Input
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="my-mcp"
                  disabled={saving}
                />
              </FieldRow>
              <FieldRow label="显示名">
                <Input
                  value={form.display_name}
                  onChange={(e) => setField('display_name', e.target.value)}
                  placeholder="我的 MCP"
                  disabled={saving}
                />
              </FieldRow>
              <FieldRow label="分类">{categorySelect}</FieldRow>
              <FieldRow label="传输方式">{transportSelect}</FieldRow>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <FieldRow label="显示名">
                <Input
                  value={form.display_name}
                  onChange={(e) => setField('display_name', e.target.value)}
                  placeholder={service?.name}
                  disabled={saving}
                />
              </FieldRow>
              <FieldRow label="分类">{categorySelect}</FieldRow>
              {!service?.builtin && <FieldRow label="传输方式">{transportSelect}</FieldRow>}
              <FieldRow label="版本">
                <Input
                  value={form.version}
                  onChange={(e) => setField('version', e.target.value)}
                  placeholder="1.0.0"
                  disabled={saving}
                />
              </FieldRow>
            </div>
          )}

          {transportField}

          {!isEdit ? (
            <div className="grid grid-cols-2 gap-4">
              <FieldRow label="版本">
                <Input
                  value={form.version}
                  onChange={(e) => setField('version', e.target.value)}
                  placeholder="1.0.0"
                  disabled={saving}
                />
              </FieldRow>
              <FieldRow label="作者">
                <Input value={form.author} onChange={(e) => setField('author', e.target.value)} disabled={saving} />
              </FieldRow>
            </div>
          ) : (
            <FieldRow label="作者">
              <Input value={form.author} onChange={(e) => setField('author', e.target.value)} disabled={saving} />
            </FieldRow>
          )}

          <FieldRow label="描述">
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              disabled={saving}
            />
          </FieldRow>

          <Alert>
            <AlertDescription>
              环境变量已拆分为独立配置。保存服务后，请在 MCP 卡片的「管理」里配置 key/value/secret。
            </AlertDescription>
          </Alert>

          <FieldRow label="文档 URL">
            <Input
              value={form.docs_url}
              onChange={(e) => setField('docs_url', e.target.value)}
              placeholder="https://..."
              disabled={saving}
            />
          </FieldRow>

          <FieldRow label="启用">
            <Switch
              checked={form.enabled}
              onCheckedChange={(c) => setField('enabled', c)}
              disabled={saving}
            />
          </FieldRow>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleOk} disabled={saving}>
            {saving && <Spinner />}
            {isEdit ? '保存' : isTemplateInstall ? '安装' : '注册'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function buildInitial(draft: McpService | null, service: McpService | null): FormState {
  return {
    name: draft?.name || '',
    display_name: draft?.display_name || '',
    description: draft?.description || '',
    category: draft?.category || 'custom',
    transport: draft?.transport || 'stdio',
    command: draft?.command || '',
    url: draft?.url || '',
    version: draft?.version || '',
    author: draft?.author || '',
    docs_url: draft?.docs_url || '',
    enabled: service?.enabled ?? true,
  }
}
