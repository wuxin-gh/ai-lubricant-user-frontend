import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  sidebar: readSource("../src/components/manager/manager-sidebar.tsx"),
  navMain: readSource("../src/components/manager/nav-main.tsx"),
  navManager: readSource("../src/components/manager/nav-manager.tsx"),
  page: readSource("../src/pages/console/manager/page.tsx"),
};
// sidebar \u662f\u552f\u4e00\u7eaf i18n \u6e32\u67d3\u7684\u5916\u58f3\uff1bnav-main/nav-manager/page \u542b\u6570\u636e\u9a71\u52a8\u7684
// \u4e2d\u6587 fallback \u4e0e\u5e73\u53f0 label \u5b57\u9762\u91cf\uff0c\u4e0d\u53c2\u4e0e\u88f8\u4e2d\u6587\u68c0\u67e5\u3002
const combinedSource = sourceFiles.sidebar;
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("管理后台外壳使用 managerShell i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
  }

  assert.match(sourceFiles.sidebar, /t\("managerShell\.brand\.subtitle"\)/);
  assert.match(sourceFiles.navMain, /labelKey: "managerShell\.nav\.overview"/);
  assert.match(sourceFiles.navMain, /labelKey: "managerShell\.nav\.members"/);
  assert.match(sourceFiles.navMain, /t\(item\.labelKey, item\.fallback\)/);
  assert.match(sourceFiles.navManager, /t\("managerShell\.account\.changePassword\.title"\)/);
  assert.match(sourceFiles.navManager, /t\("managerShell\.account\.logout\.confirmTitle"\)/);
  assert.match(sourceFiles.page, /t\("managerShell\.actions\.refresh"\)/);
  assert.match(sourceFiles.page, /t\("managerShell\.breadcrumb\.fallback"\)/);
  assert.doesNotMatch(combinedSource, cjkPattern);
});

test("管理后台外壳提供中英文资源", () => {
  assert.equal(cn.managerShell.nav.overview, "仪表盘");
  assert.equal(en.managerShell.nav.overview, "Dashboard");
  assert.equal(cn.managerShell.account.changePassword.title, "修改密码");
  assert.equal(en.managerShell.account.changePassword.title, "Change password");
  assert.equal(cn.managerShell.actions.refresh, "刷新");
  assert.equal(en.managerShell.actions.refresh, "Refresh");
});
