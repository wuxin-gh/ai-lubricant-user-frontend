import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const commonSource = readFileSync(
  new URL("../src/utils/common.tsx", import.meta.url),
  "utf8",
);

const functionSourceMatch = commonSource.match(
  /export function selectPreferredTaskModel[\s\S]*?\n}\n\n\nexport function selectHost/,
);

test("默认任务模型在 public 模型不可用时回退到列表里第一个可用模型", () => {
  assert.ok(functionSourceMatch, "selectPreferredTaskModel source should be present");

  const functionSource = functionSourceMatch[0];
  const preferredModelIndex = functionSource.indexOf("const preferredModel = models");
  const fallbackModelIndex = functionSource.indexOf("const fallbackModel = models.find");
  const emptyReturnIndex = functionSource.indexOf('return ""');

  assert.ok(preferredModelIndex >= 0, "should first try public preferred models");
  assert.ok(fallbackModelIndex > preferredModelIndex, "fallback should run after public preferred models");
  assert.ok(emptyReturnIndex > fallbackModelIndex, "fallback should run before returning an empty model id");

  const preferredSource = functionSource.slice(preferredModelIndex, fallbackModelIndex);
  assert.match(preferredSource, /owner\?\.type === ConstsOwnerType\.OwnerTypePublic/);
  assert.doesNotMatch(preferredSource, /canUseModelBySubscription/);

  const fallbackSource = functionSource.slice(fallbackModelIndex, emptyReturnIndex);
  assert.match(fallbackSource, /model\.id/);
  assert.doesNotMatch(fallbackSource, /canUseModelBySubscription/);
  assert.doesNotMatch(fallbackSource, /subscription/);
});
