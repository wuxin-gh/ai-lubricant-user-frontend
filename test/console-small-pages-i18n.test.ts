import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const ideSource = readFileSync(new URL("../src/pages/console/user/ide-ide.tsx", import.meta.url), "utf8");
const cjkPattern = /[㐀-鿿]/;

test("IDE 页面使用 i18n key", () => {
  assert.match(ideSource, /useTranslation/);
  assert.match(ideSource, /t\("consoleIde\.comingSoonTitle"\)/);
  assert.doesNotMatch(ideSource, cjkPattern);
});

test("IDE 页面提供中英文资源", () => {
  assert.equal(cn.consoleIde.openSourceRepository, "开源仓库");
  assert.equal(en.consoleIde.openSourceRepository, "Open source repository");
});
