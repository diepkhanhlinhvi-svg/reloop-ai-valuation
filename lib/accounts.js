// Tài khoản do người dùng TỰ ĐĂNG KÝ, lưu trong bảng "accounts" của Postgres (Neon).
// Tài khoản khai báo sẵn trong AUTH_USERS (admin, tài khoản demo) vẫn dùng được như cũ;
// file này chỉ thêm loại tài khoản thứ hai để người mới tự tạo tài khoản và mua hàng.
//
// Mật khẩu KHÔNG lưu dạng chữ thường: chỉ lưu chuỗi băm scrypt kèm salt ngẫu nhiên.
// Tài khoản đăng ký luôn có vai trò "user" (không ai tự đăng ký thành admin được).
import crypto from "node:crypto";
import { promisify } from "node:util";
import { query } from "./db.js";
import { httpError } from "./http-error.js";

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

// Quy tắc dữ liệu đăng ký (giao diện hiện đúng các quy tắc này cho người dùng)
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._]{2,29}$/; // 3–30 ký tự: chữ thường không dấu, số, dấu chấm, gạch dưới
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;
const NAME_MIN = 2;
const NAME_MAX = 60;
// Tên dễ gây nhầm với tài khoản hệ thống: không cho đăng ký
const RESERVED = new Set(["admin", "administrator", "root", "system", "reloop", "support", "hotro", "quantri", "moderator", "mod"]);

// Tạo bảng ở lần dùng đầu tiên. Không cần sửa lib/schema.js.
let tableReady = null;
function ensureTable() {
  tableReady ||= query(`CREATE TABLE IF NOT EXISTS accounts (
      username TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`).catch((error) => {
    tableReady = null; // lần sau thử tạo lại
    throw error;
  });
  return tableReady;
}

export function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(String(password), salt, KEY_LENGTH);
  return `scrypt$${salt}$${key.toString("hex")}`;
}

async function verifyHash(password, stored) {
  const [scheme, salt, hex] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = await scrypt(String(password), salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Băm giả để thời gian trả lời khi sai tên đăng nhập giống khi sai mật khẩu
// (không lộ tên đăng nhập nào đã tồn tại)
let dummyHash = null;
async function burnTime(password) {
  dummyHash ||= await hashPassword(crypto.randomBytes(16).toString("hex"));
  await verifyHash(password, dummyHash);
}

// Đổi bản ghi database thành đúng dạng "user" mà auth.js đang dùng.
// Trường password chứa chuỗi băm: auth.js dùng nó để ký phiên, nên đổi mật khẩu
// thì phiên cũ tự hết hiệu lực giống tài khoản trong AUTH_USERS.
function toUser(row) {
  return row ? { username: row.username, name: row.name, role: "user", password: row.password_hash, registered: true } : null;
}

// Kiểm tra dữ liệu đăng ký, trả về thông báo lỗi tiếng Việt cụ thể
export function validateRegistration({ username, name, password }) {
  const u = normalizeUsername(username);
  const n = String(name || "").trim().replace(/\s+/g, " ");
  const p = String(password || "");
  if (!USERNAME_PATTERN.test(u)) {
    return "Tên đăng nhập dài 3–30 ký tự, chỉ gồm chữ thường không dấu, số, dấu chấm hoặc gạch dưới, và bắt đầu bằng chữ hoặc số.";
  }
  if (RESERVED.has(u)) return "Tên đăng nhập này đã được hệ thống dành riêng. Vui lòng chọn tên khác.";
  if (n.length < NAME_MIN || n.length > NAME_MAX) return `Họ tên cần dài từ ${NAME_MIN} đến ${NAME_MAX} ký tự.`;
  if (p.length < PASSWORD_MIN_LENGTH) return `Mật khẩu cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự.`;
  if (p.length > PASSWORD_MAX_LENGTH) return `Mật khẩu tối đa ${PASSWORD_MAX_LENGTH} ký tự.`;
  if (p.toLowerCase() === u) return "Mật khẩu không được trùng với tên đăng nhập.";
  return null;
}

// Tạo tài khoản mới. Ném httpError 400 (dữ liệu sai) hoặc 409 (trùng tên).
export async function createAccount({ username, name, password }) {
  const problem = validateRegistration({ username, name, password });
  if (problem) throw httpError(400, problem);
  await ensureTable();
  const u = normalizeUsername(username);
  const n = String(name).trim().replace(/\s+/g, " ");
  const hash = await hashPassword(password);
  // ON CONFLICT DO NOTHING: hai người bấm đăng ký cùng tên cùng lúc thì chỉ một người được
  const rows = await query(
    `INSERT INTO accounts (username, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (username) DO NOTHING
     RETURNING username, name, password_hash`,
    [u, n, hash]
  );
  if (!rows.length) throw httpError(409, "Tên đăng nhập đã có người dùng. Vui lòng chọn tên khác.");
  return toUser(rows[0]);
}

export async function findAccount(username) {
  const u = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(u)) return null;
  await ensureTable();
  const [row] = await query(`SELECT username, name, password_hash FROM accounts WHERE username = $1`, [u]);
  return toUser(row);
}

// Trả về user nếu đúng mật khẩu, ngược lại null
export async function verifyAccount(username, password) {
  const user = await findAccount(username);
  if (!user) {
    await burnTime(password);
    return null;
  }
  return (await verifyHash(password, user.password)) ? user : null;
}
