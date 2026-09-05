/**
 * 真实模型渠道策略（模型广场「真实模型」tab 的卡片入口）。
 *
 * 真相源是 model_groups 的 kind='real' 行：顶层 provider_whitelist/provider_blacklist
 * 恒为激活方案的投影，多套方案存 schemes/active_scheme。写入走窄写端点
 * PUT /admin/model-metadata/{id}/routing —— 只改这几列，不触碰元数据。
 *
 * 运行时语义：Config.get_real_model_provider_filter 取激活方案的渠道标签过滤；
 * ModelClientPool._real_model_filter_nodes 把「激活方案 + 显式标记 is_backup 的方案」
 * 按数组顺序串成降级链，激活档位无可用渠道时逐档兜底。未标记 is_backup 的方案只能
 * 手动切换，不参与自动降级。方案身份是 id，name 只是展示标签。
 */
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, GripVertical, Pencil, Plus, Settings2, X } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { RealModelScheme } from '@/@admin-port/api/modelMetadata'
import type { ProviderLite } from '@/@admin-port/types/admin'
import { Field, FieldLabel, MultiSelect, type Option } from './ModelRouting'

/** 弹框需要的真实模型行字段（取自 /admin/model-metadata 的 models[]）。 */
export interface RealModelRoutingTarget {
  model_id: string
  provider_whitelist: string[]
  provider_blacklist: string[]
  schemes: RealModelScheme[]
  active_scheme: string
}

// 与后端 PostgresClient.DEFAULT_SCHEME_NAME 一致：无 schemes 的旧行由顶层两列合成这一套。
const DEFAULT_SCHEME_NAME = '默认'

function newSchemeId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

// 解析后端 schemes；id 缺失（旧数据）按位置补 legacy-{序号}，与后端 _normalize_schemes 对齐。
function schemesFromRaw(raw: RealModelScheme[] | undefined, modelId: string): RealModelScheme[] {
  if (!Array.isArray(raw)) return []
  const result: RealModelScheme[] = []
  const seen = new Set<string>()
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const id = (typeof item.id === 'string' ? item.id : '').trim() || `legacy-${index}`
    if (seen.has(id)) return
    seen.add(id)
    result.push({
      id,
      name: (typeof item.name === 'string' ? item.name : '').trim(),
      // 真实模型的候选模型恒为自身：方案只提供渠道档位。空 models 会被后端校验拒绝，这里补齐。
      models: stringList(item.models).length ? stringList(item.models) : [modelId],
      provider_whitelist: stringList(item.provider_whitelist),
      provider_blacklist: stringList(item.provider_blacklist),
      is_backup: item.is_backup === true,
    })
  })
  return result
}

interface RoutingDraft {
  schemes: RealModelScheme[]
  /** 激活方案的 id（不是 name） */
  activeScheme: string
}

// 无 schemes 的旧行用顶层两列合成一套默认方案，保证任何真实模型至少一套方案。
function draftFromTarget(target: RealModelRoutingTarget): RoutingDraft {
  let schemes = schemesFromRaw(target.schemes, target.model_id)
  if (!schemes.length) {
    schemes = [{
      id: 'legacy-0',
      name: DEFAULT_SCHEME_NAME,
      models: [target.model_id],
      provider_whitelist: stringList(target.provider_whitelist),
      provider_blacklist: stringList(target.provider_blacklist),
      is_backup: false,
    }]
  }
  const rawActive = (target.active_scheme || '').trim()
  const active = schemes.find((scheme) => scheme.id === rawActive) ?? schemes[0]
  return { schemes, activeScheme: active.id }
}

function cleanScheme(scheme: RealModelScheme, modelId: string): RealModelScheme {
  return {
    id: scheme.id,
    name: scheme.name.trim(),
    models: stringList(scheme.models).length ? stringList(scheme.models) : [modelId],
    provider_whitelist: scheme.provider_whitelist.map((tag) => tag.trim()).filter(Boolean),
    provider_blacklist: scheme.provider_blacklist.map((tag) => tag.trim()).filter(Boolean),
    is_backup: scheme.is_backup === true,
  }
}

// 承载该真实模型的渠道（provider.models 含 model_id）。渠道策略只能在这些渠道里挑，
// 与运行时候选来源（ModelClientPool.iter_model_candidates 按 model_id 取路由）同口径。
function channelsCarrying(providers: ProviderLite[], modelId: string): ProviderLite[] {
  return providers.filter((provider) => stringList(provider.models).includes(modelId))
}

// 渠道标签选项：只列承载该模型的渠道所带标签，并标注命中渠道数。
// 已选标签始终保留（计数 0），避免渠道标签调整后无法从旧配置里取消。
function tagOptionsFor(carriers: ProviderLite[], selected: string[]): Option[] {
  const counts = new Map<string, number>()
  carriers.forEach((provider) => {
    stringList(provider.tags).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1))
  })
  selected.forEach((tag) => { if (!counts.has(tag)) counts.set(tag, 0) })
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
    .map(([tag, count]) => ({ value: tag, label: `${tag}（${count} 个渠道）` }))
}

type SchemeView = 'current' | 'manage' | 'edit'

/**
 * 真实模型渠道策略弹框：仅展示在「真实模型」tab 的卡片编辑按钮旁。打开后默认进「当前方案」
 * 视图（直接编辑激活方案的渠道标签过滤）；点「管理方案」切到方案列表，可新增/编辑/复制/
 * 删除/切换/重排/勾选备用。多方案降级语义与自定义模型一致：仅显式标记 is_backup 的
 * 非激活方案按数组顺序进降级链。改动先落本地 draft，点底部「保存」才调
 * PUT /admin/model-metadata/{id}/routing 窄写。
 */
export function RealModelRoutingDialog({
  open,
  target,
  providers,
  saving,
  onClose,
  onSave,
}: {
  open: boolean
  target: RealModelRoutingTarget | null
  providers: ProviderLite[]
  saving: boolean
  onClose: () => void
  onSave: (body: { schemes: RealModelScheme[]; active_scheme: string }) => Promise<void> | void
}) {
  const [draft, setDraft] = useState<RoutingDraft | null>(null)
  const [view, setView] = useState<SchemeView>('current')
  const [editBuffer, setEditBuffer] = useState<{ target: number | 'new'; scheme: RealModelScheme } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const modelId = target?.model_id ?? ''

  // 弹框打开 / 切换目标模型时按最新一行重建 draft，并回到「当前方案」视图。
  // 依赖故意只取 modelId：target 引用每次父组件重渲染都会变（providers 刷新等），
  // 若纳入依赖会在用户编辑途中重置 draft，丢掉未保存的改动。
  useEffect(() => {
    if (!open || !target) {
      setDraft(null)
      return
    }
    setDraft(draftFromTarget(target))
    setView('current')
    setEditBuffer(null)
    setError(null)
  }, [open, modelId])

  // 渠道策略的目标渠道范围：方案的渠道过滤仅在承载该模型的渠道里命中；
  // 不承载该模型的渠道即使带了匹配标签也不会被选到。
  const carriers = target ? channelsCarrying(providers, target.model_id) : []

  const updateActive = (patch: Partial<RealModelScheme>) => {
    if (!draft) return
    const idx = draft.schemes.findIndex((scheme) => scheme.id === draft.activeScheme)
    if (idx < 0) return
    const next = draft.schemes.map((scheme, i) => (i === idx ? { ...scheme, ...patch } : scheme))
    setDraft({ ...draft, schemes: next })
  }

  const startEdit = (index: number) => {
    if (!draft) return
    const scheme = draft.schemes[index]
    if (!scheme) return
    setEditBuffer({ target: index, scheme: { ...scheme } })
    setView('edit')
  }

  const startAdd = () => {
    if (!draft || !target) return
    setEditBuffer({
      target: 'new',
      scheme: {
        id: newSchemeId(),
        name: '',
        models: [target.model_id],
        provider_whitelist: [],
        provider_blacklist: [],
        is_backup: false,
      },
    })
    setView('edit')
  }

  const patchBuffer = (patch: Partial<RealModelScheme>) => {
    setEditBuffer((current) => (current ? { ...current, scheme: { ...current.scheme, ...patch } } : current))
  }

  const commitBuffer = () => {
    if (!draft || !editBuffer || !target) return
    const cleaned = cleanScheme(editBuffer.scheme, target.model_id)
    if (editBuffer.target === 'new') {
      setDraft({ ...draft, schemes: [...draft.schemes, cleaned] })
    } else {
      setDraft({
        ...draft,
        schemes: draft.schemes.map((scheme, i) => (i === editBuffer.target ? cleaned : scheme)),
      })
    }
    setEditBuffer(null)
    setView('manage')
  }

  const cancelBuffer = () => {
    setEditBuffer(null)
    setView('manage')
  }

  const copyBuffer = (index: number) => {
    if (!draft) return
    const source = draft.schemes[index]
    if (!source) return
    let id = newSchemeId()
    while (draft.schemes.some((scheme) => scheme.id === id)) id = newSchemeId()
    setEditBuffer({
      target: 'new',
      scheme: { ...source, id, name: source.name.trim() ? `${source.name}-副本` : '', is_backup: false },
    })
    setView('edit')
  }

  const removeScheme = (index: number) => {
    if (!draft) return
    if (draft.schemes.length <= 1) return
    const removed = draft.schemes[index]
    const schemes = draft.schemes.filter((_, i) => i !== index)
    const activeScheme = removed && removed.id === draft.activeScheme ? schemes[0].id : draft.activeScheme
    setDraft({ ...draft, schemes, activeScheme })
  }

  const activate = (id: string) => {
    if (!draft) return
    setDraft({ ...draft, activeScheme: id })
  }

  const reorder = (from: number, to: number) => {
    if (!draft || from === to) return
    const schemes = draft.schemes.slice()
    const [moved] = schemes.splice(from, 1)
    schemes.splice(to, 0, moved)
    setDraft({ ...draft, schemes })
  }

  const handleSave = async () => {
    if (!draft || !target) return
    if (view === 'edit') {
      setError('请先「保存」或「退出」当前正在编辑的方案')
      return
    }
    const cleaned = draft.schemes
      .map((scheme) => cleanScheme(scheme, target.model_id))
      .filter((scheme) => scheme.id)
    const ids = cleaned.map((scheme) => scheme.id)
    if (new Set(ids).size !== ids.length) {
      setError('方案 id 重复')
      return
    }
    const active = cleaned.find((scheme) => scheme.id === draft.activeScheme) ?? cleaned[0]
    if (!active) {
      setError('至少需要保留一个方案')
      return
    }
    try {
      await onSave({ schemes: cleaned, active_scheme: active.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存渠道策略失败')
    }
  }

  if (!target || !draft) return null

  const activeScheme = draft.schemes.find((scheme) => scheme.id === draft.activeScheme) ?? draft.schemes[0]
  const backupCount = draft.schemes.filter((scheme) => scheme.is_backup && scheme.id !== draft.activeScheme).length
  const totalSchemes = draft.schemes.length

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="flex max-h-[88vh] w-[92vw] max-w-[1100px] flex-col gap-4 sm:max-w-[1100px]"
        // 阻止点遮罩/失焦关闭；保留 Esc、右上 X、底部「取消」关闭。
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{`渠道策略 · ${target.model_id}`}</DialogTitle>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-auto pr-1">
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Badge variant="outline">方案 {totalSchemes}</Badge>
            {backupCount > 0 ? <Badge variant="outline" className="border-orange-600/40 text-orange-700 dark:border-orange-400/40 dark:text-orange-400">备用 {backupCount}</Badge> : null}
            <span className="ml-auto">改动先落本地，点底部「保存」才写入。</span>
          </div>
          {view === 'current' && activeScheme ? (
            <CurrentSchemeView
              scheme={activeScheme}
              tagOptions={tagOptionsFor(carriers, [...activeScheme.provider_whitelist, ...activeScheme.provider_blacklist])}
              onUpdate={updateActive}
              onManage={() => { setEditBuffer(null); setView('manage') }}
              disabled={saving}
            />
          ) : view === 'edit' && editBuffer ? (
            <EditSchemeView
              scheme={editBuffer.scheme}
              isNew={editBuffer.target === 'new'}
              tagOptions={tagOptionsFor(carriers, [...editBuffer.scheme.provider_whitelist, ...editBuffer.scheme.provider_blacklist])}
              onPatch={patchBuffer}
              onCommit={commitBuffer}
              onCancel={cancelBuffer}
              disabled={saving}
            />
          ) : (
            <ManageSchemesView
              schemes={draft.schemes}
              activeId={draft.activeScheme}
              dragIndex={dragIndex}
              dragOverIndex={dragOverIndex}
              onStartEdit={startEdit}
              onCopy={copyBuffer}
              onRemove={removeScheme}
              onActivate={activate}
              onAdd={startAdd}
              onBack={() => setView('current')}
              onMoveStart={setDragIndex}
              onMoveOver={(idx) => {
                if (dragIndex === null) return
                if (dragOverIndex !== idx) setDragOverIndex(idx)
              }}
              onMoveEnd={() => { setDragIndex(null); setDragOverIndex(null) }}
              onDrop={(idx) => {
                if (dragIndex !== null && dragIndex !== idx) reorder(dragIndex, idx)
                setDragIndex(null)
                setDragOverIndex(null)
              }}
              onMoveByButton={reorder}
              disabled={saving}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button onClick={() => void handleSave()} disabled={saving || view === 'edit'}>
            {saving ? <Spinner /> : null}
            保存渠道策略
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const WHITELIST_HINT = '只在带这些标签的渠道上调用该模型，留空表示不限制；仅列出承载了该模型的渠道所带标签'
const BLACKLIST_HINT = '排除带这些标签的渠道，留空表示不限制；黑白名单同时命中时以黑名单为准'

// 当前方案视图：直接改激活方案的渠道过滤，底部「保存渠道策略」即落库。
function CurrentSchemeView({
  scheme,
  tagOptions,
  onUpdate,
  onManage,
  disabled,
}: {
  scheme: RealModelScheme
  tagOptions: Option[]
  onUpdate: (patch: Partial<RealModelScheme>) => void
  onManage: () => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel label="当前方案" hint="当前生效的渠道档位。可直接修改，点弹框底部「保存渠道策略」即写入。多套方案的新增、切换、备用降级点右侧「管理方案」。" />
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-green-600/40 text-green-700 dark:border-green-400/40 dark:text-green-400">
            生效中 · {scheme.name || '未命名'}
          </Badge>
          <Button type="button" variant="ghost" size="sm" onClick={onManage} disabled={disabled}>
            <Settings2 className="size-3.5" /> 管理方案
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-green-600/50 bg-green-50/40 p-3.5 dark:border-green-400/40 dark:bg-green-400/5">
        <Field label="方案名" hint="仅作展示标签，可留空、可与其他方案重名；方案身份由系统分配的 id 唯一标识，改名不影响生效指向">
          <Input value={scheme.name} disabled={disabled} onChange={(event) => onUpdate({ name: event.target.value })} placeholder="如：高配 / 省配" />
        </Field>
        <Field label="渠道标签白名单" hint={WHITELIST_HINT}>
          <MultiSelect
            value={scheme.provider_whitelist}
            onChange={(values) => onUpdate({ provider_whitelist: values })}
            placeholder="不限制（留空）"
            options={tagOptions}
          />
        </Field>
        <Field label="渠道标签黑名单" hint={BLACKLIST_HINT}>
          <MultiSelect
            value={scheme.provider_blacklist}
            onChange={(values) => onUpdate({ provider_blacklist: values })}
            placeholder="不限制（留空）"
            options={tagOptions}
          />
        </Field>
      </div>
    </div>
  )
}

// 单套方案编辑视图：改动落独立缓冲（schemeEdit），点「保存」写回 draft，退出则丢弃。
// 与自定义模型的方案编辑同构：身份是 id、可重名、is_backup 显式开关。
function EditSchemeView({
  scheme,
  isNew,
  tagOptions,
  onPatch,
  onCommit,
  onCancel,
  disabled,
}: {
  scheme: RealModelScheme
  isNew: boolean
  tagOptions: Option[]
  onPatch: (patch: Partial<RealModelScheme>) => void
  onCommit: () => void
  onCancel: () => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel label={isNew ? '新增方案' : '编辑方案'} hint="改动先暂存，点「保存」写回方案列表（此时仍未落库，需再点弹框底部「保存渠道策略」才真正生效）；点「退出」丢弃本次改动。" />
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" onClick={onCommit} disabled={disabled}>保存</Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={disabled}>
            <X className="size-3.5" /> 退出
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border bg-background p-3.5">
        <Field label="方案名" hint="仅作展示标签，允许为空、允许重复；方案身份由内部 id 唯一标识，改名不影响生效指向">
          <Input value={scheme.name} disabled={disabled} onChange={(event) => onPatch({ name: event.target.value })} placeholder="如：高配 / 省配" />
        </Field>
        <Field label="渠道标签白名单" hint={WHITELIST_HINT}>
          <MultiSelect
            value={scheme.provider_whitelist}
            onChange={(values) => onPatch({ provider_whitelist: values })}
            placeholder="不限制（留空）"
            options={tagOptions}
          />
        </Field>
        <Field label="渠道标签黑名单" hint={BLACKLIST_HINT}>
          <MultiSelect
            value={scheme.provider_blacklist}
            onChange={(values) => onPatch({ provider_blacklist: values })}
            placeholder="不限制（留空）"
            options={tagOptions}
          />
        </Field>
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-foreground">作为备用方案</span>
            <span className="text-xs text-muted-foreground">
              开启后，激活方案无候选时按方案列表顺序自动降级到本方案；未开启则只能手动切换为当前方案。备用方案自身不再二次降级。
            </span>
          </div>
          <Switch
            disabled={disabled}
            checked={scheme.is_backup === true}
            onCheckedChange={(checked) => onPatch({ is_backup: checked === true })}
          />
        </div>
      </div>
    </div>
  )
}

// 方案列表视图：拖拽调整降级顺序（备用序号按列表顺序算），可编辑/复制/删除/切换生效。
function ManageSchemesView({
  schemes,
  activeId,
  dragIndex,
  dragOverIndex,
  onStartEdit,
  onCopy,
  onRemove,
  onActivate,
  onAdd,
  onBack,
  onMoveStart,
  onMoveOver,
  onMoveEnd,
  onDrop,
  onMoveByButton,
  disabled,
}: {
  schemes: RealModelScheme[]
  activeId: string
  dragIndex: number | null
  dragOverIndex: number | null
  onStartEdit: (index: number) => void
  onCopy: (index: number) => void
  onRemove: (index: number) => void
  onActivate: (id: string) => void
  onAdd: () => void
  onBack: () => void
  onMoveStart: (index: number) => void
  onMoveOver: (index: number) => void
  onMoveEnd: () => void
  onDrop: (index: number) => void
  onMoveByButton: (from: number, to: number) => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel label="已有方案" hint="生效方案是主档位；勾选了「作为备用方案」的方案按列表顺序组成降级链，生效档位没有可用渠道时从「备用 1」开始逐档兜底。未勾选备用的方案只能手动切换。切换/重排只改暂存配置，点弹框底部「保存渠道策略」才真正生效。" />
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onAdd} disabled={disabled}>
            <Plus className="size-3.5" /> 新增方案
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={disabled}>
            <X className="size-3.5" /> 返回
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {schemes.map((scheme, index) => {
          const isActive = scheme.id === activeId
          const isBackup = scheme.is_backup === true && !isActive
          // 备用序号 = 该方案之前有多少个「已勾选备用且非生效」的方案 + 1，与后端降级顺序一致。
          const backupIndex = schemes
            .slice(0, index)
            .filter((item) => item.is_backup === true && item.id !== activeId).length + 1
          return (
            <div
              key={scheme.id}
              draggable={!disabled}
              onDragStart={(event) => {
                onMoveStart(index)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(event) => {
                if (dragIndex === null) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                onMoveOver(index)
              }}
              onDrop={(event) => {
                event.preventDefault()
                onDrop(index)
              }}
              onDragEnd={onMoveEnd}
              className={cn(
                'flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5',
                isActive ? 'border-green-600/50 bg-green-50/40 dark:border-green-400/40 dark:bg-green-400/5' : 'bg-background',
                dragIndex === index && 'opacity-40',
                dragOverIndex === index && 'border-orange-500 ring-1 ring-orange-400/60',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing" title="拖动调整降级顺序">
                  <GripVertical className="size-3.5" />
                </span>
                {isActive ? (
                  <Badge variant="outline" className="border-green-600/40 text-green-700 dark:border-green-400/40 dark:text-green-400">生效</Badge>
                ) : isBackup ? (
                  <Badge variant="outline" className="border-orange-600/40 text-orange-700 dark:border-orange-400/40 dark:text-orange-400">备用 {backupIndex}</Badge>
                ) : (
                  <Badge variant="outline">未启用</Badge>
                )}
                <span className="text-[14px] font-semibold text-foreground">{scheme.name || '未命名方案'}</span>
                {scheme.provider_whitelist.length ? (
                  <span className="text-xs text-muted-foreground">白 {scheme.provider_whitelist.join('、')}</span>
                ) : scheme.provider_blacklist.length ? (
                  <span className="text-xs text-muted-foreground">黑 {scheme.provider_blacklist.join('、')}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">不限制渠道</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={disabled || index === 0} onClick={() => onMoveByButton(index, index - 1)} title="上移（降级顺序提前）">
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={disabled || index === schemes.length - 1} onClick={() => onMoveByButton(index, index + 1)} title="下移（降级顺序推后）">
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={disabled} onClick={() => onStartEdit(index)}>
                  <Pencil className="size-3.5" /> 编辑
                </Button>
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={disabled} onClick={() => onCopy(index)}>
                  <Copy className="size-3.5" /> 复制
                </Button>
                {schemes.length > 1 ? (
                  <Button type="button" variant="ghost" size="sm" className="text-red-600 hover:text-red-600 dark:text-red-400" disabled={disabled} onClick={() => onRemove(index)}>
                    <X className="size-3.5" /> 删除
                  </Button>
                ) : null}
                {!isActive ? (
                  <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onActivate(scheme.id)}>
                    切换为生效方案
                  </Button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
