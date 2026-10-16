// Ảnh tin đăng lưu trên Vercel Blob; database chỉ giữ URL nên danh sách tin luôn nhẹ.
import crypto from "node:crypto";
import { put, del } from "@vercel/blob";
import { httpError } from "./http-error.js";

export const MAX_LISTING_IMAGE_CHARS = 1.5 * 1024 * 1024;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const EXTENSIONS = { jpeg: "jpg", png: "png", webp: "webp" };

let blobClient = { put, del };

export const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// Test thay Vercel Blob bằng client giả có cùng put()/del()
export function useBlobClient(client) {
  blobClient = client;
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
  if (blobClient.put === put && !blobConfigured) {
    throw httpError(503, "Máy chủ chưa cấu hình nơi lưu ảnh. Cần BLOB_READ_WRITE_TOKEN (Vercel → Storage → Blob).");
  }
  const result = await blobClient.put(`listings/${crypto.randomUUID()}.${EXTENSIONS[format]}`, buffer, {
    access: "public",
    contentType: `image/${format}`,
    addRandomSuffix: false
  });
  return result.url;
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
  if (!isBlobUrl(url)) return;
  try {
    await blobClient.del(url);
  } catch (error) {
    console.error("Không xóa được ảnh trên Blob:", error.message);
  }
}
