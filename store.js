// Kho lưu tin đăng và thống kê sử dụng.
// - Có UPSTASH_REDIS_REST_URL/TOKEN (hoặc KV_REST_API_URL/TOKEN do Vercel Marketplace tạo) -> lưu trên Redis,
//   dùng được trên Vercel vì dữ liệu không mất khi function khởi động lại.
// - Chạy local không có Redis -> lưu vào file data/db.json.
// - Trên Vercel mà không có Redis -> chỉ lưu trong bộ nhớ, sẽ mất khi function khởi động lại.
import { promises as fs } from "node:fs";
import path from "node:path";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const LISTINGS_KEY = "reloop:listings";
const STATS_KEY_PREFIX = "reloop:stats:";
const DB_FILE = path.resolve("data", "db.json");

export const storeMode = REDIS_URL && REDIS_TOKEN ? "redis" : (process.env.VERCEL ? "memory" : "file");

// Ngày theo giờ Việt Nam, dạng YYYY-MM-DD
function today() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
}

async function redis(command) {
  const response = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(`Redis error: ${data.error || response.status}`);
  }
  return data.result;
}

function pairsToObject(flat) {
  const result = {};
  for (let i = 0; i + 1 < (flat || []).length; i += 2) result[flat[i]] = flat[i + 1];
  return result;
}

const redisBackend = {
  async listListings() {
    const values = Object.values(pairsToObject(await redis(["HGETALL", LISTINGS_KEY])));
    return values.map((value) => JSON.parse(value));
  },
  async getListing(id) {
    const value = await redis(["HGET", LISTINGS_KEY, String(id)]);
    return value ? JSON.parse(value) : null;
  },
  async saveListing(listing) {
    await redis(["HSET", LISTINGS_KEY, String(listing.id), JSON.stringify(listing)]);
  },
  async deleteListing(id) {
    await redis(["HDEL", LISTINGS_KEY, String(id)]);
  },
  async incrStat(name) {
    await Promise.all([
      redis(["HINCRBY", `${STATS_KEY_PREFIX}total`, name, 1]),
      redis(["HINCRBY", `${STATS_KEY_PREFIX}${today()}`, name, 1])
    ]);
  },
  async getStats() {
    const [total, day] = await Promise.all([
      redis(["HGETALL", `${STATS_KEY_PREFIX}total`]),
      redis(["HGETALL", `${STATS_KEY_PREFIX}${today()}`])
    ]);
    const toNumbers = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Number(v) || 0]));
    return { total: toNumbers(pairsToObject(total)), today: toNumbers(pairsToObject(day)) };
  }
};

// Bộ nhớ (kèm ghi ra file khi chạy local)
let db = null;
let writeQueue = Promise.resolve();

async function loadDb() {
  if (db) return db;
  db = { listings: {}, stats: {} };
  if (storeMode === "file") {
    try {
      const saved = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
      db = { listings: saved.listings || {}, stats: saved.stats || {} };
    } catch (error) {
      if (error.code !== "ENOENT") console.error("Không đọc được data/db.json:", error.message);
    }
  }
  return db;
}

function persist() {
  if (storeMode !== "file") return Promise.resolve();
  // Ghi tuần tự để hai yêu cầu đồng thời không ghi đè file của nhau
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
    await fs.writeFile(DB_FILE, JSON.stringify(db));
  }).catch((error) => console.error("Không ghi được data/db.json:", error.message));
  return writeQueue;
}

const localBackend = {
  async listListings() {
    return Object.values((await loadDb()).listings);
  },
  async getListing(id) {
    return (await loadDb()).listings[String(id)] || null;
  },
  async saveListing(listing) {
    (await loadDb()).listings[String(listing.id)] = listing;
    await persist();
  },
  async deleteListing(id) {
    delete (await loadDb()).listings[String(id)];
    await persist();
  },
  async incrStat(name) {
    const { stats } = await loadDb();
    for (const bucket of ["total", today()]) {
      stats[bucket] ||= {};
      stats[bucket][name] = (stats[bucket][name] || 0) + 1;
    }
    await persist();
  },
  async getStats() {
    const { stats } = await loadDb();
    return { total: { ...(stats.total || {}) }, today: { ...(stats[today()] || {}) } };
  }
};

export const store = storeMode === "redis" ? redisBackend : localBackend;

// Thống kê không được làm hỏng yêu cầu chính
export function trackStat(name) {
  store.incrStat(name).catch((error) => console.error("Không ghi được thống kê:", error.message));
}
