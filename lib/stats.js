// Thống kê sử dụng theo ngày (giờ Việt Nam), lưu trong bảng usage_stats.
import { waitUntil } from "@vercel/functions";
import { databaseAvailable, query } from "./db.js";

const TODAY_VN = `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;

// Thống kê không được làm hỏng hay làm chậm yêu cầu chính. waitUntil giữ cho Vercel Function
// chạy tiếp tới khi ghi xong, kể cả khi response đã được gửi đi.
export function trackStat(name) {
  if (!databaseAvailable()) return;
  const pending = query(
    `INSERT INTO usage_stats (day, name, count) VALUES (${TODAY_VN}, $1, 1)
     ON CONFLICT (day, name) DO UPDATE SET count = usage_stats.count + 1`,
    [name]
  ).catch((error) => console.error("Không ghi được thống kê:", error.message));
  waitUntil(pending);
}

export async function getStats() {
  const [total, today] = await Promise.all([
    query(`SELECT name, SUM(count)::bigint AS count FROM usage_stats GROUP BY name`),
    query(`SELECT name, count FROM usage_stats WHERE day = ${TODAY_VN}`)
  ]);
  const toObject = (rows) => Object.fromEntries(rows.map((r) => [r.name, Number(r.count) || 0]));
  return { total: toObject(total), today: toObject(today) };
}
