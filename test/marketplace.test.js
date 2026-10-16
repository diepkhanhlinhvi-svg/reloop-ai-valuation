import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase, useFakeBlob, admin, alice, bob, carol, TINY_JPEG } from "./helpers.js";
import {
  listListings, createListing, moderateListing, deleteListing,
  placeOrder, listOrders, updateOrder,
  createOffer, listOffers, updateOffer, marketplaceSummary
} from "../lib/marketplace.js";
import { query } from "../lib/db.js";
import { PostgresRateLimitStore } from "../lib/rate-limit-store.js";

let blob;
beforeEach(async () => {
  await useTestDatabase();
  blob = useFakeBlob();
});

const contact = { phone: "0901 234 567", address: "12 Nguyễn Huệ, Quận 1" };

async function approvedListing(owner = alice, overrides = {}) {
  const listing = await createListing(owner, { name: "Tai nghe Sony", price: 1_500_000, type: "both", ...overrides });
  return owner.role === "admin" ? listing : moderateListing(admin, listing.id, "approved");
}

async function rejects(promise, status) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status, error.message);
    return true;
  });
}

test("tin của user chờ duyệt, ảnh được tải lên Blob và chỉ lưu URL", async () => {
  const listing = await createListing(alice, { name: "Nồi chiên", price: 900_000, image: TINY_JPEG });
  assert.equal(listing.status, "pending");
  assert.equal(listing.availability, "available");
  assert.equal(listing.image, blob.uploaded[0]);

  assert.equal((await listListings(null)).length, 0, "khách không thấy tin chờ duyệt");
  assert.equal((await listListings(alice)).length, 1, "chủ tin thấy tin của mình");
  assert.equal((await listListings(admin)).length, 1);
});

test("ảnh không hợp lệ bị từ chối trước khi ghi gì", async () => {
  await rejects(createListing(alice, { name: "X", price: 1000, image: "data:image/svg+xml;base64,AAAA" }), 400);
  assert.equal(blob.uploaded.length, 0);
  assert.equal((await listListings(admin)).length, 0);
});

test("đặt hàng giữ chỗ món đồ, người khác không mua trùng được", async () => {
  const listing = await approvedListing();
  const [order] = await placeOrder(bob, { items: [{ listingId: listing.id }], ...contact });
  assert.equal(order.status, "pending");
  assert.equal(order.price, 1_500_000, "giá lấy từ database");
  assert.equal(order.phone, "0901234567");

  assert.equal((await listListings(null)).length, 0, "món đã được giữ chỗ biến khỏi chợ");
  await assert.rejects(placeOrder(carol, { items: [{ listingId: listing.id }], ...contact }), (error) => {
    assert.equal(error.status, 409);
    assert.deepEqual(error.unavailable.map((u) => u.reason), ["unavailable"]);
    return true;
  });
});

test("đặt nhiều món: một món không còn thì không giữ chỗ món nào", async () => {
  const a = await approvedListing(alice, { name: "A" });
  const b = await approvedListing(alice, { name: "B" });
  await placeOrder(carol, { items: [{ listingId: b.id }], ...contact });

  await rejects(placeOrder(bob, { items: [{ listingId: a.id }, { listingId: b.id }], ...contact }), 409);
  const visible = await listListings(null);
  assert.deepEqual(visible.map((l) => l.name), ["A"], "món A vẫn còn bán");
});

test("không mua được tin của chính mình hoặc tin chỉ trao đổi", async () => {
  const own = await approvedListing(alice);
  const tradeOnly = await approvedListing(bob, { type: "trade", price: 0 });
  await assert.rejects(placeOrder(alice, { items: [{ listingId: own.id }, { listingId: tradeOnly.id }], ...contact }),
    (error) => {
      assert.deepEqual(error.unavailable.map((u) => u.reason).sort(), ["own_listing", "trade_only"]);
      return true;
    });
});

test("kiểm tra số điện thoại và địa chỉ", async () => {
  const listing = await approvedListing();
  await rejects(placeOrder(bob, { items: [{ listingId: listing.id }], phone: "123", address: "12 Nguyễn Huệ" }), 400);
  await rejects(placeOrder(bob, { items: [{ listingId: listing.id }], phone: "0901234567", address: "" }), 400);
});

test("quy trình escrow: xác nhận -> nhận hàng -> món đồ đã bán", async () => {
  const listing = await approvedListing();
  const [order] = await placeOrder(bob, { items: [{ listingId: listing.id }], ...contact });

  await rejects(updateOrder(bob, order.id, "confirm"), 403); // người mua không tự xác nhận thay người bán
  await rejects(updateOrder(bob, order.id, "complete"), 409); // chưa giao thì chưa nhận được
  await rejects(updateOrder(carol, order.id, "cancel"), 404); // người ngoài không thấy đơn

  assert.equal((await updateOrder(alice, order.id, "confirm")).status, "confirmed");
  assert.equal((await updateOrder(bob, order.id, "complete")).status, "completed");

  const [sold] = await listListings(alice);
  assert.equal(sold.availability, "sold");
  assert.equal(sold.sold, 1);
  await rejects(updateOrder(alice, order.id, "cancel"), 409); // đã hoàn tất thì không hủy được
});

test("hủy đơn trả món đồ về chợ và cho phép người khác mua", async () => {
  const listing = await approvedListing();
  const [order] = await placeOrder(bob, { items: [{ listingId: listing.id }], ...contact });
  const cancelled = await updateOrder(alice, order.id, "cancel");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelledBy, alice.username);

  assert.equal((await listListings(null))[0].availability, "available");
  const [again] = await placeOrder(carol, { items: [{ listingId: listing.id }], ...contact });
  assert.equal(again.buyer, carol.username);
});

test("người mua và người bán thấy đơn của mình, admin xem được tất cả", async () => {
  const listing = await approvedListing();
  await placeOrder(bob, { items: [{ listingId: listing.id }], ...contact });

  assert.equal((await listOrders(bob)).purchases.length, 1);
  assert.equal((await listOrders(alice)).sales.length, 1);
  const outsider = await listOrders(carol);
  assert.equal(outsider.purchases.length + outsider.sales.length, 0);
  assert.equal((await listOrders(admin, { all: true })).all.length, 1);
  assert.equal((await listOrders(bob, { all: true })).all, undefined, "user thường không lấy được mọi đơn");
});

test("không gỡ được tin đang có đơn; gỡ tin xong thì xóa ảnh trên Blob", async () => {
  const listing = await approvedListing(alice, { image: TINY_JPEG });
  const [order] = await placeOrder(bob, { items: [{ listingId: listing.id }], ...contact });
  await rejects(deleteListing(alice, listing.id), 409);
  await rejects(deleteListing(bob, listing.id), 403);

  await updateOrder(bob, order.id, "cancel");
  await deleteListing(alice, listing.id);
  assert.deepEqual(blob.deleted, [listing.image]);
  assert.equal((await listOrders(bob)).purchases[0].listingId, null, "đơn cũ vẫn còn, chỉ mất liên kết");
});

test("duyệt tin đã bị gỡ trả 404 thay vì làm tin sống lại", async () => {
  const listing = await createListing(alice, { name: "Sách", price: 50_000 });
  await deleteListing(alice, listing.id);
  await rejects(moderateListing(admin, listing.id, "approved"), 404);
  assert.equal((await listListings(admin)).length, 0);
});

test("đề nghị trao đổi: chấp nhận một đề nghị thì món đồ đã đổi, các đề nghị khác bị từ chối", async () => {
  const listing = await approvedListing(alice, { type: "trade", price: 0 });
  const fromBob = await createOffer(bob, listing.id, { offeredItem: "Loa JBL Go 3" });
  const fromCarol = await createOffer(carol, listing.id, { offeredItem: "Bàn phím cơ" });
  await rejects(createOffer(bob, listing.id, { offeredItem: "Chuột" }), 409); // đã có đề nghị đang chờ
  await rejects(createOffer(alice, listing.id, { offeredItem: "Gì đó" }), 400); // món của chính mình

  assert.equal((await listOffers(alice)).received.length, 2);
  await rejects(updateOffer(bob, fromBob.id, "accept"), 403); // chỉ chủ món đồ được chấp nhận

  const accepted = await updateOffer(alice, fromBob.id, "accept");
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.listingName, "Tai nghe Sony");
  const sent = (await listOffers(carol)).sent;
  assert.equal(sent.find((o) => o.id === fromCarol.id).status, "rejected");
  assert.equal((await listListings(alice))[0].availability, "traded");
  assert.equal((await listListings(null)).length, 0);
});

test("không chấp nhận đổi khi món đồ đang có đơn mua", async () => {
  const listing = await approvedListing(alice, { type: "both" });
  const offer = await createOffer(carol, listing.id, { offeredItem: "Máy ảnh" });
  await placeOrder(bob, { items: [{ listingId: listing.id }], ...contact });
  await rejects(updateOffer(alice, offer.id, "accept"), 409);
  assert.equal((await updateOffer(carol, offer.id, "withdraw")).status, "withdrawn");
});

test("thống kê admin đếm tin, đơn và đề nghị", async () => {
  const listing = await approvedListing();
  await createListing(bob, { name: "Chờ duyệt", price: 10_000 });
  await placeOrder(carol, { items: [{ listingId: listing.id }], ...contact });
  const summary = await marketplaceSummary();
  assert.equal(summary.listings.total, 2);
  assert.equal(summary.listings.pending, 1);
  assert.equal(summary.listings.reserved, 1);
  assert.equal(summary.orders.pending, 1);
});

test("rate limit đếm chung trong database và reset khi hết cửa sổ", async () => {
  const store = new PostgresRateLimitStore("login");
  store.init({ windowMs: 60_000 });
  assert.equal((await store.increment("1.2.3.4")).totalHits, 1);
  assert.equal((await store.increment("1.2.3.4")).totalHits, 2);
  assert.equal((await store.increment("5.6.7.8")).totalHits, 1);

  await query(`UPDATE rate_limits SET reset_at = now() - interval '1 second' WHERE key = 'login:1.2.3.4'`);
  assert.equal((await store.increment("1.2.3.4")).totalHits, 1, "cửa sổ đã hết hạn thì đếm lại từ đầu");
});
