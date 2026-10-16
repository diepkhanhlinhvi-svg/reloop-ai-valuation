import { Router } from "express";
import {
  publicUser, findUserByCredentials, findUserByUsername, listUsers, setSessionCookie, clearSessionCookie
} from "../auth.js";
import { createLimiter } from "../lib/rate-limit-store.js";
import { trackStat } from "../lib/stats.js";

const router = Router();

const loginLimiter = createLimiter("login", {
  limit: 10,
  message: "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút."
});

router.post("/login", loginLimiter, (req, res) => {
  const user = findUserByCredentials(req.body?.username, req.body?.password);
  if (!user) {
    return res.status(401).json({ error: "Tên đăng nhập hoặc mật khẩu không đúng." });
  }
  setSessionCookie(req, res, user);
  trackStat("logins");
  res.json({ user: publicUser(user) });
});

// Đăng nhập nhanh không cần mật khẩu (DEMO_LOGIN=true). Dự án bật cả trên web công khai để
// chia sẻ 3 tài khoản mẫu: ai cũng vào được mọi tài khoản, kể cả admin.
const DEMO_LOGIN = process.env.DEMO_LOGIN === "true";
if (DEMO_LOGIN && process.env.VERCEL) {
  console.warn("WARNING: DEMO_LOGIN đang bật trên Vercel: ai cũng đăng nhập được mọi tài khoản, kể cả admin");
}

router.get("/demo-accounts", (_req, res) => {
  res.json({ accounts: DEMO_LOGIN ? listUsers().map(publicUser) : [] });
});

router.post("/demo-login", loginLimiter, (req, res) => {
  if (!DEMO_LOGIN) return res.status(404).json({ error: "Không tìm thấy API." });
  const user = findUserByUsername(req.body?.username);
  if (!user) return res.status(404).json({ error: "Tài khoản không tồn tại." });
  setSessionCookie(req, res, user);
  trackStat("logins");
  res.json({ user: publicUser(user) });
});

router.post("/logout", (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
