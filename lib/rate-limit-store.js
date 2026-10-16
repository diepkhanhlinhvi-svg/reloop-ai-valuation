// Store cho express-rate-limit lưu bộ đếm trong Postgres. Store mặc định nằm trong bộ nhớ của từng
// instance serverless nên trên Vercel mỗi instance đếm riêng và reset khi khởi động lại: gần như không chặn được gì.
import rateLimit from "express-rate-limit";
import { query } from "./db.js";

// Thỉnh thoảng dọn các bộ đếm đã hết hạn để bảng không phình mãi
const CLEANUP_PROBABILITY = 0.01;

export class PostgresRateLimitStore {
  localKeys = false;

  constructor(prefix) {
    this.prefix = `${prefix}:`;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const [row] = await query(
      `INSERT INTO rate_limits (key, hits, reset_at)
       VALUES ($1, 1, now() + $2 * interval '1 millisecond')
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
       RETURNING hits, reset_at`,
      [this.prefix + key, this.windowMs]
    );
    if (Math.random() < CLEANUP_PROBABILITY) {
      query(`DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day'`).catch(() => {});
    }
    return { totalHits: Number(row.hits), resetTime: new Date(row.reset_at) };
  }

  async decrement(key) {
    await query(`UPDATE rate_limits SET hits = GREATEST(hits - 1, 0) WHERE key = $1`, [this.prefix + key]);
  }

  async resetKey(key) {
    await query(`DELETE FROM rate_limits WHERE key = $1`, [this.prefix + key]);
  }
}

// Database lỗi thì cho yêu cầu đi qua (passOnStoreError) thay vì khóa cả trang
export function createLimiter(name, { windowMs = 15 * 60 * 1000, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    passOnStoreError: true,
    store: new PostgresRateLimitStore(name),
    message: { error: message }
  });
}
