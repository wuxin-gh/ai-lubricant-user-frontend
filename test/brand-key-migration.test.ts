import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const themeProviderSource = readFileSync(
  new URL("../src/components/theme-provider.tsx", import.meta.url),
  "utf8",
);
const terminalThemesSource = readFileSync(
  new URL("../src/utils/terminalThemes.ts", import.meta.url),
  "utf8",
);

test("主题 localStorage key 迁移到 ai-lubricant-theme 并保留旧值回读", () => {
  assert.match(appSource, /storageKey="ai-lubricant-theme"/);
  assert.doesNotMatch(appSource, /storageKey="monkeycode-theme"/);

  // index.html 的 pre-React 脚本必须先读新 key，miss 时读旧 key 并一次性迁移，
  // 否则老用户首屏主题闪烁、React 挂载后偏好丢失。
  assert.match(indexSource, /getItem\("ai-lubricant-theme"\)/);
  assert.match(indexSource, /getItem\("monkeycode-theme"\)/);
  assert.match(indexSource, /removeItem\("monkeycode-theme"\)/);

  // ThemeProvider 兜底迁移：React 端读不到新 key 时同样从旧 key 恢复。
  assert.match(themeProviderSource, /getItem\("monkeycode-theme"\)/);
  assert.match(themeProviderSource, /setItem\(storageKey, legacy\)/);
});

test("终端主题改名 AiLubricant 且兼容存量 MonkeyCode 值", () => {
  assert.match(terminalThemesSource, /const AiLubricant = \{/);
  assert.match(terminalThemesSource, /"name": "Ai Lubricant"/);
  assert.doesNotMatch(terminalThemesSource, /"name": "MonkeyCode"/);

  // localStorage 里存的是主题 key；所有读取点都要把旧值映射成新 key。
  for (const file of [
    "../src/components/common/terminal.tsx",
    "../src/components/nodes/node-terminal-dialog.tsx",
    "../src/pages/shared-terminal.tsx",
    "../src/pages/console/user/terminal.tsx",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /savedTheme === ["']MonkeyCode["']/, `${file} 应映射旧主题值`);
    assert.match(source, /["']AiLubricant["']/, `${file} 应使用新默认主题`);
  }
});
