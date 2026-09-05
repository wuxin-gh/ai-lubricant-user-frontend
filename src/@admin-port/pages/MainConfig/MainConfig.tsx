import { useState, useEffect, useCallback, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AdminPage, SectionCard, InfoList } from '../shared/AdminPage'
import { getMainConfig, updateMainConfig, archiveLogsNow } from '../../api/dashboard'
import type { MainConfig as MainConfigType } from '../../types/admin'

// ── 表单字段路径与标签 ──────────────────────────────────────────────────────
type FieldPath =
  | 'admin.session_duration_hours'
  | 'system.debug'
  | 'model_refresh.interval_minutes'
  | 'message_delete.enabled'
  | 'message_delete.interval_minutes'
  | 'log_retention.max_entries'
  | 'data_retention.log_days'
  | 'data_retention.archive_keep_entries'
  | 'data_retention.cleanup_hour'
  | 'retry.max_retries'
  | 'stream.incomplete_error_enabled'
  | 'rate_limit.status_codes'
  | 'rate_limit.cooldown_seconds'
  | 'rate_limit.exception_cooldown_seconds'
  | 'retry.non_retryable_parameter_errors.status_codes'
  | 'retry.non_retryable_parameter_errors.types'
  | 'retry.non_retryable_parameter_errors.codes'
  | 'retry.non_retryable_parameter_errors.params'
  | 'retry.non_retryable_parameter_errors.markers'

type FieldType = 'text' | 'number' | 'toggle' | 'numberArray' | 'textArray'

type TabKey = 'basic' | 'scheduled' | 'retention' | 'retry'

interface FieldDef {
  path: FieldPath
  label: string
  type: FieldType
  defaultValue: unknown
  suffix?: string
}

interface FieldGroup {
  key: string
  title: string
  description: string
  fields: FieldDef[]
}

interface ConfigTab {
  key: TabKey
  title: string
  description: string
  groups: FieldGroup[]
}

// ── Tab 分组定义（方案 C：顶部 tab + 组内并行卡片） ─────────────────────────
const CONFIG_TABS: ConfigTab[] = [
  {
    key: 'basic',
    title: '基础配置',
    description: '会话、调试与流式响应',
    groups: [
      {
        key: 'admin',
        title: '基础配置',
        description: '管理后台会话与系统调试开关',
        fields: [
          {
            path: 'admin.session_duration_hours',
            label: '会话时长',
            type: 'number',
            defaultValue: 24,
            suffix: '小时',
          },
          { path: 'system.debug', label: '调试模式', type: 'toggle', defaultValue: false },
        ],
      },
      {
        key: 'stream',
        title: '流式响应完整性',
        description: '流式响应不完整时是否返回错误',
        fields: [
          {
            path: 'stream.incomplete_error_enabled',
            label: '不完整响应错误',
            type: 'toggle',
            defaultValue: true,
          },
        ],
      },
    ],
  },
  {
    key: 'scheduled',
    title: '定时任务',
    description: '刷新、清理与保留策略',
    groups: [
      {
        key: 'refresh',
        title: '模型刷新',
        description: '模型列表刷新周期',
        fields: [
          {
            path: 'model_refresh.interval_minutes',
            label: '模型刷新间隔',
            type: 'number',
            defaultValue: 60,
            suffix: '分钟',
          },
        ],
      },
      {
        key: 'cleanup',
        title: '消息清理',
        description: '历史消息自动清理策略',
        fields: [
          { path: 'message_delete.enabled', label: '消息删除', type: 'toggle', defaultValue: false },
          {
            path: 'message_delete.interval_minutes',
            label: '消息删除间隔',
            type: 'number',
            defaultValue: 30,
            suffix: '分钟',
          },
        ],
      },
    ],
  },
  {
    key: 'retention',
    title: '日志保留',
    description: '归档保留策略与手动归档',
    groups: [
      {
        key: 'retention',
        title: '日志保留',
        description: '归档表清理策略 + 主表归档保留条数',
        fields: [
          {
            path: 'data_retention.archive_keep_entries',
            label: '主表保留条数',
            type: 'number',
            defaultValue: 0,
            suffix: '条（保留最新，超出的归档；0=关闭归档）',
          },
          {
            path: 'log_retention.max_entries',
            label: '归档表保留条数',
            type: 'number',
            defaultValue: 10000,
            suffix: '条（归档表最多保留，超出删最老）',
          },
          {
            path: 'data_retention.log_days',
            label: '归档表保留天数',
            type: 'number',
            defaultValue: 30,
            suffix: '天（归档表最多保留）',
          },
          {
            path: 'data_retention.cleanup_hour',
            label: '定时清理时刻',
            type: 'number',
            defaultValue: 2,
            suffix: '点（0-23）',
          },
        ],
      },
    ],
  },
  {
    key: 'retry',
    title: '重试与限流',
    description: '重试次数、限频与错误特征',
    groups: [
      {
        key: 'retry',
        title: '全局重试',
        description: '模型请求失败后的全局重试次数',
        fields: [
          {
            path: 'retry.max_retries',
            label: '模型重试次数',
            type: 'number',
            defaultValue: 3,
            suffix: '次',
          },
        ],
      },
      {
        key: 'rate_limit',
        title: '全局冻结策略',
        description: '请求失败时的全局冻结时间，渠道未配置冻结规则时使用',
        fields: [
          {
            path: 'rate_limit.status_codes',
            label: '触发状态码',
            type: 'numberArray',
            defaultValue: [429],
          },
          {
            path: 'rate_limit.cooldown_seconds',
            label: '冷却时间',
            type: 'number',
            defaultValue: 60,
            suffix: '秒',
          },
          {
            path: 'rate_limit.exception_cooldown_seconds',
            label: '异常冷却',
            type: 'number',
            defaultValue: 300,
            suffix: '秒',
          },
        ],
      },
      {
        key: 'non_retryable',
        title: '不可重试上游错误',
        description: '遇到后直接透传 — 命中任一规则时直接向上游透传错误，不重试、不冻结账号',
        fields: [
          {
            path: 'retry.non_retryable_parameter_errors.status_codes',
            label: '状态码',
            type: 'numberArray',
            defaultValue: [],
          },
          {
            path: 'retry.non_retryable_parameter_errors.types',
            label: '类型(type)',
            type: 'textArray',
            defaultValue: [],
          },
          {
            path: 'retry.non_retryable_parameter_errors.codes',
            label: '错误码(code)',
            type: 'textArray',
            defaultValue: [],
          },
          {
            path: 'retry.non_retryable_parameter_errors.params',
            label: '参数名(param)',
            type: 'textArray',
            defaultValue: [],
          },
          {
            path: 'retry.non_retryable_parameter_errors.markers',
            label: '文本匹配',
            type: 'textArray',
            defaultValue: [],
          },
        ],
      },
    ],
  },
]

const EDITABLE_FIELDS = CONFIG_TABS.flatMap((tab) => tab.groups.flatMap((group) => group.fields))

// ── 深拷贝 helper ───────────────────────────────────────────────────────────
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// ── 按 dotted path 读取嵌套值 ──────────────────────────────────────────────
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

// ── 按 dotted path 写入嵌套值（不可变） ────────────────────────────────────
function setByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split('.')
  const root = deepClone(obj)
  let cur: Record<string, unknown> = root
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    if (cur[p] == null || typeof cur[p] !== 'object') {
      cur[p] = {}
    }
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
  return root
}

function createConfigPatch(data: MainConfigType): Record<string, unknown> {
  let patch: Record<string, unknown> = {}
  const source = data as Record<string, unknown>
  for (const field of EDITABLE_FIELDS) {
    const value = getByPath(source, field.path)
    patch = setByPath(patch, field.path, value === undefined ? deepClone(field.defaultValue) : deepClone(value))
  }
  return patch
}

function arrayToText(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : ''
}

function formatReadOnlyValue(field: FieldDef, value: unknown): string {
  if (field.type === 'toggle') {
    return value ? '启用' : '禁用'
  }
  if (field.type === 'numberArray' || field.type === 'textArray') {
    const text = arrayToText(value)
    return text.length > 0 ? text : '无'
  }
  const text = String(value ?? field.defaultValue)
  return field.suffix ? `${text} ${field.suffix}` : text
}

function getReadOnlyTone(
  field: FieldDef,
  value: unknown,
): 'default' | 'muted' | 'blue' | 'green' | 'yellow' | 'red' {
  if (field.type === 'toggle') return value ? 'green' : 'muted'
  if (field.type === 'numberArray' || field.type === 'textArray') {
    return Array.isArray(value) && value.length > 0 ? 'default' : 'muted'
  }
  return 'default'
}

// ── Tab 样式 ──────────────────────────────────────────────────────────────
const tabNavStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '10px',
}

const tabButtonStyle = (active: boolean): CSSProperties => ({
  padding: '14px 16px',
  textAlign: 'left',
  background: active ? 'linear-gradient(135deg, var(--tint), var(--surface))' : 'var(--surface)',
  border: active ? '1px solid var(--blue)' : '1px solid var(--admin-border)',
  borderRadius: 'var(--admin-radiusL)',
  boxShadow: active ? 'var(--shadow)' : 'none',
  cursor: 'pointer',
  transition: 'all 0.12s',
  minWidth: 0,
})

const tabTitleStyle: CSSProperties = {
  display: 'block',
  marginBottom: '4px',
  color: 'var(--textH)',
  fontSize: '14px',
  fontWeight: '750',
}

const tabDescStyle: CSSProperties = {
  display: 'block',
  color: 'var(--text2)',
  fontSize: '12px',
  lineHeight: 1.4,
}

// ── 组内卡片并行布局 ──────────────────────────────────────────────────
const responsiveCardGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))',
  gap: '16px',
  alignItems: 'start',
}

// ── 内联表单输入样式 ────────────────────────────────────────────────────────
const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: '14px',
  fontWeight: '500',
  color: 'var(--text)',
  background: 'var(--bg2)',
  border: '1px solid var(--admin-border)',
  borderRadius: 'var(--admin-radius)',
  outline: 'none',
  transition: 'border-color 0.12s',
  boxSizing: 'border-box',
}

const labelStyle: CSSProperties = {
  fontSize: '12px',
  fontWeight: '700',
  color: 'var(--text2)',
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
  marginBottom: '6px',
  display: 'block',
}

const toggleContainerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
}

const toggleStyle = (active: boolean): CSSProperties => ({
  position: 'relative',
  width: '42px',
  height: '24px',
  borderRadius: '999px',
  border: '1px solid var(--admin-border)',
  background: active ? 'var(--green)' : 'var(--bg3)',
  cursor: 'pointer',
  transition: 'background 0.15s',
  flexShrink: 0,
})

const toggleKnobStyle: CSSProperties = {
  position: 'absolute',
  top: '2px',
  left: '2px',
  width: '18px',
  height: '18px',
  borderRadius: '50%',
  background: 'var(--textH)',
  transition: 'transform 0.15s',
}

// ── 编辑态表单字段网格 ──────────────────────────────────────────────────
const formGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
  gap: '14px',
}

const formFieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '12px',
  background: 'var(--surface2)',
  borderRadius: 'var(--admin-radius)',
  border: '1px solid var(--admin-border)',
  minWidth: 0,
}

// ── 按钮 ────────────────────────────────────────────────────────────────────
const btnBase: CSSProperties = {
  padding: '8px 16px',
  fontSize: '13px',
  fontWeight: '600',
  border: '1px solid var(--admin-border)',
  borderRadius: 'var(--admin-radius)',
  cursor: 'pointer',
  transition: 'all 0.12s',
}

const btnPrimary: CSSProperties = {
  ...btnBase,
  background: 'var(--blue)',
  color: 'var(--bg)',
  border: '1px solid var(--blue)',
}

const btnSecondary: CSSProperties = {
  ...btnBase,
  background: 'var(--bg3)',
  color: 'var(--text)',
}

// ── Toast ───────────────────────────────────────────────────────────────────
const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: '24px',
  right: '24px',
  padding: '12px 20px',
  fontSize: '14px',
  fontWeight: '600',
  color: 'var(--bg)',
  background: 'var(--green)',
  borderRadius: 'var(--admin-radius)',
  boxShadow: 'var(--shadow)',
  zIndex: 9999,
  animation: 'fadeIn 0.2s ease',
}

// ── Tag 标签样式 ───────────────────────────────────────────────────────────
const tagContainerStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
  padding: '6px 8px',
  minHeight: '36px',
  background: 'var(--bg2)',
  border: '1px solid var(--admin-border)',
  borderRadius: 'var(--admin-radius)',
  alignItems: 'center',
  cursor: 'text',
  transition: 'border-color 0.12s',
}

const tagStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 8px',
  fontSize: '12px',
  fontWeight: '600',
  color: 'var(--textH)',
  background: 'var(--surface2)',
  border: '1px solid var(--admin-border)',
  borderRadius: '999px',
  lineHeight: '1.6',
}

const tagRemoveStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '14px',
  height: '14px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text2)',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: '700',
  padding: 0,
  lineHeight: 1,
  borderRadius: '50%',
  flexShrink: 0,
}

const tagInputStyle: CSSProperties = {
  flex: '1 1 80px',
  minWidth: '60px',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  fontSize: '13px',
  color: 'var(--text)',
  padding: '2px 0',
}

interface TagInputProps {
  values: (string | number)[]
  onChange: (values: (string | number)[]) => void
  numberMode?: boolean
  placeholder?: string
}

function TagInput({ values, onChange, numberMode = false, placeholder = '输入后回车添加' }: TagInputProps) {
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addTag = () => {
    const raw = inputValue.trim()
    if (!raw) return
    if (numberMode) {
      const num = Number(raw)
      if (!Number.isFinite(num)) {
        setInputValue('')
        return
      }
      if (!values.includes(num)) {
        onChange([...values, num])
      }
    } else {
      if (!values.includes(raw)) {
        onChange([...values, raw])
      }
    }
    setInputValue('')
  }

  const removeTag = (index: number) => {
    onChange(values.filter((_, i) => i !== index))
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && !inputValue && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div style={tagContainerStyle} onClick={() => inputRef.current?.focus()}>
      {values.map((v, i) => (
        <span key={i} style={tagStyle}>
          {String(v)}
          <button
            type="button"
            style={tagRemoveStyle}
            onClick={(e) => { e.stopPropagation(); removeTag(i) }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--red)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text2)' }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={values.length === 0 ? placeholder : ''}
        style={tagInputStyle}
      />
    </div>
  )
}

// ============================================================================
// MainConfig 组件
// ============================================================================

export function MainConfig() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<MainConfigType | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown> | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('basic')
  const [archiving, setArchiving] = useState(false)

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getMainConfig()
      setConfig(data)
      setFormData(createConfigPatch(data))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载配置失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchConfig()
  }, [fetchConfig])

  // Toast 自动消失
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  const handleEnterEdit = () => {
    if (config) {
      setFormData(createConfigPatch(config))
      setSaveError(null)
      setEditing(true)
    }
  }

  const handleCancel = () => {
    setFormData(config ? createConfigPatch(config) : null)
    setSaveError(null)
    setEditing(false)
  }

  const handleFieldChange = (path: FieldPath, value: unknown) => {
    if (!formData) return
    setFormData(setByPath(formData, path, value))
  }

  const handleSave = async () => {
    if (!formData) return
    setSaving(true)
    setSaveError(null)
    try {
      await updateMainConfig(formData)
      // 保存成功后用返回数据更新本地状态
      const fresh = await getMainConfig()
      setConfig(fresh)
      setFormData(createConfigPatch(fresh))
      setEditing(false)
      setToast('配置保存成功')
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'response' in err
            ? // axios error
              `保存失败: ${
                (err as { response?: { data?: { detail?: string } } }).response?.data
                  ?.detail ?? '服务器错误'
              }`
            : '保存配置失败'
      setSaveError(msg)
    } finally {
      setSaving(false)
    }
  }

  const handleArchiveNow = async () => {
    setArchiving(true)
    try {
      const res = await archiveLogsNow()
      if (res.ok) {
        setToast(res.detail || `归档任务已在后台启动（全局保留最新 ${res.keep_entries} 条完整日志），完成后可在控制台日志/通知中心查看`)
      } else {
        setToast(res.detail || '未启用：请先设置「归档保留条数（主表）」为大于 0 的条数并保存')
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'response' in err
            ? `执行失败: ${
                (err as { response?: { data?: { detail?: string } } }).response?.data
                  ?.detail ?? '服务器错误'
              }`
            : '执行失败'
      setToast(msg)
    } finally {
      setArchiving(false)
    }
  }

  // ── 加载中 ─────────────────────────────────────────────────────────────
  if (loading && !config) {
    return (
      <AdminPage title="全局配置" description="集中查看与编辑服务运行所需的核心参数">
        <SectionCard title="加载中" description="正在获取配置数据...">
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text2)' }}>
            <div style={{ fontSize: '14px' }}>加载中...</div>
          </div>
        </SectionCard>
      </AdminPage>
    )
  }

  // ── 加载失败 ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <AdminPage
        title="全局配置"
        description="集中查看与编辑服务运行所需的核心参数"
        actions={
          <button onClick={() => void fetchConfig()} style={btnSecondary}>
            重试
          </button>
        }
      >
        <SectionCard title="加载失败" description="无法获取配置数据">
          <div style={{ padding: '20px', color: 'var(--red)' }}>
            <div style={{ fontSize: '14px', marginBottom: '8px' }}>错误信息：</div>
            <div style={{ fontSize: '13px', fontFamily: 'var(--fontM)' }}>{error}</div>
          </div>
        </SectionCard>
      </AdminPage>
    )
  }

  // ── 渲染表单输入控件 ──────────────────────────────────────────────────
  const renderField = (field: FieldDef) => {
    const value = formData ? getByPath(formData, field.path) : field.defaultValue

    if (field.type === 'toggle') {
      const active = Boolean(value)
      return (
        <div style={formFieldStyle}>
          <span style={labelStyle}>{field.label}</span>
          <div style={toggleContainerStyle}>
            <div
              style={toggleStyle(active)}
              onClick={() => handleFieldChange(field.path, !active)}
              role="switch"
              aria-checked={active}
            >
              <div
                style={{
                  ...toggleKnobStyle,
                  transform: active ? 'translateX(18px)' : 'translateX(0)',
                }}
              />
            </div>
            <span style={{ fontSize: '14px', color: 'var(--text)', fontWeight: '600' }}>
              {active ? '启用' : '未启用'}
            </span>
          </div>
        </div>
      )
    }

    if (field.type === 'numberArray' || field.type === 'textArray') {
      const arr = Array.isArray(value) ? value : []
      return (
        <div style={formFieldStyle}>
          <span style={labelStyle}>{field.label}</span>
          <TagInput
            values={arr}
            onChange={(newArr) => handleFieldChange(field.path, newArr)}
            numberMode={field.type === 'numberArray'}
            placeholder={field.type === 'numberArray' ? '输入数字回车添加' : '输入文本回车添加'}
          />
        </div>
      )
    }

    return (
      <div style={formFieldStyle}>
        <span style={labelStyle}>{field.label}</span>
        <input
          type={field.type}
          value={field.type === 'number' ? Number(value ?? field.defaultValue) : String(value ?? '')}
          onChange={(e) =>
            handleFieldChange(
              field.path,
              field.type === 'number' ? Number(e.target.value) : e.target.value,
            )
          }
          style={inputStyle}
        />
      </div>
    )
  }

  // ── 渲染单个配置组卡片 ──────────────────────────────────────────────────
  const renderGroup = (group: FieldGroup) => {
    const draft = formData ?? (config ? createConfigPatch(config) : null)

    return (
      <SectionCard
        key={group.key}
        title={group.title}
        description={group.description}
        toolbar={
          editing ? (
            <span style={{ fontSize: '12px', color: 'var(--blue)', fontWeight: '700' }}>
              编辑模式
            </span>
          ) : group.key === 'retention' ? (
            <button
              onClick={handleArchiveNow}
              disabled={archiving}
              style={{
                ...btnSecondary,
                fontSize: '12px',
                padding: '6px 12px',
                cursor: archiving ? 'not-allowed' : 'pointer',
                opacity: archiving ? 0.6 : 1,
              }}
              title="立即全局保留最新 N 条完整日志，超出的元数据搬入归档表并从主表删除整行"
            >
              {archiving ? '归档中...' : '立即归档'}
            </button>
          ) : undefined
        }
      >
        {editing ? (
          <div style={formGridStyle}>
            {group.fields.map((field) => (
              <div key={field.path} style={{ minWidth: 0 }}>
                {renderField(field)}
              </div>
            ))}
          </div>
        ) : (
          <InfoList
            layout="horizontal"
            items={group.fields.map((field) => {
              const value = draft ? getByPath(draft, field.path) : field.defaultValue
              return {
                label: field.label,
                value: formatReadOnlyValue(field, value),
                tone: getReadOnlyTone(field, value),
              }
            })}
          />
        )}
      </SectionCard>
    )
  }

  const activeConfig = CONFIG_TABS.find((tab) => tab.key === activeTab) ?? CONFIG_TABS[0]

  return (
    <>
      <AdminPage
        title="全局配置"
        description="集中查看与编辑服务运行所需的核心参数"
        actions={
          editing ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  ...btnPrimary,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? '保存中...' : '保存配置'}
              </button>
              <button
                onClick={handleCancel}
                disabled={saving}
                style={{
                  ...btnSecondary,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                取消
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleEnterEdit} style={btnPrimary}>
                编辑配置
              </button>
              <button
                onClick={() => void fetchConfig()}
                disabled={loading}
                style={{
                  ...btnSecondary,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? '刷新中...' : '重新加载'}
              </button>
            </div>
          )
        }
      >
        {/* 保存错误提示 */}
        {saveError && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 'var(--admin-radius)',
              background: 'rgba(251, 113, 133, 0.1)',
              border: '1px solid var(--red)',
              color: 'var(--red)',
              fontSize: '13px',
              fontWeight: '600',
            }}
          >
            保存失败：{saveError}
          </div>
        )}

        {/* Tab 导航 */}
        <div style={tabNavStyle}>
          {CONFIG_TABS.map((tab) => {
            const active = tab.key === activeTab
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={tabButtonStyle(active)}
                aria-pressed={active}
                type="button"
              >
                <span style={tabTitleStyle}>{tab.title}</span>
                <span style={tabDescStyle}>{tab.description}</span>
              </button>
            )
          })}
        </div>

        {/* Tab 内容 */}
        {activeTab === 'scheduled' && !editing ? (
          <SectionCard title="定时任务" description="刷新、清理与保留策略一览">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--admin-border)' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '700', color: 'var(--text2)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>任务名</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: '700', color: 'var(--text2)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>具体值</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: '700', color: 'var(--text2)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>开关</th>
                  </tr>
                </thead>
                <tbody>
                  {activeConfig.groups.flatMap((group) =>
                    group.fields.map((field) => {
                      const draft = formData ?? (config ? createConfigPatch(config) : null)
                      const value = draft ? getByPath(draft, field.path) : field.defaultValue
                      const isToggle = field.type === 'toggle'
                      const displayValue = isToggle
                        ? (value ? '启用' : '禁用')
                        : formatReadOnlyValue(field, value)
                      return (
                        <tr key={field.path} style={{ borderBottom: '1px solid var(--admin-border)' }}>
                          <td style={{ padding: '10px 12px', fontWeight: '600', color: 'var(--textH)' }}>{field.label}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--text)', fontFamily: field.type === 'number' ? 'var(--fontM)' : undefined }}>
                            {isToggle ? '—' : displayValue}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 10px',
                              borderRadius: '999px',
                              fontSize: '12px',
                              fontWeight: '700',
                              background: value ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.15)',
                              color: value ? 'var(--green)' : 'var(--text2)',
                            }}>
                              {value ? '开' : '关'}
                            </span>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        ) : (
          <div style={responsiveCardGridStyle}>
            {activeConfig.groups.map((group) => renderGroup(group))}
          </div>
        )}
      </AdminPage>

      {/* Toast */}
      {toast && <div style={toastStyle}>{toast}</div>}
    </>
  )
}
