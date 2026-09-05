import assert from "node:assert/strict";
import test from "node:test";

import { clearSingleFlight } from "../src/utils/request-single-flight.ts";
import { getSingleFlightKey, singleFlightGet } from "../src/utils/request-single-flight.ts";

/**
 * 生成版 Api 共享实例的 GET single-flight fetch 行为测试。
 *
 * shared-api.ts 无法直接在 Node 下 import（依赖浏览器 localStorage 之类
 * 的模块图），这里复刻其 singleFlightFetch 的共享逻辑跑真实 fetch：核心
 * 行为是「每个共享者拿到独立的 Response，都能各自读一次 body」——直接
 * 共享同一个 Response 会让第二个调用方在读 body 时抛
 * "Body has already been consumed"。实现如有改动请同步这里。
 */
async function singleFlightFetchLike(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : String(input);
  const method = ((init && init.method) || "GET").toUpperCase();
  const hasOwnSignal = Boolean(init && init.signal);
  if (method !== "GET" || hasOwnSignal) {
    return fetch(input, init);
  }
  const shared = await singleFlightGet(getSingleFlightKey("GET", url), async () => {
    const response = await fetch(input, init);
    const body = await response.clone().arrayBuffer().catch(() => null);
    return { response, status: response.status, statusText: response.statusText, headers: response.headers, body };
  });
  if (shared.body === null) return shared.response;
  return new Response(shared.body, {
    status: shared.status,
    statusText: shared.statusText,
    headers: shared.headers,
  });
}

test("并发相同 GET 只发一次 fetch，每个共享者都能读 body", async () => {
  clearSingleFlight();
  const http = await import("node:http");
  let backendHits = 0;
  const server = http.createServer((_req, res) => {
    backendHits += 1;
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ code: 0, n: backendHits }));
    }, 20);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/server/config`;

  try {
    const [r1, r2, r3] = await Promise.all([
      singleFlightFetchLike(url),
      singleFlightFetchLike(url),
      singleFlightFetchLike(url),
    ]);
    assert.equal(backendHits, 1, "三个并发 GET 只应打一次后端");

    // 关键行为：三个共享者各自读 body 都成功（不抛 already consumed）。
    const bodies = await Promise.all([r1.json(), r2.json(), r3.json()]);
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[1], bodies[2]);
    assert.equal(bodies[0].code, 0);

    const r4 = await singleFlightFetchLike(url);
    const body4 = await r4.json();
    assert.equal(backendHits, 2, "完成后重新发出");
    assert.equal(body4.n, 2);
  } finally {
    server.close();
  }
});

test("非 GET 与带 signal 的调用不走合并", async () => {
  clearSingleFlight();
  const http = await import("node:http");
  let backendHits = 0;
  const server = http.createServer((_req, res) => {
    backendHits += 1;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/x`;
  const controller = new AbortController();

  try {
    const [post1, post2] = await Promise.all([
      singleFlightFetchLike(url, { method: "POST", body: "{}" }),
      singleFlightFetchLike(url, { method: "POST", body: "{}" }),
    ]);
    assert.equal(backendHits, 2, "POST 各发各的");

    await Promise.all([
      singleFlightFetchLike(url),
      singleFlightFetchLike(url, { signal: controller.signal }),
    ]);
    assert.equal(backendHits, 4, "带 signal 的 GET 不与其他 GET 合并");
  } finally {
    controller.abort();
    server.close();
  }
});
