// Cấu trúc database. Chạy tự động (CREATE ... IF NOT EXISTS) ở lần truy vấn đầu tiên của mỗi instance.
// Thêm cột mới sau này: thêm câu "ALTER TABLE ... ADD COLUMN IF NOT EXISTS ..." vào CUỐI danh sách.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS listings (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('buy', 'trade', 'both')),
    category TEXT NOT NULL,
    price BIGINT NOT NULL DEFAULT 0 CHECK (price >= 0),
    original_price BIGINT NOT NULL DEFAULT 0 CHECK (original_price >= 0),
    discount TEXT NOT NULL DEFAULT '',
    desired_exchange TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    variants JSONB NOT NULL DEFAULT '[]',
    image_url TEXT NOT NULL,
    owner TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    -- status: kiểm duyệt của admin; availability: tình trạng mua bán của món đồ
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'reserved', 'sold', 'traded')),
    rating REAL NOT NULL DEFAULT 5.0,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS listings_market_idx ON listings (status, availability, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS listings_owner_idx ON listings (owner)`,

  // Mỗi đơn là một món đồ (đồ cũ chỉ có 1 cái). Giữ bản sao tên/giá/ảnh để đơn vẫn đọc được khi tin bị gỡ.
  `CREATE TABLE IF NOT EXISTS orders (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
    buyer TEXT NOT NULL,
    buyer_name TEXT NOT NULL,
    seller TEXT NOT NULL,
    seller_name TEXT NOT NULL,
    item_name TEXT NOT NULL,
    item_image TEXT NOT NULL,
    variant TEXT NOT NULL DEFAULT '',
    price BIGINT NOT NULL CHECK (price >= 0),
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
    cancelled_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS orders_buyer_idx ON orders (buyer, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS orders_seller_idx ON orders (seller, created_at DESC)`,
  // Chốt chặn cuối cùng chống bán trùng: một món chỉ có tối đa một đơn đang xử lý
  `CREATE UNIQUE INDEX IF NOT EXISTS orders_one_active_per_listing ON orders (listing_id)
    WHERE status IN ('pending', 'confirmed')`,

  `CREATE TABLE IF NOT EXISTS trade_offers (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    proposer TEXT NOT NULL,
    proposer_name TEXT NOT NULL,
    offered_item TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS trade_offers_owner_idx ON trade_offers (owner, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS trade_offers_proposer_idx ON trade_offers (proposer, created_at DESC)`,
  // Mỗi người chỉ có một đề nghị đang chờ cho cùng một món
  `CREATE UNIQUE INDEX IF NOT EXISTS trade_offers_one_pending ON trade_offers (listing_id, proposer)
    WHERE status = 'pending'`,

  // Thống kê theo ngày (giờ Việt Nam); tổng cộng = SUM theo name
  `CREATE TABLE IF NOT EXISTS usage_stats (
    day DATE NOT NULL,
    name TEXT NOT NULL,
    count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, name)
  )`,

  // Bộ đếm rate limit dùng chung cho mọi instance serverless
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    hits INTEGER NOT NULL,
    reset_at TIMESTAMPTZ NOT NULL
  )`
];
