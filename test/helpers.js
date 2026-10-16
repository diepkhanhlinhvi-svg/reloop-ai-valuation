// Postgres chạy trong bộ nhớ (PGlite) thay cho Neon khi test
import { PGlite } from "@electric-sql/pglite";
import { useDatabase } from "../lib/db.js";
import { useBlobClient } from "../lib/images.js";

export async function useTestDatabase() {
  const pg = new PGlite();
  await pg.waitReady;
  const wrap = (conn) => async (text, params = []) => (await conn.query(text, params)).rows;
  useDatabase({
    query: wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn({ query: wrap(tx) }))
  });
  return pg;
}

// Vercel Blob giả: ghi nhớ ảnh đã tải lên / đã xóa
export function useFakeBlob() {
  const blob = { uploaded: [], deleted: [] };
  useBlobClient({
    async put(pathname) {
      const url = `https://test.public.blob.vercel-storage.com/${pathname}`;
      blob.uploaded.push(url);
      return { url };
    },
    async del(url) {
      blob.deleted.push(url);
    }
  });
  return blob;
}

export const admin = { username: "admin", name: "Quản trị viên", role: "admin" };
export const alice = { username: "user1", name: "Người dùng 1", role: "user" };
export const bob = { username: "user2", name: "Người dùng 2", role: "user" };
export const carol = { username: "user3", name: "Người dùng 3", role: "user" };

// Ảnh JPEG 1x1 hợp lệ dạng data URL
export const TINY_JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
