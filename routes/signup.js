// ĐĂNG KÝ TÀI KHOẢN + ĐĂNG NHẬP BẰNG TÀI KHOẢN TỰ ĐĂNG KÝ
// File này được gắn TRƯỚC routes/auth.js (xem server.js) nên routes/auth.js giữ nguyên như cũ:
//  - POST /api/auth/register : tạo tài khoản mới (lưu database), tạo xong đăng nhập luôn
//  - POST /api/auth/login    : nếu là tài khoản tự đăng ký thì đăng nhập ở đây;
//                              tài khoản trong AUTH_USERS (admin, user1...) chuyển tiếp cho routes/auth.js
import { Router } from "express";
import { publicUser, findUserByUsername, setSessionCookie } from "../auth.js";
import { createAccount, verifyAccount, normalizeUsername } from "../lib/accounts.js";
import { asyncRoute, httpError } from "../lib/http-error.js";
import { createLimiter } from "../lib/rate-limit-store.js";
import { trackStat } from "../lib/stats.js";

const router = Router();

const registerLimiter = createLimiter("register", {
  windowMs: 60 * 60 * 1000,
  limit: 20, // cả lớp dùng chung wifi vẫn đăng ký được, nhưng chặn tạo tài khoản hàng loạt
  message: "Đã tạo quá nhiều tài khoản từ mạng này. Vui lòng thử lại sau 1 giờ."
});

const memberLoginLimiter = createLimiter("member-login", {
  limit: 10,
  message: "Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút."
});

router.post("/register", registerLimiter, asyncRoute(async (req, res) => {
  const { username, name, password } = req.body || {};
  // Không cho trùng tên với tài khoản hệ thống trong AUTH_USERS (admin, tài khoản demo)
  if (findUserByUsername(normalizeUsername(username))) {
    throw httpError(409, "Tên đăng nhập đã có người dùng. Vui lòng chọn tên khác.");
  }
  const user = await createAccount({ username, name, password });
  setSessionCookie(req, res, user);
  trackStat("registrations");
  trackStat("logins");
  res.status(201).json({ user: publicUser(user) });
}));

router.post("/login", asyncRoute(async (req, res, next) => {
  // Tài khoản AUTH_USERS: để routes/auth.js xử lý như cũ
  if (findUserByUsername(req.body?.username)) return next();
  return memberLoginLimiter(req, res, async () => {
    try {
      const user = await verifyAccount(req.body?.username, req.body?.password);
      if (!user) return res.status(401).json({ error: "Tên đăng nhập hoặc mật khẩu không đúng." });
      setSessionCookie(req, res, user);
      trackStat("logins");
      res.json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });
}));

export default router;
