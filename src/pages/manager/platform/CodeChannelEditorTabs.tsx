/**
 * 代码渠道「源码」Tab：单一 spec 源码编辑器 + 文档入口链接。
 *
 * 原来的四子 Tab（代码 / 使用说明 / 使用样例 / agent 生成）已收敛：
 * - 代码子 Tab 就是本编辑器本身（不再套一层子 Tab）；
 * - 使用说明与使用样例移入产品文档站（docs-site 自定义代码渠道页）；
 * - agent 生成子 Tab 已删除；
 * - 「编写使用文档」链接指向文档站的对应页面。
 */
import AceEditor from 'react-ace'
import '@/utils/ace-theme'
import 'ace-builds/src-noconflict/mode-python'

/** 文档站「自定义代码渠道」页面；独立部署时可按需替换为自己的文档站地址。 */
export const CODE_CHANNEL_DOC_URL = 'https://ai-lubricant-docs.pages.dev/cap-code-channel'

export function CodeChannelEditorTabs({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flex: '0 0 auto' }}>
        <a
          href={CODE_CHANNEL_DOC_URL}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: '12.5px', color: 'var(--blue)', textDecoration: 'none' }}
        >
          编写使用文档 ↗
        </a>
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, border: '1px solid var(--admin-border)', borderRadius: 'var(--admin-radius)', overflow: 'hidden' }}>
        <AceEditor
          mode="python"
          theme="ai_lubricant"
          name="code-channel-source"
          value={value}
          onChange={onChange}
          width="100%"
          height="100%"
          fontSize={13}
          showPrintMargin={false}
          setOptions={{ useWorker: false, tabSize: 4, useSoftTabs: true }}
          editorProps={{ $blockScrolling: true }}
        />
      </div>
    </div>
  )
}
