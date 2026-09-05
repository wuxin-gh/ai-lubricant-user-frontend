import assert from "node:assert/strict";
import test from "node:test";

import {
  clearSingleFlight,
  getSingleFlightKey,
  singleFlightCount,
  singleFlightGet,
  stableStringify,
} from "../src/utils/request-single-flight.ts";

test("并发相同 key 的 GET 共享一次加载", async () => {
  clearSingleFlight();
  let loadCount = 0;
  const load = async () => {
    loadCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { value: loadCount };
  };

  const [a, b, c] = await Promise.all([
    singleFlightGet("GET /x", load),
    singleFlightGet("GET /x", load),
    singleFlightGet("GET /x", load),
  ]);

  assert.equal(loadCount, 1, "三个并发请求只应触发一次底层加载");
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  assert.equal(singleFlightCount(), 0, "完成后在途 Map 应清空");
});

test("不同 key 的请求互不合并", async () => {
  clearSingleFlight();
  let loadCount = 0;
  const load = async () => {
    loadCount += 1;
    const mine = loadCount;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return mine;
  };

  const [a, b] = await Promise.all([
    singleFlightGet("GET /x", load),
    singleFlightGet("GET /y", load),
  ]);

  assert.equal(loadCount, 2);
  assert.equal(a, 1);
  assert.equal(b, 2);
});

test("完成后下一次相同请求重新发出（不持久缓存）", async () => {
  clearSingleFlight();
  let loadCount = 0;
  const load = async () => {
    loadCount += 1;
    return loadCount;
  };

  const first = await singleFlightGet("GET /x", load);
  const second = await singleFlightGet("GET /x", load);

  assert.equal(first, 1);
  assert.equal(second, 2, "上一轮完成后，同 key 应重新加载");
});

test("失败不缓存：rejected 后下一次重试", async () => {
  clearSingleFlight();
  let attempt = 0;
  const load = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("boom");
    return "ok";
  };

  await assert.rejects(() => singleFlightGet("GET /x", load), /boom/);
  const retry = await singleFlightGet("GET /x", load);
  assert.equal(retry, "ok");
  assert.equal(singleFlightCount(), 0, "失败的请求也要从在途 Map 清除");
});

test("并发共享者中一人失败，全部收到同一 rejection", async () => {
  clearSingleFlight();
  const load = async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    throw new Error("boom");
  };

  const results = await Promise.allSettled([
    singleFlightGet("GET /x", load),
    singleFlightGet("GET /x", load),
  ]);

  assert.ok(results.every((r) => r.status === "rejected"));
  assert.equal(singleFlightCount(), 0);
});

test("stableStringify 键序无关，参数序列化稳定", () => {
  assert.equal(
    stableStringify({ page: 1, size: 50, status: "pending" }),
    stableStringify({ status: "pending", size: 50, page: 1 }),
  );
  assert.notEqual(
    stableStringify({ page: 1 }),
    stableStringify({ page: 2 }),
  );
});

test("getSingleFlightKey 区分 method、url 与参数", () => {
  const get = getSingleFlightKey("GET", "/api/v1/admin/nodes");
  const getWithParams = getSingleFlightKey("GET", "/api/v1/admin/nodes", { status: "pending" });
  const post = getSingleFlightKey("POST", "/api/v1/admin/nodes");
  const otherUrl = getSingleFlightKey("GET", "/api/v1/teams/groups");

  assert.notEqual(get, post, "写请求 method 不同，不会与 GET 混到同一个 key");
  assert.notEqual(get, getWithParams);
  assert.notEqual(get, otherUrl);
  assert.equal(get.startsWith("GET "), true);
});
