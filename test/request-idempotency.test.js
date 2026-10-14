const test = require("node:test");
const assert = require("node:assert/strict");
const MemoryFirestore = require("./helpers/memory-firestore");
const guard = require("../lib/request-idempotency");
function request(
  key = "12345678-1234-1234-1234-123456789012",
  body = { items: [{ id: "p", qty: 1 }] },
) {
  return {
    get: () => key,
    session: { user: { email: "a@example.test" } },
    body,
  };
}
function response() {
  return {
    statusCode: 200,
    body: null,
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}
test("lost sale response replays the acknowledged result without starting another sale", async () => {
  const db = new MemoryFirestore();
  const middleware = guard(db);
  let starts = 0;
  const req = request(),
    res = response();
  await middleware(req, res, () => {
    starts++;
  });
  await res.json({ sale: { id: "s" } });
  const replay = response();
  await middleware(request(), replay, () => {
    starts++;
  });
  assert.equal(starts, 1);
  assert.equal(replay.body.sale.id, "s");
});
test("concurrent request key and changed payload are rejected before gateway calls", async () => {
  const db = new MemoryFirestore();
  const middleware = guard(db);
  let starts = 0;
  const a = response(),
    b = response();
  await Promise.all([
    middleware(request(), a, () => {
      starts++;
    }),
    middleware(request(), b, () => {
      starts++;
    }),
  ]);
  assert.equal(starts, 1);
  assert.equal(b.statusCode, 409);
  const changed = response();
  await middleware(request(undefined, { different: true }), changed, () => {
    starts++;
  });
  assert.equal(changed.statusCode, 409);
  assert.equal(starts, 1);
});
test("validation can be corrected; uncertain gateway attempts remain protected", async () => {
  const db = new MemoryFirestore();
  const middleware = guard(db);
  let r = response();
  const q = request();
  await middleware(q, r, () => {});
  r.status(400);
  await r.json({ error: true });
  let next = 0;
  r = response();
  const q2 = request();
  await middleware(q2, r, () => next++);
  assert.equal(next, 1);
  q2.paymentStarted = true;
  r.status(502);
  await r.json({ error: true, pending: true });
  const retry = response();
  await middleware(request(), retry, () => next++);
  assert.equal(next, 1);
  assert.equal(retry.statusCode, 502);
});
