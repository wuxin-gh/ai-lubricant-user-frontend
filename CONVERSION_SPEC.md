# antd → shadcn 平台管理页重写规范（临时文件，重写完成后删除）

## 背景
把 ai-lubricant 管理页从 antd 重写为 shadcn，融入统一的 `/manager` 控制台。
- 源码：`web/admin-frontend/src/pages/<Page>/<Page>.tsx`（antd 实现，经 `@admin` alias 引用；该目录已删除，仅作历史来源说明）。
- 目标：在 **user-frontend** 内产出 shadcn 版本；改 `App.tsx` 路由，去掉该页的 `PlatformPageEmbed` 包装，直接渲染 shadcn 组件。
- **数据层不变**：继续用 `@admin/api/*`（纯 axios，`withCredentials`，打到 `/admin/*`）。只重写 view 层。

## 目标文件位置
每页产出到：`user-frontend/src/pages/manager/platform/<PageName>.tsx`
默认导出组件，命名与原一致（如 `export function RelaySites()`）。

## 导入替换表

| antd | shadcn 替代 |
|------|-------------|
| `AdminPage, SectionCard, StatGrid, StatCard, InfoList, SimpleTable`（`../shared/AdminPage`）| 同名，从 `@/components/manager/platform-page` 导入 |
| `Button` | `@/components/ui/button`（`type="primary"`→默认；`danger`→`variant="destructive"`；`icon` 作为 children 前置） |
| `Table` + `ColumnsType` | `@/components/ui/table`（`Table/TableHeader/TableBody/TableRow/TableHead/TableCell`）或直接用 `SimpleTable` |
| `Card` | `@/components/ui/card`（`Card/CardHeader/CardTitle/CardContent`）或 `SectionCard` |
| `Tag` | `@/components/ui/badge`（`Badge variant="outline|secondary|destructive"`） |
| `Modal` | `@/components/ui/dialog`（`Dialog/DialogContent/DialogHeader/DialogTitle/DialogFooter`）；确认框用 `@/components/ui/alert-dialog` |
| `Input` / `Input.TextArea` | `@/components/ui/input` / `@/components/ui/textarea` |
| `Select` | `@/components/ui/select`（`Select/SelectTrigger/SelectValue/SelectContent/SelectItem`） |
| `Switch` | `@/components/ui/switch` |
| `Checkbox` | `@/components/ui/checkbox` |
| `Radio.Group` | `@/components/ui/radio-group` |
| `Form` | 受控 `useState` + `@/components/ui/label` + `@/components/ui/field`（有则用），提交手动校验 |
| `Tabs` | `@/components/ui/tabs`（`Tabs/TabsList/TabsTrigger/TabsContent`） |
| `Tooltip` | `@/components/ui/tooltip` |
| `Popconfirm` | `@/components/ui/alert-dialog` |
| `Drawer` | `@/components/ui/sheet` |
| `Spin` | `@/components/ui/spinner`（`Spinner`） |
| `Empty` | `@/components/ui/empty`（`Empty/EmptyHeader/EmptyMedia`） |
| `Statistic` | 纯文本 + tailwind，或 `StatCard` |
| `Typography.Text/Title/Paragraph` | 原生 `<span>/<h*>/<p>` + tailwind（`text-muted-foreground`、`font-medium` 等） |
| `Alert` | `@/components/ui/alert`（`Alert/AlertTitle/AlertDescription`） |
| `Pagination` | `@/components/ui/pagination` |
| `Descriptions` | `InfoList` 或原生 grid |
| `Space` | `<div className="flex gap-2">` / `flex-col` |
| `Row/Col` | tailwind grid/flex |
| `message.xxx()` / `App.useApp().message` | `import { toast } from "sonner"`；`message.success`→`toast.success`，`error`→`toast.error` |
| `Modal.confirm` | `AlertDialog` 受控组件 |
| `@ant-design/icons`（`XxxOutlined`）| `lucide-react` 对应图标（`ReloadOutlined`→`RefreshCw`，`PlusOutlined`→`Plus`，`DeleteOutlined`→`Trash2`，`EditOutlined`→`Pencil`，`SearchOutlined`→`Search`，`CheckOutlined`→`Check`，`CloseOutlined`→`X` 等） |

## 约定
- 保留原有所有交互、状态、API 调用、错误处理、i18n（若用了 `useTranslation` 继续用）。**功能等价，不删特性。**
- 颜色语义：成功 `text-green-600 dark:text-green-400` / `Badge` 默认；失败/危险 `text-red-600 dark:text-red-400` / `variant="destructive"`；次要 `text-muted-foreground`。
- 时间格式化、余额格式化等纯函数照搬。
- 表格列多、带排序/筛选/分页的，优先用原生 `Table` + 手写逻辑；简单只读表用 `SimpleTable`。
- 不要引入新依赖。只用 user-frontend 已有的 `@/components/ui/*`（见 `src/components/ui/`）。
- 组件文件顶部保留一段简短中文注释说明「从 admin-frontend antd 版重写为 shadcn」。
- 完成后自检：该文件不得再出现 `from "antd"`、`from "antd/*"`、`@ant-design/icons`。

## 交付
- 只产出 `src/pages/manager/platform/<PageName>.tsx`（及必要的子组件，放同目录）。
- **不要改 `App.tsx`**（我统一改路由，避免并发冲突）。
- 报告：产出的文件路径 + 是否 100% 去 antd + 任何未能等价迁移的点。
