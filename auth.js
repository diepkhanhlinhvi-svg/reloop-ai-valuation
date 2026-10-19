// Đăng nhập bằng 2 loại tài khoản:
//  1. Tài khoản khai báo sẵn trong biến môi trường AUTH_USERS (admin, tài khoản demo).
//  2. Tài khoản người dùng tự đăng ký, lưu trong database (lib/accounts.js, routes/signup.js).
// Phiên đăng nhập là cookie HttpOnly ký HMAC bằng AUTH_SECRET.
import crypto from "node:crypto";
import { findAccount } from "./lib/accounts.js";

const COOKIE_NAME = "reloop_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function loadUsers() {
  let raw;
  try {
    raw = JSON.parse(process.env.AUTH_USERS || "[]");
  } catch {
    console.warn("WARNING: AUTH_USERS không phải JSON hợp lệ. Sẽ không ai đăng nhập được");
    return new Map();
  }
  const users = new Map();
  for (const u of Array.isArray(raw) ? raw : []) {
    if (!u?.username || !u?.password) continue;
    const username = String(u.username).trim().toLowerCase();
    users.set(username, {
      username,
      password: String(u.password),
      role: u.role === "admin" ? "admin" : "user",
      name: String(u.name || username)
    });
  }
  return users;
}

const users = loadUsers();
if (!users.size) {
  console.warn("WARNING: AUTH_USERS chưa khai báo tài khoản nào. Chỉ đăng nhập được bằng tài khoản tự đăng ký");
}

let secret = process.env.AUTH_SECRET;
if (!secret) {
  // Khóa tạm: phiên đăng nhập sẽ mất khi server khởi động lại (trên Vercel có thể mất bất cứ lúc nào)
  console.warn("WARNING: AUTH_SECRET is missing. Sessions will reset on every restart");
  secret = crypto.randomBytes(32).toString("hex");
}

function sign(value) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a, b) {
  // So sánh băm để hai chuỗi luôn cùng độ dài và không lộ thông tin qua thời gian phản hồi
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function publicUser(user) {
  return user ? { username: user.username, name: user.name, role: user.role } : null;
}

export function listUsers() {
  return [...users.values()];
}

export function findUserByUsername(username) {
  return users.get(String(username || "").trim().toLowerCase()) || null;
}

export function findUserByCredentials(username, password) {
  const user = users.get(String(username || "").trim().toLowerCase());
  // Vẫn so sánh khi không có user để thời gian phản hồi không tiết lộ tên đăng nhập có tồn tại hay không
  const ok = safeEqual(password || "", user ? user.password : crypto.randomBytes(16).toString("hex"));
  return user && ok ? user : null;
}

// Dấu vân tay mật khẩu hiện tại: đổi mật khẩu trong AUTH_USERS thì mọi phiên cũ của tài khoản đó hết hiệu lực
function passwordVersion(user) {
  return sign(`pv:${user.username}:${user.password}`).slice(0, 16);
}

export function setSessionCookie(req, res, user) {
  const payload = Buffer.from(JSON.stringify({ u: user.username, v: passwordVersion(user), exp: Date.now() + SESSION_MAX_AGE_MS }))
    .toString("base64url");
  res.cookie(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    maxAge: SESSION_MAX_AGE_MS,
    path: "/"
  });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: req.secure, path: "/" });
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Gắn req.user nếu cookie phiên hợp lệ
export async function attachUser(req, _res, next) {
  req.user = null;
  const token = readCookie(req, COOKIE_NAME);
  const [payload, signature] = String(token || "").split(".");
  if (payload && signature && safeEqual(signature, sign(payload))) {
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (Number(data.exp) > Date.now()) {
        // Tài khoản AUTH_USERS trước, không có thì tìm tài khoản tự đăng ký trong database
        const user = users.get(data.u) || await findAccount(data.u);
        if (user && data.v === passwordVersion(user)) req.user = user;
      }
    } catch {
      // cookie hỏng hoặc database tạm lỗi -> coi như chưa đăng nhập
    }
  }
  next();
}

export function requireLogin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Vui lòng đăng nhập để tiếp tục." });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Chỉ quản trị viên mới được thực hiện thao tác này." });
  next();
}
