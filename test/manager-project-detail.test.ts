import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const app = readSource("../src/App.tsx");
const nav = readSource("../src/components/manager/nav-main.tsx");
const projects = readSource("../src/pages/console/manager/projects.tsx");
const detail = readSource("../src/pages/console/manager/project-detail.tsx");

test("管理端首页与旧任务/编辑器路由收敛到项目", () => {
  assert.match(app, /<Route index element={<Navigate to="\/manager\/projects" replace \/>} \/>/);
  assert.match(app, /path="projects\/:projectId" element={<ManagerProjectDetailPage \/>}/);
  assert.match(app, /path="tasks" element={<Navigate to="\/manager\/projects" replace \/>}/);
  assert.match(app, /path="editors" element={<Navigate to="\/manager\/projects" replace \/>}/);
});

test("管理端侧栏移除独立任务与编辑器入口", () => {
  assert.doesNotMatch(nav, /to: "\/manager\/tasks"/);
  assert.doesNotMatch(nav, /to: "\/manager\/editors"/);
  assert.match(nav, /to: "\/manager\/projects"/);
});

test("项目列表可下钻，详情复用用户侧 ProjectOverviewPage", () => {
  assert.match(projects, /navigate\(`\/manager\/projects\/\$\{project\.id\}`\)/);
  // 直接复用用户侧 ProjectOverviewPage（信息卡 + info/issues/tasks/editors tabs），
  // 不再单独实现只读表格；读权限由后端 privileged 角色越权保证。
  assert.match(detail, /import ProjectOverviewPage from "@\/pages\/console\/user\/project\/overview"/);
  assert.match(detail, /<ProjectOverviewPage \/>/);
  assert.match(detail, /navigate\("\/manager\/projects"\)/);
  assert.match(detail, /flex h-full min-h-0 flex-col/);
});

test("项目详情提供中英文资源", () => {
  assert.equal(cn.managerProjectDetail.back, "返回项目列表");
  assert.equal(en.managerProjectDetail.back, "Back to projects");
});
