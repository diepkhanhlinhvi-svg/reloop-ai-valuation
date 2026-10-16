import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase, useFakeBlob } from "./helpers.js";

process.env.AUTH_SECRET = "test-secret";
process.env.AUTH_USERS = JSON.stringify([
  { username: "admin", password: "adminpass", role: "admin", name: "Quản trị viên" },
  { username: "user1", password: "pass1", role: "user", name: "Người dùng 1" },
  { username: "user2", password: "pass2", role: "user", name: "Người dùng 2" }
]);

let server;
let baseUrl;

before(async () => {
  await useTestDatabase();
  useFakeBlob();
  const { default: app } = await import("../server.js");
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

async function call(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function login(username, password) {
  const result = await call("/api/auth/login", { method: "POST", body: { username, password } });
  assert.equal(result.status, 200);
  return result.cookie;
}

test("đăng bán, duyệt, mua và đồng bộ trạng thái qua API", async () => {
  const seller = await login("user1", "pass1");
  const buyer = await login("user2", "pass2");
  const adminCookie = await login("admin", "adminpass");

  assert.equal((await call("/api/listings", { method: "POST", body: { name: "Loa", price: 500_000 } })).status, 401);
  const created = await call("/api/listings", { method: "POST", cookie: seller, body: { name: "Loa", price: 500_000 } });
  assert.equal(created.status, 201);
  const id = created.body.listing.id;

  assert.equal((await call(`/api/listings/${id}`, { method: "PATCH", cookie: seller, body: { status: "approved" } })).status, 403);
  assert.equal((await call(`/api/listings/${id}`, { method: "PATCH", cookie: adminCookie, body: { status: "approved" } })).status, 200);
  assert.equal((await call("/api/listings")).body.listings.length, 1);

  const order = await call("/api/orders", {
    method: "POST", cookie: buyer,
    body: { items: [{ listingId: id }], phone: "0901234567", address: "12 Nguyễn Huệ" }
  });
  assert.equal(order.status, 201);
  assert.equal((await call("/api/listings")).body.listings.length, 0, "món đã có người mua biến khỏi chợ");

  const again = await call("/api/orders", {
    method: "POST", cookie: adminCookie,
    body: { items: [{ listingId: id }], phone: "0901234567", address: "12 Nguyễn Huệ" }
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.unavailable[0].id, id, "lỗi 409 trả về món nào không còn để frontend gỡ khỏi giỏ");

  const orderId = order.body.orders[0].id;
  assert.equal((await call(`/api/orders/${orderId}`, { method: "PATCH", cookie: seller, body: { action: "confirm" } })).body.order.status, "confirmed");
  assert.equal((await call(`/api/orders/${orderId}`, { method: "PATCH", cookie: buyer, body: { action: "complete" } })).body.order.status, "completed");

  const stats = await call("/api/admin/stats", { cookie: adminCookie });
  assert.equal(stats.body.listings.sold, 1);
  assert.equal(stats.body.orders.completed, 1);
});

test("đổi mật khẩu làm phiên đăng nhập cũ hết hiệu lực", async () => {
  const cookie = await login("user1", "pass1");
  assert.equal((await call("/api/auth/me", { cookie })).body.user.username, "user1");

  // Giả lập phiên ký với mật khẩu khác (như sau khi admin đổi mật khẩu trong AUTH_USERS)
  const [payload] = decodeURIComponent(cookie.split("=")[1]).split(".");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString());
  const crypto = await import("node:crypto");
  const forged = Buffer.from(JSON.stringify({ ...data, v: "old-password-ver" })).toString("base64url");
  const signature = crypto.createHmac("sha256", "test-secret").update(forged).digest("base64url");
  const stale = `reloop_session=${forged}.${signature}`;
  assert.equal((await call("/api/auth/me", { cookie: stale })).body.user, null);
});

test("định giá kiểm tra ảnh trước khi gọi AI, API lạ trả JSON 404", async () => {
  const bad = await call("/api/valuate", { method: "POST", body: { images: [] } });
  assert.ok([400, 503].includes(bad.status), `status ${bad.status}`);
  assert.equal(typeof bad.body.error, "string");
  assert.equal((await call("/api/khong-ton-tai")).status, 404);
});
