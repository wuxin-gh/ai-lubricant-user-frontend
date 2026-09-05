import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  listPage: readSource("../src/components/manager/manager-list-page.tsx"),
  conversations: readSource("../src/pages/console/manager/conversations.tsx"),
  detailDialog: readSource("../src/components/manager/conversation-detail-dialog.tsx"),
};
const combinedSource = Object.values(sourceFiles).join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("对话管理页面使用 managerConversations i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
  }

  assert.match(sourceFiles.listPage, /t\("managerList\.count"/);
  assert.match(sourceFiles.conversations, /t\("managerConversations\.title"\)/);
  assert.match(sourceFiles.conversations, /t\("managerConversations\.columns\.input"\)/);
  assert.match(sourceFiles.conversations, /t\("managerConversations\.empty\.description"\)/);
  assert.doesNotMatch(combinedSource, cjkPattern);
});

test("对话管理页面根容器参与 flex 高度链，避免分页被裁切", () => {
  // 根容器 + loading 容器必须带 min-h-0 flex-1 flex flex-col，否则 ManagerListCard
  // 拿不到有界高度，表格会把底部分页撑出视口、被父级 overflow-hidden 裁掉。
  const flexChain = /flex min-h-0 flex-1 flex-col/;
  const matches = sourceFiles.conversations.match(new RegExp(flexChain, "g")) ?? [];
  assert.ok(matches.length >= 2, "根容器与 loading 容器都应参与 flex 高度链");
});

test("对话管理页面提供三类详情入口", () => {
  // project 行跳管理端项目详情；agent/chat 行打开只读详情弹框。
  assert.match(sourceFiles.conversations, /\/manager\/projects\//);
  assert.match(sourceFiles.conversations, /ConversationDetailDialog/);
  assert.match(sourceFiles.conversations, /t\("managerConversations\.actions\.viewDetail"\)/);
  // 详情走 admin token 的 /admin/* 端点，不能用按 user_id 过滤的用户侧 agentClient。
  assert.match(sourceFiles.detailDialog, /v1AdminAgentConversationsDetail/);
  assert.match(sourceFiles.detailDialog, /v1AdminChatConversationsDetail/);
  assert.doesNotMatch(sourceFiles.detailDialog, /from "@\/api\/agentClient"/);
});

test("对话管理页面提供中英文资源", () => {
  assert.equal(cn.managerConversations.title, "对话");
  assert.equal(en.managerConversations.title, "Conversations");
  assert.equal(cn.managerConversations.columns.input, "用户输入");
  assert.equal(en.managerConversations.columns.input, "User input");
  assert.equal(cn.managerList.count, " · 当前 {{count}} 条");
  assert.equal(en.managerList.count, " · {{count}} items");
});
