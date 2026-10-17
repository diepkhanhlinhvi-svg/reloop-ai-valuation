import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useTestDatabase, useFakeBlob, admin, alice, bob, carol, TINY_JPEG } from "./helpers.js";
import {
  listListings, createListing, deleteListing,
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

function approvedListing(owner = alice, overrides = {}) {
  return createListing(owner, { name: "Tai nghe Sony", price: 1_500_000, type: "both", ...overrides });
}

async function rejects(promise, status) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status, error.message);
    return true;
  });
}

test("tin hiện ngay trên chợ, ảnh được tải lên Blob và chỉ lưu URL", async () => {
  const listing = await createListing(alice, { name: "Nồi chiên", price: 900_000, image: TINY_JPEG });
  assert.equal(listing.availability, "available");
  assert.equal(listing.image, blob.uploaded[0]);

  assert.equal((await listListings(null)).length, 1, "khách thấy tin ngay, không cần chờ duyệt");
  assert.equal((await listListings(alice)).length, 1);
  assert.equal((await listListings(admin)).length, 1);
});

test("bấm đăng nhiều lần (kể cả song song) chỉ ra một tin và một ảnh", async () => {
  const body = { name: "Nồi chiên", price: 900_000, image: TINY_JPEG };
  const results = await Promise.all([createListing(alice, body), createListing(alice, body), createListing(alice, body)]);
  assert.equal(new Set(results.map((l) => l.id)).size, 1);
  assert.equal(results.filter((l) => l.duplicate).length, 2, "hai lần bấm thừa được báo là trùng");
  assert.equal((await listListings(admin)).length, 1);
  const kept = results.find((l) => !l.duplicate).image;
  assert.equal(blob.deleted.length, 2, "ảnh của hai lần đăng trùng bị xóa khỏi Blob");
  assert.ok(!blob.deleted.includes(kept), "ảnh của tin được giữ không bị xóa");

  await createListing(alice, { ...body, name: "Nồi chiên khác" });
  await createListing(bob, body);
  assert.equal((await listListings(admin)).length, 3, "tin khác hoặc người khác đăng vẫn tạo bình thường");
});

test("admin chỉ kiểm tra và gỡ tin, không đăng, mua hay trao đổi", async () => {
  const listing = await approvedListing(alice);
  await rejects(createListing(admin, { name: "X", price: 1000 }), 403);
  await rejects(placeOrder(admin, { items: [{ listingId: listing.id }], ...contact }), 403);
  await rejects(createOffer(admin, listing.id, { offeredItem: "Gì đó" }), 403);
  await rejects(updateOrder(admin, 1, "cancel"), 403);
  await rejects(updateOffer(admin, 1, "reject"), 403);

  assert.equal((await listListings(admin)).length, 1, "admin thấy mọi tin để kiểm tra");
  await deleteListing(admin, listing.id);
  assert.equal((await listListings(admin)).length, 0);
});

test("admin gỡ tin đang có đơn thì đơn bị hủy theo", async () => {
  const listing = await approvedListing(alice);
  const [order] = await placeOrder(bob, { items: [{ listingId: listing.id }], ...contact });
  await deleteListing(admin, listing.id);
  const [bobOrder] = (await listOrders(bob)).purchases;
  assert.equal(bobOrder.id, order.id);
  assert.equal(bobOrder.status, "cancelled");
  assert.equal(bobOrder.cancelledBy, admin.username);
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
  const tradeOnly = await approvedListing(bob, { type: "trade", price: 200_000 });
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

test("người mua và người bán chỉ thấy đơn của mình", async () => {
  const listing = await approvedListing();
  await placeOrder(bob, { items: [{ listingId: listing.id }], ...contact });

  assert.equal((await listOrders(bob)).purchases.length, 1);
  assert.equal((await listOrders(alice)).sales.length, 1);
  const outsider = await listOrders(carol);
  assert.equal(outsider.purchases.length + outsider.sales.length, 0);
  const adminView = await listOrders(admin);
  assert.equal(adminView.purchases.length + adminView.sales.length, 0, "admin không xem đơn của người dùng");
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

test("gỡ tin đã bị gỡ trả 404", async () => {
  const listing = await createListing(alice, { name: "Sách", price: 50_000 });
  await deleteListing(alice, listing.id);
  await rejects(deleteListing(admin, listing.id), 404);
  assert.equal((await listListings(admin)).length, 0);
});

const phone = (n) => ({ phone: `09012345${n}0` });

test("đổi ngang giá: hai bên đồng ý thì cả hai món đã đổi, đề nghị khác liên quan bị từ chối", async () => {
  const target = await approvedListing(alice, { name: "Máy ảnh", type: "trade", price: 1_000_000 });
  const bobItem = await approvedListing(bob, { name: "Loa JBL", type: "trade", price: 1_080_000 });
  const carolItem = await approvedListing(carol, { name: "Bàn phím cơ", type: "both", price: 950_000 });

  const fromBob = await createOffer(bob, target.id, { offeredListingId: bobItem.id, ...phone(1) });
  const fromCarol = await createOffer(carol, target.id, { offeredListingId: carolItem.id, ...phone(2) });
  assert.equal(fromBob.offeredPrice, 1_080_000);
  assert.equal(fromBob.proposerPhone, null, "chưa đồng ý thì chưa lộ số điện thoại");
  await rejects(createOffer(bob, target.id, { offeredListingId: bobItem.id, ...phone(1) }), 409); // trùng đề nghị đang chờ
  await rejects(createOffer(alice, target.id, { offeredListingId: target.id, ...phone(3) }), 400); // món của chính mình

  assert.equal((await listOffers(alice)).received.length, 2);
  await rejects(updateOffer(bob, fromBob.id, "accept", phone(1)), 403); // chỉ chủ món đồ được chấp nhận
  await rejects(updateOffer(alice, fromBob.id, "accept", { phone: "abc" }), 400); // phải để lại số điện thoại

  const accepted = await updateOffer(alice, fromBob.id, "accept", phone(4));
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.proposerPhone, "0901234510");
  assert.equal(accepted.ownerPhone, "0901234540");

  const mine = await listListings(alice);
  assert.equal(mine.find((l) => l.id === target.id).availability, "traded");
  assert.equal((await listListings(bob)).find((l) => l.id === bobItem.id).availability, "traded");
  assert.deepEqual((await listListings(null)).map((l) => l.name), ["Bàn phím cơ"], "chỉ món chưa đổi còn trên chợ");
  assert.equal((await listOffers(carol)).sent.find((o) => o.id === fromCarol.id).status, "rejected");
});

test("đổi đồ chỉ cho món của chính mình, đang rao, và chênh giá không quá 10%", async () => {
  const target = await approvedListing(alice, { type: "trade", price: 1_000_000 });
  const cheap = await approvedListing(bob, { name: "Rẻ", type: "trade", price: 800_000 });
  const justRight = await approvedListing(bob, { name: "Vừa", type: "trade", price: 900_000 });
  const sellOnly = await approvedListing(bob, { name: "Chỉ bán", type: "buy", price: 1_000_000 });
  const others = await approvedListing(carol, { name: "Của người khác", type: "trade", price: 1_000_000 });

  await rejects(createOffer(bob, target.id, { offeredListingId: cheap.id, ...phone(1) }), 400); // lệch 20%
  await rejects(createOffer(bob, target.id, { offeredListingId: sellOnly.id, ...phone(1) }), 400); // chỉ bán
  await rejects(createOffer(bob, target.id, { offeredListingId: others.id, ...phone(1) }), 400); // không phải của bob
  await rejects(createOffer(bob, target.id, { phone: "0901234567" }), 400); // chưa chọn món
  await rejects(createOffer(bob, target.id, { offeredListingId: justRight.id, phone: "1" }), 400);
  assert.equal((await createOffer(bob, target.id, { offeredListingId: justRight.id, ...phone(1) })).status, "pending");

  const buyOnly = await approvedListing(alice, { name: "Mua đứt", type: "buy", price: 900_000 });
  await rejects(createOffer(bob, buyOnly.id, { offeredListingId: justRight.id, ...phone(1) }), 400);
});

test("mỗi người chỉ có tối đa 30 tin đang hiển thị", async () => {
  for (let i = 0; i < 30; i++) await createListing(alice, { name: `Món ${i}`, price: 10_000 });
  await rejects(createListing(alice, { name: "Món thứ 31", price: 10_000 }), 429);
  await createListing(bob, { name: "Món của Bob", price: 10_000 });
});

test("người ngoài chấp nhận đề nghị nhận 404 trước khi bị kiểm tra số điện thoại", async () => {
  const target = await approvedListing(alice, { type: "both", price: 1_000_000 });
  const bobItem = await approvedListing(bob, { name: "Loa", type: "both", price: 1_000_000 });
  const offer = await createOffer(bob, target.id, { offeredListingId: bobItem.id, ...phone(1) });
  await rejects(updateOffer(carol, offer.id, "accept", { phone: "abc" }), 404);
});

test("không chấp nhận đổi khi một trong hai món đang có đơn mua", async () => {
  const target = await approvedListing(alice, { type: "both", price: 1_000_000 });
  const bobItem = await approvedListing(bob, { name: "Loa", type: "both", price: 1_000_000 });
  const offer = await createOffer(bob, target.id, { offeredListingId: bobItem.id, ...phone(1) });
  assert.equal((await listOffers(alice)).received[0].tradable, true);

  await placeOrder(carol, { items: [{ listingId: bobItem.id }], ...contact });
  assert.equal((await listOffers(alice)).received[0].tradable, false, "giao diện biết để ẩn nút chấp nhận");
  await rejects(updateOffer(alice, offer.id, "accept", phone(2)), 409);
  assert.equal((await updateOffer(bob, offer.id, "withdraw")).status, "withdrawn");
});

test("món đã bán xong thì các đề nghị đổi liên quan bị từ chối; gỡ món đem đi đổi thì đề nghị biến mất", async () => {
  const target = await approvedListing(alice, { type: "both", price: 1_000_000 });
  const bobItem = await approvedListing(bob, { name: "Loa", type: "both", price: 1_000_000 });
  const carolItem = await approvedListing(carol, { name: "Chuột", type: "both", price: 1_000_000 });
  const fromBob = await createOffer(bob, target.id, { offeredListingId: bobItem.id, ...phone(1) });
  await createOffer(carol, target.id, { offeredListingId: carolItem.id, ...phone(2) });

  await deleteListing(carol, carolItem.id);
  assert.equal((await listOffers(alice)).received.length, 1);

  const [order] = await placeOrder(carol, { items: [{ listingId: target.id }], ...contact });
  await updateOrder(alice, order.id, "confirm");
  await updateOrder(carol, order.id, "complete");
  assert.equal((await listOffers(bob)).sent.find((o) => o.id === fromBob.id).status, "rejected");
});

test("thống kê admin đếm tin, đơn và đề nghị", async () => {
  const listing = await approvedListing();
  await createListing(bob, { name: "Tin khác", price: 10_000 });
  await placeOrder(carol, { items: [{ listingId: listing.id }], ...contact });
  const summary = await marketplaceSummary();
  assert.equal(summary.listings.total, 2);
  assert.equal(summary.listings.available, 1);
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
