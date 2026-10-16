// Nghiệp vụ chợ: tin đăng, đơn hàng (escrow) và đề nghị trao đổi. Mọi thay đổi trạng thái món đồ
// chạy trong transaction có khóa dòng, nên hai người không thể mua/đổi cùng một món.
import { query, transaction } from "./db.js";
import { httpError } from "./http-error.js";
import { deleteListingImage, parseImageDataUrl, uploadListingImage } from "./images.js";
import { trackStat } from "./stats.js";

const LISTING_TYPES = new Set(["buy", "trade", "both"]);
const LISTING_CATEGORIES = new Set(["dien-tu", "thoi-trang", "gia-dung", "my-pham"]);
const LISTING_STATUSES = new Set(["pending", "approved", "rejected"]);
const DEFAULT_LISTING_IMAGE = "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500&auto=format&fit=crop&q=60";
const MAX_LISTINGS = 500;
const MAX_ORDER_ITEMS = 20;
const MAX_ROWS = 200;

// ---------- Chuyển dòng database sang JSON trả cho frontend ----------
function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

export function toListing(row) {
  return {
    id: Number(row.id),
    name: row.name,
    type: row.type,
    category: row.category,
    price: Number(row.price),
    originalPrice: Number(row.original_price),
    discount: row.discount,
    desiredExchange: row.desired_exchange,
    description: row.description,
    location: row.location,
    variants: Array.isArray(row.variants) ? row.variants : [],
    image: row.image_url,
    owner: row.owner,
    ownerName: row.owner_name,
    status: row.status,
    availability: row.availability,
    rating: Number(row.rating),
    sold: row.availability === "sold" ? 1 : 0,
    reviewedBy: row.reviewed_by,
    reviewedAt: iso(row.reviewed_at),
    createdAt: iso(row.created_at)
  };
}

function toOrder(row) {
  return {
    id: Number(row.id),
    listingId: row.listing_id === null ? null : Number(row.listing_id),
    buyer: row.buyer,
    buyerName: row.buyer_name,
    seller: row.seller,
    sellerName: row.seller_name,
    itemName: row.item_name,
    itemImage: row.item_image,
    variant: row.variant,
    price: Number(row.price),
    phone: row.phone,
    address: row.address,
    note: row.note,
    status: row.status,
    cancelledBy: row.cancelled_by,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function toOffer(row) {
  return {
    id: Number(row.id),
    listingId: Number(row.listing_id),
    listingName: row.listing_name,
    listingImage: row.listing_image,
    owner: row.owner,
    proposer: row.proposer,
    proposerName: row.proposer_name,
    offeredItem: row.offered_item,
    message: row.message,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

// ---------- Kiểm tra dữ liệu đầu vào ----------
function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanMoney(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, 10_000_000_000) : 0;
}

// Id lạ (chữ, số âm, quá lớn) coi như không tồn tại, không để lọt xuống database thành lỗi 500
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

function isAdmin(user) {
  return user?.role === "admin";
}

function validateListing(body) {
  const name = cleanText(body?.name, 150);
  if (!name) throw httpError(400, "Vui lòng nhập tên sản phẩm.");

  const type = LISTING_TYPES.has(body?.type) ? body.type : "buy";
  const category = LISTING_CATEGORIES.has(body?.category) ? body.category : "dien-tu";
  const price = cleanMoney(body?.price);
  if (type !== "trade" && price <= 0) throw httpError(400, "Vui lòng nhập giá bán hợp lệ.");

  const variants = (Array.isArray(body?.variants) ? body.variants : [])
    .map((v) => cleanText(v, 60)).filter(Boolean).slice(0, 10);

  return {
    name,
    type,
    category,
    price,
    originalPrice: Math.max(price, cleanMoney(body?.originalPrice)),
    discount: cleanText(body?.discount, 30) || "Mới đăng",
    desiredExchange: type === "buy" ? "" : cleanText(body?.desiredExchange, 200),
    description: cleanText(body?.description, 2000) || "Sản phẩm người dùng tự đăng.",
    location: cleanText(body?.location, 80) || "TP. Hồ Chí Minh",
    variants: variants.length ? variants : ["Mặc định"],
    image: body?.image ? parseImageDataUrl(body.image) : null
  };
}

function validateContact(body) {
  const phone = String(body?.phone ?? "").replace(/[\s.\-()]/g, "");
  if (!/^(\+?84|0)\d{9,10}$/.test(phone)) throw httpError(400, "Số điện thoại không hợp lệ.");
  const address = cleanText(body?.address, 300);
  if (address.length < 5) throw httpError(400, "Vui lòng nhập địa chỉ nhận hàng.");
  return { phone, address, note: cleanText(body?.note, 500) };
}

// ---------- Tin đăng ----------
// Ai cũng thấy tin đã duyệt và còn bán; chủ tin thấy mọi tin của mình; admin thấy tất cả.
export async function listListings(user) {
  const rows = isAdmin(user)
    ? await query(`SELECT * FROM listings ORDER BY created_at DESC LIMIT $1`, [MAX_LISTINGS])
    : await query(
      `SELECT * FROM listings
       WHERE (status = 'approved' AND availability = 'available') OR owner = $1
       ORDER BY created_at DESC LIMIT $2`,
      [user?.username ?? null, MAX_LISTINGS]
    );
  return rows.map(toListing);
}

export async function createListing(user, body) {
  const listing = validateListing(body);
  const imageUrl = listing.image ? await uploadListingImage(listing.image) : DEFAULT_LISTING_IMAGE;
  try {
    const [row] = await query(
      `INSERT INTO listings (name, type, category, price, original_price, discount, desired_exchange,
         description, location, variants, image_url, owner, owner_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
       RETURNING *`,
      [listing.name, listing.type, listing.category, listing.price, listing.originalPrice, listing.discount,
        listing.desiredExchange, listing.description, listing.location, JSON.stringify(listing.variants),
        imageUrl, user.username, user.name, isAdmin(user) ? "approved" : "pending"]
    );
    trackStat("listings_created");
    return toListing(row);
  } catch (error) {
    // Không để lại ảnh mồ côi trên Blob khi lưu tin thất bại
    if (listing.image) await deleteListingImage(imageUrl);
    throw error;
  }
}

// Một câu UPDATE duy nhất: tin bị gỡ giữa chừng thì không có dòng nào để sửa, không "sống lại"
export async function moderateListing(admin, id, status) {
  if (!LISTING_STATUSES.has(status)) throw httpError(400, "Trạng thái không hợp lệ.");
  const listingId = parseId(id);
  const [row] = listingId ? await query(
    `UPDATE listings SET status = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [listingId, status, admin.username]
  ) : [];
  if (!row) throw httpError(404, "Tin đăng không tồn tại hoặc đã bị gỡ.");
  return toListing(row);
}

export async function deleteListing(user, id) {
  const listingId = parseId(id);
  const imageUrl = await transaction(async (tx) => {
    const [row] = listingId ? await tx.query(`SELECT * FROM listings WHERE id = $1 FOR UPDATE`, [listingId]) : [];
    if (!row) throw httpError(404, "Tin đăng không tồn tại hoặc đã bị gỡ.");
    if (!isAdmin(user) && row.owner !== user.username) throw httpError(403, "Bạn không có quyền gỡ tin này.");
    if (row.availability === "reserved") {
      throw httpError(409, "Món này đang có đơn hàng chờ xử lý. Hãy hoàn tất hoặc hủy đơn trước khi gỡ tin.");
    }
    await tx.query(`DELETE FROM listings WHERE id = $1`, [listingId]);
    return row.image_url;
  });
  await deleteListingImage(imageUrl);
}

// ---------- Đơn hàng ----------
// Đặt nhiều món một lần: hoặc giữ chỗ được tất cả, hoặc không món nào (rollback), kèm danh sách món không còn bán.
export async function placeOrder(user, body) {
  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (rawItems.length < 1 || rawItems.length > MAX_ORDER_ITEMS) {
    throw httpError(400, `Mỗi lần đặt từ 1 đến ${MAX_ORDER_ITEMS} sản phẩm.`);
  }
  const items = new Map();
  for (const item of rawItems) {
    const listingId = parseId(item?.listingId);
    if (!listingId) throw httpError(400, "Sản phẩm trong giỏ không hợp lệ.");
    items.set(listingId, cleanText(item?.variant, 60));
  }
  const contact = validateContact(body);
  const ids = [...items.keys()];

  const orders = await transaction(async (tx) => {
    // Khóa theo thứ tự id để hai đơn đặt chéo nhau không bị deadlock
    const rows = await tx.query(`SELECT * FROM listings WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE`, [ids]);
    const byId = new Map(rows.map((row) => [Number(row.id), row]));

    const unavailable = [];
    for (const id of ids) {
      const row = byId.get(id);
      let reason = null;
      if (!row || row.status !== "approved") reason = "not_found";
      else if (row.owner === user.username) reason = "own_listing";
      else if (row.type === "trade") reason = "trade_only";
      else if (row.availability !== "available") reason = "unavailable";
      if (reason) unavailable.push({ id, name: row?.name ?? null, reason });
    }
    if (unavailable.length) {
      throw httpError(409, "Một số sản phẩm trong giỏ không còn mua được.", { unavailable });
    }

    await tx.query(`UPDATE listings SET availability = 'reserved', updated_at = now() WHERE id = ANY($1::int[])`, [ids]);
    const created = [];
    for (const id of ids) {
      const row = byId.get(id);
      const variants = Array.isArray(row.variants) ? row.variants : [];
      const variant = variants.includes(items.get(id)) ? items.get(id) : (variants[0] ?? "");
      // Giá lấy từ database, không tin giá do trình duyệt gửi lên
      const [order] = await tx.query(
        `INSERT INTO orders (listing_id, buyer, buyer_name, seller, seller_name, item_name, item_image,
           variant, price, phone, address, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [id, user.username, user.name, row.owner, row.owner_name, row.name, row.image_url,
          variant, row.price, contact.phone, contact.address, contact.note]
      );
      created.push(toOrder(order));
    }
    return created;
  });
  trackStat("orders_created");
  return orders;
}

// Người mua chỉ thấy SĐT/địa chỉ của chính mình; người bán cần chúng để giao hàng
export async function listOrders(user, { all = false } = {}) {
  const [purchases, sales, everything] = await Promise.all([
    query(`SELECT * FROM orders WHERE buyer = $1 ORDER BY created_at DESC LIMIT $2`, [user.username, MAX_ROWS]),
    query(`SELECT * FROM orders WHERE seller = $1 ORDER BY created_at DESC LIMIT $2`, [user.username, MAX_ROWS]),
    all && isAdmin(user)
      ? query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT $1`, [MAX_ROWS])
      : Promise.resolve(null)
  ]);
  return {
    purchases: purchases.map(toOrder),
    sales: sales.map(toOrder),
    ...(everything ? { all: everything.map(toOrder) } : {})
  };
}

const ORDER_ACTIONS = {
  // Người bán xác nhận sẽ giao hàng
  confirm: { from: ["pending"], to: "confirmed", allowed: (o, u) => o.seller === u.username },
  // Người mua xác nhận đã nhận hàng: tiền escrow được giải ngân, món đồ chuyển sang "đã bán"
  complete: { from: ["confirmed"], to: "completed", allowed: (o, u) => o.buyer === u.username },
  // Bên nào cũng hủy được trước khi người mua xác nhận nhận hàng; món đồ quay lại chợ
  cancel: { from: ["pending", "confirmed"], to: "cancelled", allowed: (o, u) => o.buyer === u.username || o.seller === u.username }
};

const ORDER_STATUS_LABELS = {
  pending: "chờ người bán xác nhận",
  confirmed: "đang giao",
  completed: "đã hoàn tất",
  cancelled: "đã hủy"
};

export async function updateOrder(user, id, actionName) {
  const action = ORDER_ACTIONS[actionName];
  if (!action) throw httpError(400, "Thao tác không hợp lệ.");
  const orderId = parseId(id);

  const order = await transaction(async (tx) => {
    const [row] = orderId ? await tx.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]) : [];
    const party = row && (row.buyer === user.username || row.seller === user.username);
    // Không phải người trong đơn thì báo "không tồn tại" để không lộ đơn của người khác
    if (!row || (!party && !isAdmin(user))) throw httpError(404, "Đơn hàng không tồn tại.");
    if (!isAdmin(user) && !action.allowed(row, user)) throw httpError(403, "Bạn không có quyền thực hiện thao tác này.");
    if (!action.from.includes(row.status)) {
      throw httpError(409, `Đơn hàng đang ${ORDER_STATUS_LABELS[row.status]}, không thể thực hiện thao tác này.`);
    }

    const [updated] = await tx.query(
      `UPDATE orders SET status = $2, cancelled_by = $3, updated_at = now() WHERE id = $1 RETURNING *`,
      [orderId, action.to, action.to === "cancelled" ? user.username : null]
    );

    if (row.listing_id !== null && action.to === "completed") {
      await tx.query(`UPDATE listings SET availability = 'sold', updated_at = now() WHERE id = $1`, [row.listing_id]);
      await tx.query(
        `UPDATE trade_offers SET status = 'rejected', updated_at = now() WHERE listing_id = $1 AND status = 'pending'`,
        [row.listing_id]
      );
    }
    if (row.listing_id !== null && action.to === "cancelled") {
      await tx.query(
        `UPDATE listings SET availability = 'available', updated_at = now() WHERE id = $1 AND availability = 'reserved'`,
        [row.listing_id]
      );
    }
    return updated;
  });
  trackStat(`orders_${action.to}`);
  return toOrder(order);
}

// ---------- Đề nghị trao đổi ----------
export async function createOffer(user, listingIdValue, body) {
  const listingId = parseId(listingIdValue);
  const offeredItem = cleanText(body?.offeredItem, 150);
  if (offeredItem.length < 2) throw httpError(400, "Vui lòng nhập món đồ bạn muốn mang ra đổi.");
  const message = cleanText(body?.message, 500);

  const [listing] = listingId ? await query(`SELECT * FROM listings WHERE id = $1`, [listingId]) : [];
  if (!listing || listing.status !== "approved") throw httpError(404, "Tin đăng không tồn tại hoặc đã bị gỡ.");
  if (listing.owner === user.username) throw httpError(400, "Không thể gửi đề nghị đổi cho món đồ của chính bạn.");
  if (listing.type === "buy") throw httpError(400, "Món đồ này chỉ bán, không nhận trao đổi.");
  if (listing.availability !== "available") throw httpError(409, "Món đồ này không còn nhận trao đổi.");

  try {
    const [row] = await query(
      `INSERT INTO trade_offers (listing_id, owner, proposer, proposer_name, offered_item, message)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [listingId, listing.owner, user.username, user.name, offeredItem, message]
    );
    trackStat("offers_created");
    return toOffer({ ...row, listing_name: listing.name, listing_image: listing.image_url });
  } catch (error) {
    if (error.code === "23505") throw httpError(409, "Bạn đã có một đề nghị đang chờ cho món đồ này.");
    throw error;
  }
}

const OFFER_SELECT = `SELECT o.*, l.name AS listing_name, l.image_url AS listing_image
  FROM trade_offers o JOIN listings l ON l.id = o.listing_id`;

export async function listOffers(user) {
  const [received, sent] = await Promise.all([
    query(`${OFFER_SELECT} WHERE o.owner = $1 ORDER BY o.created_at DESC LIMIT $2`, [user.username, MAX_ROWS]),
    query(`${OFFER_SELECT} WHERE o.proposer = $1 ORDER BY o.created_at DESC LIMIT $2`, [user.username, MAX_ROWS])
  ]);
  return { received: received.map(toOffer), sent: sent.map(toOffer) };
}

const OFFER_ACTIONS = {
  accept: { to: "accepted", allowed: (o, u) => o.owner === u.username },
  reject: { to: "rejected", allowed: (o, u) => o.owner === u.username },
  withdraw: { to: "withdrawn", allowed: (o, u) => o.proposer === u.username }
};

export async function updateOffer(user, id, actionName) {
  const action = OFFER_ACTIONS[actionName];
  if (!action) throw httpError(400, "Thao tác không hợp lệ.");
  const offerId = parseId(id);

  const offer = await transaction(async (tx) => {
    const [peek] = offerId ? await tx.query(`SELECT listing_id FROM trade_offers WHERE id = $1`, [offerId]) : [];
    if (!peek) throw httpError(404, "Đề nghị trao đổi không tồn tại.");
    // Chấp nhận: khóa món đồ TRƯỚC rồi mới khóa đề nghị (cùng thứ tự với mọi thao tác khác) để tránh deadlock
    const [listing] = action.to === "accepted"
      ? await tx.query(`SELECT * FROM listings WHERE id = $1 FOR UPDATE`, [peek.listing_id])
      : [null];
    const [row] = await tx.query(`SELECT * FROM trade_offers WHERE id = $1 FOR UPDATE`, [offerId]);
    const party = row && (row.owner === user.username || row.proposer === user.username);
    if (!row || (!party && !isAdmin(user))) throw httpError(404, "Đề nghị trao đổi không tồn tại.");
    if (!isAdmin(user) && !action.allowed(row, user)) throw httpError(403, "Bạn không có quyền thực hiện thao tác này.");
    if (row.status !== "pending") throw httpError(409, "Đề nghị này đã được xử lý.");

    if (action.to === "accepted") {
      if (listing.availability !== "available") {
        throw httpError(409, "Món đồ đang có đơn mua hoặc đã được bán/đổi, không thể chấp nhận đề nghị.");
      }
      await tx.query(`UPDATE listings SET availability = 'traded', updated_at = now() WHERE id = $1`, [row.listing_id]);
      await tx.query(
        `UPDATE trade_offers SET status = 'rejected', updated_at = now()
         WHERE listing_id = $1 AND status = 'pending' AND id <> $2`,
        [row.listing_id, offerId]
      );
    }
    const [updated] = await tx.query(
      `UPDATE trade_offers SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [offerId, action.to]
    );
    const [names] = await tx.query(`SELECT name, image_url FROM listings WHERE id = $1`, [row.listing_id]);
    return { ...updated, listing_name: names?.name, listing_image: names?.image_url };
  });
  trackStat(`offers_${action.to}`);
  return toOffer(offer);
}

// ---------- Thống kê cho admin ----------
export async function marketplaceSummary() {
  const [listingRows, orderRows, offerRows] = await Promise.all([
    query(`SELECT status, availability, COUNT(*)::int AS count FROM listings GROUP BY status, availability`),
    query(`SELECT status, COUNT(*)::int AS count FROM orders GROUP BY status`),
    query(`SELECT status, COUNT(*)::int AS count FROM trade_offers GROUP BY status`)
  ]);
  const listings = { total: 0, pending: 0, approved: 0, rejected: 0, available: 0, reserved: 0, sold: 0, traded: 0 };
  for (const row of listingRows) {
    listings.total += row.count;
    listings[row.status] += row.count;
    listings[row.availability] += row.count;
  }
  const countBy = (rows) => Object.fromEntries(rows.map((r) => [r.status, r.count]));
  return { listings, orders: countBy(orderRows), offers: countBy(offerRows) };
}
