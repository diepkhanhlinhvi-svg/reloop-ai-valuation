// Kết nối Postgres (Neon trên Vercel). Mọi truy vấn đi qua query()/transaction() ở đây.
// Test thay kết nối bằng useDatabase() với một adapter cùng giao diện { query, transaction }.
import { Pool } from "@neondatabase/serverless";
import { attachDatabasePool } from "@vercel/functions";
import { httpError } from "./http-error.js";
import { SCHEMA } from "./schema.js";

// Vercel Storage → Neon tạo sẵn DATABASE_URL (và POSTGRES_URL cho tương thích cũ)
const CONNECTION_STRING = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
// Khóa để các instance khởi động cùng lúc không tạo bảng chồng lên nhau
const SCHEMA_LOCK_ID = 74_210_001;

let adapter = null;
let schemaReady = null;

export const databaseConfigured = Boolean(CONNECTION_STRING);

function neonAdapter() {
  const pool = new Pool({ connectionString: CONNECTION_STRING, max: 5 });
  // Trên Vercel Fluid: đóng kết nối rảnh trước khi instance bị tạm dừng
  attachDatabasePool(pool);
  pool.on("error", (error) => console.error("Postgres pool error:", error.message));

  return {
    async query(text, params = []) {
      return (await pool.query(text, params)).rows;
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: async (text, params = []) => (await client.query(text, params)).rows });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

function getAdapter() {
  if (!adapter && databaseConfigured) adapter = neonAdapter();
  if (!adapter) {
    throw httpError(503, "Máy chủ chưa kết nối database. Cần cấu hình DATABASE_URL (Vercel → Storage → Neon).");
  }
  return adapter;
}

export function databaseAvailable() {
  return Boolean(adapter) || databaseConfigured;
}

export function useDatabase(custom) {
  adapter = custom;
  schemaReady = null;
}

async function ready() {
  const db = getAdapter();
  schemaReady ||= db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK_ID]);
    for (const statement of SCHEMA) await tx.query(statement);
  }).catch((error) => {
    schemaReady = null; // lần truy vấn sau thử tạo lại
    throw error;
  });
  await schemaReady;
  return db;
}

export async function query(text, params = []) {
  return (await ready()).query(text, params);
}

export async function transaction(fn) {
  return (await ready()).transaction(fn);
}
