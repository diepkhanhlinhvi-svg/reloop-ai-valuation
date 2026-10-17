// API chợ: tin đăng, đơn hàng, đề nghị trao đổi và thống kê admin
import { Router } from "express";
import { requireAdmin, requireLogin } from "../auth.js";
import { asyncRoute } from "../lib/http-error.js";
import { createLimiter } from "../lib/rate-limit-store.js";
import {
  listListings, createListing, deleteListing,
  placeOrder, listOrders, updateOrder,
  createOffer, listOffers, updateOffer,
  marketplaceSummary
} from "../lib/marketplace.js";
import { getStats } from "../lib/stats.js";

const router = Router();

const writeLimiter = createLimiter("write", {
  limit: 60,
  message: "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút."
});

// --- TIN ĐĂNG ---
router.get("/listings", asyncRoute(async (req, res) => {
  res.json({ listings: await listListings(req.user) });
}));

router.post("/listings", requireLogin, writeLimiter, asyncRoute(async (req, res) => {
  res.status(201).json({ listing: await createListing(req.user, req.body) });
}));

router.delete("/listings/:id", requireLogin, asyncRoute(async (req, res) => {
  await deleteListing(req.user, req.params.id);
  res.json({ ok: true });
}));

// --- ĐƠN HÀNG ---
router.get("/orders", requireLogin, asyncRoute(async (req, res) => {
  res.json(await listOrders(req.user));
}));

router.post("/orders", requireLogin, writeLimiter, asyncRoute(async (req, res) => {
  res.status(201).json({ orders: await placeOrder(req.user, req.body) });
}));

router.patch("/orders/:id", requireLogin, writeLimiter, asyncRoute(async (req, res) => {
  res.json({ order: await updateOrder(req.user, req.params.id, req.body?.action) });
}));

// --- ĐỀ NGHỊ TRAO ĐỔI ---
router.get("/offers", requireLogin, asyncRoute(async (req, res) => {
  res.json(await listOffers(req.user));
}));

router.post("/listings/:id/offers", requireLogin, writeLimiter, asyncRoute(async (req, res) => {
  res.status(201).json({ offer: await createOffer(req.user, req.params.id, req.body) });
}));

router.patch("/offers/:id", requireLogin, writeLimiter, asyncRoute(async (req, res) => {
  res.json({ offer: await updateOffer(req.user, req.params.id, req.body?.action, req.body) });
}));

// --- THỐNG KÊ CHO ADMIN ---
router.get("/admin/stats", requireAdmin, asyncRoute(async (_req, res) => {
  const [usage, summary] = await Promise.all([getStats(), marketplaceSummary()]);
  res.json({ usage, ...summary, storage: "postgres" });
}));

export default router;
