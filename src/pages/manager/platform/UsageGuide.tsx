/**
 * 使用指南（平台管理页）。
 * 从 admin-frontend 的 antd 版重写为 shadcn；数据层继续复用 `@/@admin-port/api/*`（纯 axios）。
 */
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { copyToClipboard } from '@/utils/clipboard'
import { AdminPage, SectionCard, SimpleTable } from '@/components/manager/platform-page'
import type { SimpleTableColumn } from '@/components/manager/platform-page'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type ParamRow = {
  param: string
  type: string
  desc: string
}

type EndpointRow = {
  method: 'GET' | 'POST'
  path: string
  desc: string
}

const ENDPOINTS: EndpointRow[] = [
  { method: 'GET', path: '/v1/models', desc: '可用模型列表（别名 /models）' },
  { method: 'POST', path: '/v1/chat/completions', desc: 'OpenAI 兼容聊天接口（别名 /chat/completions）' },
  { method: 'POST', path: '/v1/responses', desc: 'OpenAI Responses 接口（别名 /responses）' },
  { method: 'POST', path: '/v1/messages', desc: 'Anthropic 兼容消息接口（别名 /messages）' },
  { method: 'POST', path: '/v1/images/generations', desc: '图片生成（别名 /images/generations）' },
  { method: 'POST', path: '/v1/videos/generations', desc: '视频生成（别名 /videos/generations）' },
  { method: 'POST', path: '/v1/audio/speech', desc: '文本转语音（别名 /audio/speech）' },
]

const OPENAI_PARAMS: ParamRow[] = [
  { param: 'model', type: 'string', desc: '模型ID，从 /v1/models 获取' },
  { param: 'messages', type: 'array', desc: '消息数组，[{role, content}]' },
  { param: 'stream', type: 'boolean', desc: '是否流式返回，默认 false' },
  { param: 'temperature', type: 'number', desc: '采样温度，0-2，默认 0.7' },
  { param: 'max_tokens', type: 'number', desc: '最大输出 token 数' },
  { param: 'tools', type: 'array', desc: '工具定义数组' },
]

const RESPONSES_PARAMS: ParamRow[] = [
  { param: 'model', type: 'string', desc: '模型ID，从 /v1/models 获取' },
  { param: 'input', type: 'string | array', desc: '输入内容，可为字符串或消息项数组' },
  { param: 'stream', type: 'boolean', desc: '是否流式返回，默认 false' },
  { param: 'temperature', type: 'number', desc: '采样温度，0-2' },
  { param: 'max_output_tokens', type: 'number', desc: '最大输出 token 数' },
  { param: 'instructions', type: 'string', desc: '系统级指令（可选）' },
]

const ANTHROPIC_PARAMS: ParamRow[] = [
  { param: 'model', type: 'string', desc: '模型ID' },
  { param: 'messages', type: 'array', desc: '消息数组' },
  { param: 'max_tokens', type: 'number', desc: '最大输出 token 数' },
  { param: 'stream', type: 'boolean', desc: '是否流式返回' },
  { param: 'system', type: 'string', desc: '系统提示词' },
  { param: 'tools', type: 'array', desc: '工具定义数组' },
]

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</code>
  )
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    if (await copyToClipboard(children)) {
      setCopied(true)
      toast.success('已复制')
      setTimeout(() => setCopied(false), 1500)
    } else {
      toast.error('复制失败，请手动选择')
    }
  }
  return (
    <div className="relative mb-4">
      <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-[13px] leading-relaxed whitespace-pre">
        {children}
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-1.5 top-1.5"
        onClick={() => void handleCopy()}
        aria-label="复制"
      >
        {copied ? <Check className="text-green-600 dark:text-green-400" /> : <Copy />}
      </Button>
    </div>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h5 className="mb-2 mt-4 text-sm font-semibold">{children}</h5>
}

function ParamTable({ rows }: { rows: ParamRow[] }) {
  const columns: SimpleTableColumn<ParamRow>[] = [
    { key: 'param', label: '参数', width: 200, render: (v) => <InlineCode>{v as string}</InlineCode> },
    { key: 'type', label: '类型', width: 140, render: (v) => <InlineCode>{v as string}</InlineCode> },
    { key: 'desc', label: '说明' },
  ]
  return <SimpleTable<ParamRow> rowKey="param" columns={columns} rows={rows} />
}

function EndpointTable({ rows }: { rows: EndpointRow[] }) {
  const columns: SimpleTableColumn<EndpointRow>[] = [
    {
      key: 'method',
      label: '方法',
      width: 100,
      render: (v) => (
        <Badge
          variant="outline"
          className={
            v === 'GET'
              ? 'text-green-600 dark:text-green-400'
              : 'text-blue-600 dark:text-blue-400'
          }
        >
          {v as string}
        </Badge>
      ),
    },
    { key: 'path', label: '路径', width: 320, render: (v) => <InlineCode>{v as string}</InlineCode> },
    { key: 'desc', label: '说明' },
  ]
  return <SimpleTable<EndpointRow> rowKey="path" columns={columns} rows={rows} />
}

export function UsageGuide() {
  return (
    <AdminPage title="使用指南" description="API 接口文档和调用示例，帮助客户端快速接入服务">
      <UsageGuideBody />
    </AdminPage>
  )
}

/**
 * 使用指南正文（不含 AdminPage 页壳）。
 * 供独立页 UsageGuide 与 API Keys 页的「使用方法」弹框共用。
 */
export function UsageGuideBody() {
  return (
    <div className="flex w-full flex-col gap-4">
      <SectionCard title="API 端点">
        <Alert className="mb-3">
          <AlertDescription>
            基础地址为 http://localhost:8000，请替换为您实际部署的服务地址。API Key 请在「密钥」页面创建和管理。
          </AlertDescription>
        </Alert>
        <EndpointTable rows={ENDPOINTS} />
      </SectionCard>

      <SectionCard title="鉴权方式">
        <Alert className="mb-3">
          <AlertDescription>
            所有公开协议共用同一套 API Key 鉴权。可使用以下任一 Header 携带密钥；当两者同时存在时，以 <InlineCode>x-api-key</InlineCode> 为准。
          </AlertDescription>
        </Alert>
        <CodeBlock>{`# 方式一：Bearer Token（推荐，OpenAI / Responses / Messages 均适用）
Authorization: Bearer YOUR_API_KEY

# 方式二：x-api-key（Anthropic 客户端习惯，全协议通用）
x-api-key: YOUR_API_KEY`}</CodeBlock>
      </SectionCard>

      <SectionCard title="协议调用">
        <Tabs defaultValue="openai-chat">
          <TabsList className="mb-4">
            <TabsTrigger value="openai-chat">OpenAI Chat</TabsTrigger>
            <TabsTrigger value="openai-responses">OpenAI Responses</TabsTrigger>
            <TabsTrigger value="anthropic">Anthropic Messages</TabsTrigger>
          </TabsList>

          <TabsContent value="openai-chat">
            <SubHeading>端点</SubHeading>
            <CodeBlock>{`POST /v1/chat/completions      # 别名 POST /chat/completions`}</CodeBlock>

            <SubHeading>核心参数</SubHeading>
            <ParamTable rows={OPENAI_PARAMS} />

            <SubHeading>curl 示例</SubHeading>
            <CodeBlock>{`curl http://localhost:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "YOUR_MODEL",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": true
  }'`}</CodeBlock>

            <SubHeading>Python SDK 示例</SubHeading>
            <CodeBlock>{`from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="YOUR_API_KEY"
)

response = client.chat.completions.create(
    model="YOUR_MODEL",
    messages=[{"role": "user", "content": "你好"}],
    stream=True
)
for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")`}</CodeBlock>

            <SubHeading>流式响应</SubHeading>
            <p className="text-sm text-muted-foreground">
              设置 <InlineCode>stream: true</InlineCode> 时，响应为 OpenAI 兼容的 SSE，每行以 <InlineCode>data:</InlineCode> 前缀返回 <InlineCode>chat.completion.chunk</InlineCode> 片段，流结束以 <InlineCode>data: [DONE]</InlineCode> 标记。
            </p>
          </TabsContent>

          <TabsContent value="openai-responses">
            <SubHeading>端点</SubHeading>
            <CodeBlock>{`POST /v1/responses      # 别名 POST /responses`}</CodeBlock>

            <SubHeading>核心参数</SubHeading>
            <ParamTable rows={RESPONSES_PARAMS} />

            <SubHeading>curl 示例</SubHeading>
            <CodeBlock>{`curl http://localhost:8000/v1/responses \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "YOUR_MODEL",
    "input": [{"role": "user", "content": "你好"}],
    "stream": true
  }'`}</CodeBlock>

            <SubHeading>流式响应</SubHeading>
            <p className="text-sm text-muted-foreground">
              设置 <InlineCode>stream: true</InlineCode> 时，响应为 Responses 兼容的 SSE 事件流，包含 <InlineCode>response.created</InlineCode>、<InlineCode>response.output_text.delta</InlineCode>、<InlineCode>response.completed</InlineCode> 等事件类型。
            </p>
          </TabsContent>

          <TabsContent value="anthropic">
            <SubHeading>端点</SubHeading>
            <CodeBlock>{`POST /v1/messages      # 别名 POST /messages`}</CodeBlock>

            <SubHeading>核心参数</SubHeading>
            <ParamTable rows={ANTHROPIC_PARAMS} />

            <SubHeading>curl 示例</SubHeading>
            <CodeBlock>{`curl http://localhost:8000/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{
    "model": "YOUR_MODEL",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好"}]
  }'`}</CodeBlock>

            <SubHeading>流式响应</SubHeading>
            <p className="text-sm text-muted-foreground">
              设置 <InlineCode>stream: true</InlineCode> 时，响应为 Anthropic 兼容的 SSE 事件流，包含 <InlineCode>message_start</InlineCode>、<InlineCode>content_block_delta</InlineCode>、<InlineCode>message_stop</InlineCode> 等事件类型。<InlineCode>anthropic-version</InlineCode> 非强制，保留以兼容官方客户端。
            </p>
          </TabsContent>
        </Tabs>
      </SectionCard>

      <SectionCard title="多模态生成">
        <Alert className="mb-3">
          <AlertDescription>
            图片、视频、语音为独立模态端点，鉴权方式与聊天协议一致。模型ID请从 <InlineCode>/v1/models</InlineCode> 获取。
          </AlertDescription>
        </Alert>
        <EndpointTable
          rows={[
            { method: 'POST', path: '/v1/images/generations', desc: '图片生成（别名 /images/generations）' },
            { method: 'POST', path: '/v1/videos/generations', desc: '视频生成（别名 /videos/generations）' },
            { method: 'POST', path: '/v1/audio/speech', desc: '文本转语音（别名 /audio/speech）' },
          ]}
        />

        <SubHeading>图片生成示例</SubHeading>
        <CodeBlock>{`curl http://localhost:8000/v1/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "YOUR_MODEL",
    "prompt": "一只柴犬",
    "n": 1,
    "size": "1024x1024"
  }'`}</CodeBlock>

        <SubHeading>视频生成示例</SubHeading>
        <CodeBlock>{`curl http://localhost:8000/v1/videos/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "YOUR_MODEL",
    "prompt": "日落延时摄影"
  }'`}</CodeBlock>

        <SubHeading>文本转语音示例</SubHeading>
        <CodeBlock>{`curl http://localhost:8000/v1/audio/speech \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{
    "model": "YOUR_MODEL",
    "input": "你好，这是一段测试语音。",
    "voice": "alloy"
  }' --output speech.mp3`}</CodeBlock>
      </SectionCard>
    </div>
  )
}
