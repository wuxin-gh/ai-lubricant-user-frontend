import assert from "node:assert/strict";
import test from "node:test";

import { reduceItems, type NormalizedItem } from "../src/components/console/task/item-to-message.ts";

/** One persisted row as the reducer receives it. */
function row(item: NormalizedItem, seq: number) {
  return { item, agentId: "", seq };
}

test("a tool call reported twice renders as one card, not a spinner beside its own result", () => {
  // The runtime reports an item as it advances, and every report is persisted as
  // its own row: the opening one carries the name and input, the closing one only
  // the output and status. Rendering both is the bug — the first copy stays
  // `in_progress` and spins forever next to the completed second copy.
  const { messages } = reduceItems([
    row({ id: "tool-1", type: "tool_call", title: "Read", input: { file_path: "/a.ts" }, status: "running" }, 1),
    row({ id: "tool-1", type: "tool_call", output: "file body", status: "done" }, 2),
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.status, "completed");
  // The sparse closing report must not erase what only the opening one carried.
  assert.equal(messages[0].data.title, "Read");
  assert.deepEqual(messages[0].data.rawInput, { file_path: "/a.ts" });
  assert.equal(messages[0].data.content, "file body");
});

test("a failed tool call keeps its failure status", () => {
  const { messages } = reduceItems([
    row({ id: "tool-2", type: "tool_call", title: "Bash", status: "running" }, 1),
    row({ id: "tool-2", type: "tool_call", output: "boom", status: "failed" }, 2),
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.status, "failed");
});

test("distinct items still render as distinct cards, in order", () => {
  const { messages } = reduceItems([
    row({ id: "a", type: "agent_message", text: "first" }, 1),
    row({ id: "b", type: "tool_call", title: "Read", status: "running" }, 2),
    row({ id: "c", type: "agent_message", text: "second" }, 3),
  ]);

  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map((m) => m.id), ["item-a", "item-b", "item-c"]);
});

test("a later report updates the card in place rather than moving it to the end", () => {
  // Order matters: the completion of an early tool call must not jump the card
  // below messages that were emitted after it started.
  const { messages } = reduceItems([
    row({ id: "tool-3", type: "tool_call", title: "Read", status: "running" }, 1),
    row({ id: "later", type: "agent_message", text: "after" }, 2),
    row({ id: "tool-3", type: "tool_call", output: "done", status: "done" }, 3),
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].id, "item-tool-3");
  assert.equal(messages[0].data.status, "completed");
  assert.equal(messages[1].id, "item-later");
});

test("streamed agent text is replaced by its latest report, not concatenated", () => {
  // The runtime re-sends a block's full text, so folding must overwrite; adding
  // them would duplicate the answer.
  const { messages } = reduceItems([
    row({ id: "msg-1", type: "agent_message", text: "partial" }, 1),
    row({ id: "msg-1", type: "agent_message", text: "partial and complete" }, 2),
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.content, "partial and complete");
});

test("one failed turn renders exactly one error card, not bubble plus card plus live copy", () => {
  // The provider echoes the upstream failure as an assistant message, the
  // runtime's error frame persists as an `error` item, and the live frame adds
  // a third copy with a different id. All three collapse to the single error
  // card — the presentation that carries the retry affordance.
  const { messages } = reduceItems([
    row({ id: "u1", type: "user_input", text: "查天气" }, 1),
    row({ id: "m1", type: "agent_message", text: "API Error: Request rejected (429) · No available account for the requested model." }, 2),
    row({ id: "e1", type: "error", text: "API Error: Request rejected (429) · No available account for the requested model." }, 3),
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].type, "user_input");
  assert.equal(messages[1].type, "error_message");
  assert.equal(messages[1].data.text, "API Error: Request rejected (429) · No available account for the requested model.");
});

test("distinct error turns and genuine assistant text are never collapsed", () => {
  const { messages } = reduceItems([
    row({ id: "u1", type: "user_input", text: "第一轮" }, 1),
    row({ id: "m1", type: "agent_message", text: "API Error: 429 quota" }, 2),
    row({ id: "e1", type: "error", text: "API Error: 429 quota" }, 3),
    row({ id: "u2", type: "user_input", text: "第二轮" }, 4),
    row({ id: "m2", type: "agent_message", text: "API Error: 429 quota" }, 5),
  ]);

  // Turn 1: bubble upgraded to card. Turn 2: the same text is a NEW turn — the
  // genuine assistant message of a later turn must survive.
  assert.equal(messages.length, 4);
  assert.deepEqual(messages.map((m) => m.type), ["user_input", "error_message", "user_input", "agent_message_chunk"]);
});

test("collapseErrorDuplicates folds live-frame copies onto the replayed card", async () => {
  const { collapseErrorDuplicates } = await import("../src/components/console/task/item-to-message.ts");
  const ERROR = "API Error: Request rejected (429)";
  const card = (id: string): never => ({ id, time: 0, role: "agent", type: "error_message", data: { text: ERROR } }) as never;
  // Replay provides bubble + card; live appends its own frame copy (new id).
  const merged = collapseErrorDuplicates([
    { id: "item-u1", time: 0, role: "user", type: "user_input", data: { content: "查天气" } },
    { id: "item-m1", time: 0, role: "agent", type: "agent_message_chunk", data: { content: ERROR } },
    card("item-e1"),
    card("error-4"),
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].type, "user_input");
  assert.equal(merged[1].type, "error_message");
});
