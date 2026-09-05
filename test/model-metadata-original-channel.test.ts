import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/pages/manager/platform/ModelMetadata.tsx", import.meta.url),
  "utf8",
);

test("模型元数据使用一个统一导入弹框和入口", () => {
  assert.match(pageSource, /\| \{ kind: 'import'; model: UnifiedModel \}/);
  assert.doesNotMatch(pageSource, /kind: 'original-channel'/);
  assert.match(pageSource, /<Button onClick=\{\(\) => openImportModal\(model\)\} disabled=\{saving\}>导入<\/Button>/);
  assert.doesNotMatch(pageSource, />OR 导入<|>dev 导入<|>原渠道</);
});

test("来源菜单固定包含公共目录并只追加当前模型渠道", () => {
  assert.match(pageSource, /<NativeSelectOption value="catalog:openrouter">OpenRouter<\/NativeSelectOption>/);
  assert.match(pageSource, /<NativeSelectOption value="catalog:modelsdev">models\.dev<\/NativeSelectOption>/);
  assert.match(pageSource, /const channelSources = Array\.from\(new Set\(model\._providers\)\)\.sort\(\)/);
  assert.match(pageSource, /channelSources\.map\(\(provider\) => <NativeSelectOption key=\{provider\} value=\{`channel:\$\{provider\}`\}>\{providerLabel\(provider\)\}/);
  assert.doesNotMatch(pageSource, /providerSummaries\.map\(\(provider\) => \(\s*<NativeSelectOption/);
});

test("三种来源统一加载为候选项，渠道使用只读上游接口", () => {
  assert.match(pageSource, /const loadImportCandidates = useCallback\(async \(source: ImportSource\) => \{/);
  assert.match(pageSource, /source === 'catalog:openrouter'[\s\S]*?fetchOpenRouterCatalog\(\)/);
  assert.match(pageSource, /source === 'catalog:modelsdev'[\s\S]*?fetchModelsDevCatalog\(\)/);
  assert.match(pageSource, /const provider = source\.slice\('channel:'\.length\)[\s\S]*?getProviderUpstreamModels\(provider\)/);
  assert.match(pageSource, /importRequestRef\.current !== requestId/);
  assert.doesNotMatch(pageSource, /refreshProviderModels/);
});

test("所有来源统一选择后填写锁定 model_id 的元数据表单", () => {
  assert.match(pageSource, /function catalogCandidate\(item: CatalogItem \| ModelsDevCatalogItem, source: ImportSource\): ImportCandidate/);
  assert.match(pageSource, /function channelCandidate\(item: ProviderUpstreamModelItem, source: ImportSource, provider: string\): ImportCandidate/);
  assert.match(pageSource, /const selectImportCandidate = useCallback\(\(model: UnifiedModel, candidate: ImportCandidate\) => \{/);
  assert.match(pageSource, /setForm\(createFormState\(destination, model\.model_id\)\)/);
  assert.match(pageSource, /lockModelId: true/);
  assert.match(pageSource, /selectImportCandidate\(model, row\)/);
});

test("导入候选选择不直接同步，保存表单是唯一持久化路径", () => {
  assert.doesNotMatch(pageSource, /syncOpenRouterMetadata|syncModelsDevMetadata|importFromOpenRouter|importFromModelsDev|ensureImportResultOk/);
  const updateCalls = pageSource.match(/await updateModelMetadata\(/g) ?? [];
  assert.equal(updateCalls.length, 1);
  assert.match(pageSource, /const handleSubmitMetadata = useCallback\(async \(event: FormEvent<HTMLFormElement>\) => \{[\s\S]*?await updateModelMetadata\(modelId, buildMetadataBody\(form\)\)/);
});

test("统一弹框以 OpenRouter 为默认来源并在前端过滤候选", () => {
  assert.match(pageSource, /source: 'catalog:openrouter'/);
  assert.match(pageSource, /void loadImportCandidates\('catalog:openrouter'\)/);
  assert.match(pageSource, /const filteredItems = importState\.candidates\.filter/);
  assert.match(pageSource, /value=\{importState\.source\}[\s\S]*?changeImportSource\(event\.target\.value as ImportSource\)/);
  assert.match(pageSource, /导入模型元数据 - \$\{modal\.model\.model_id\}/);
});
