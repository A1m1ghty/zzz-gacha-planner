import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished planner shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /新艾利都资源规划局/);
  assert.match(html, /把运气/);
  assert.match(html, /现有资源/);
  assert.match(html, />重置</);
  assert.match(html, /目标组/);
  const resourceHeading = html.indexOf("<h3>现有资源</h3>");
  const goalsHeading = html.indexOf("<h3>目标组</h3>");
  const pityHeading = html.indexOf("<h3>保底状态</h3>");
  assert.ok(resourceHeading >= 0 && resourceHeading < goalsHeading);
  assert.ok(goalsHeading < pityHeading);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});
