// Ảnh tin đăng: ưu tiên lưu trên Vercel Blob (database chỉ giữ URL).
// [SỬA LỖI] Chưa cấu hình Blob (BLOB_READ_WRITE_TOKEN) thì lưu thẳng ảnh vào bảng listing_images của Postgres (Neon)
// và phục vụ qua /api/images/<id>.<đuôi>, thay vì báo lỗi 503 làm hỏng mọi tin đăng có ảnh.
import crypto from "node:crypto";
import { put, del } from "@vercel/blob";
import { query } from "./db.js";
import { httpError } from "./http-error.js";

export const MAX_LISTING_IMAGE_CHARS = 1.5 * 1024 * 1024;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const EXTENSIONS = { jpeg: "jpg", png: "png", webp: "webp" };
// [SỬA LỖI] Đường dẫn ảnh lưu trong database
const DB_IMAGE_PREFIX = "/api/images/";
const DB_IMAGE_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/;

let blobClient = { put, del };

export const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// Test thay Vercel Blob bằng client giả có cùng put()/del(); truyền null để thử chế độ lưu ảnh trong database
export function useBlobClient(client) {
  blobClient = client;
}

// [SỬA LỖI] Có dùng Blob không: client giả của test luôn dùng; client thật chỉ khi đã có token
function blobEnabled() {
  return Boolean(blobClient) && (blobClient.put !== put || blobConfigured);
}

// Kiểm tra trước khi ghi gì vào database, để ảnh hỏng không tạo ra tin đăng dở dang
export function parseImageDataUrl(value) {
  const text = String(value);
  if (text.length > MAX_LISTING_IMAGE_CHARS) throw httpError(413, "Ảnh sản phẩm quá lớn.");
  const match = DATA_URL.exec(text);
  if (!match) throw httpError(400, "Ảnh sản phẩm không hợp lệ.");
  return { format: match[1], buffer: Buffer.from(match[2], "base64") };
}

export async function uploadListingImage({ format, buffer }) {
  const id = crypto.randomUUID();
  if (!blobEnabled()) {
    // [SỬA LỖI] Chưa có Blob: lưu ảnh vào Postgres
    await query(
      `INSERT INTO listing_images (id, content_type, data) VALUES ($1, $2, $3)`,
      [id, `image/${format}`, buffer]
    );
    return `${DB_IMAGE_PREFIX}${id}.${EXTENSIONS[format]}`;
  }
  const result = await blobClient.put(`listings/${id}.${EXTENSIONS[format]}`, buffer, {
    access: "public",
    contentType: `image/${format}`,
    addRandomSuffix: false
  });
  return result.url;
}

// [SỬA LỖI] Đọc ảnh đã lưu trong database cho route GET /api/images/:file
export async function getDatabaseImage(file) {
  const match = DB_IMAGE_FILE.exec(String(file || ""));
  if (!match) return null;
  const [row] = await query(`SELECT content_type, data FROM listing_images WHERE id = $1`, [match[1]]);
  return row ? { contentType: row.content_type, data: Buffer.from(row.data) } : null;
}

function isBlobUrl(url) {
  try {
    return new URL(url).hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

// Xóa ảnh không được làm hỏng thao tác chính (tin đã gỡ khỏi database rồi)
export async function deleteListingImage(url) {
  try {
    // [SỬA LỖI] Ảnh lưu trong database
    const file = String(url || "").startsWith(DB_IMAGE_PREFIX) ? String(url).slice(DB_IMAGE_PREFIX.length) : null;
    const match = file && DB_IMAGE_FILE.exec(file);
    if (match) {
      await query(`DELETE FROM listing_images WHERE id = $1`, [match[1]]);
      return;
    }
    if (!isBlobUrl(url) || !blobClient) return;
    await blobClient.del(url);
  } catch (error) {
    console.error("Không xóa được ảnh:", error.message);
  }
}
