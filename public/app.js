// Toàn bộ logic giao diện ReLoop (tách khỏi index.html để CSP không cần cho phép script inline)
// --- TRẠNG THÁI ỨNG DỤNG ---
const state = {
    channel: 'buyer', // 'buyer' | 'seller' | 'trade'
    currentPage: 'home',
    selectedProductId: null,
    cart: loadCart(), // [{ id, name, price, image }] — đồ cũ nên mỗi món chỉ có 1 cái
    categoryFilter: 'all',
    searchQuery: '',
    user: null, // { username, name, role: 'admin' | 'user' } khi đã đăng nhập
    demoAccounts: [], // tài khoản đăng nhập nhanh, máy chủ chỉ trả về khi bật DEMO_LOGIN
    afterLogin: null, // trang/kênh quay lại sau khi đăng nhập
    admin: { stats: null, loading: false, error: null },
    // Đơn mua/bán và đề nghị trao đổi của người đang đăng nhập (tải khi mở trang Đơn hàng / Kênh Người Bán)
    activity: { orders: null, offers: null, loading: false, error: null, tab: 'purchases' },
    infoPage: 'help' // trang thông tin đang xem (chân trang)
};

// Tin đăng tải từ máy chủ (/api/listings): tin còn bán, cộng tin của chính mình (admin thấy tất cả để kiểm tra)
const products = [];

// --- API, ĐĂNG NHẬP & TIN ĐĂNG ---
const SERVER_HINT = 'Hãy chạy máy chủ bằng lệnh "npm run dev" rồi mở http://localhost:3000';

async function api(path, options = {}) {
    // Mở thẳng file index.html (file://) thì không có máy chủ để gọi API
    if (location.protocol === 'file:') throw new Error(`Không thể kết nối máy chủ. ${SERVER_HINT}`);
    let response;
    try {
        response = await fetch(path, {
            credentials: 'same-origin',
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
        });
    } catch {
        throw new Error(`Không thể kết nối máy chủ. ${SERVER_HINT}`);
    }
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
        const error = new Error((data && data.error) || `Máy chủ đang gặp sự cố (mã ${response.status}).`);
        error.status = response.status;
        error.unavailable = data && data.unavailable; // món không còn mua được khi đặt hàng (409)
        throw error;
    }
    return data || {};
}

async function loadListings() {
    try {
        const data = await api('/api/listings');
        products.splice(0, products.length, ...(data.listings || []));
        // Máy chủ là nguồn đúng của quy tắc đổi ngang giá
        if (Number.isFinite(data.tradeTolerancePercent)) TRADE_TOLERANCE_PERCENT = data.tradeTolerancePercent;
        syncCart();
    } catch (err) {
        console.error(err);
        showToast('Không tải được danh sách sản phẩm', 'error');
    }
}

// Chợ (mua/trao đổi) chỉ hiện món đồ còn chưa có người mua/đổi
function marketProducts() {
    return products.filter(p => p.availability === 'available');
}

const isAdminUser = () => state.user?.role === 'admin';

// --- GIỎ HÀNG (lưu trong trình duyệt; máy chủ kiểm tra lại giá và tình trạng khi đặt) ---
function loadCart() {
    try {
        const saved = JSON.parse(localStorage.getItem('reloop_cart') || '[]');
        return Array.isArray(saved) ? saved.filter(item => item && Number.isInteger(item.id)) : [];
    } catch {
        return [];
    }
}

function saveCart() {
    try { localStorage.setItem('reloop_cart', JSON.stringify(state.cart)); } catch { /* trình duyệt chặn lưu trữ */ }
    updateCartBadge();
}

// Sau khi tải lại tin đăng: bỏ khỏi giỏ những món đã có người mua/đổi hoặc bị gỡ, cập nhật giá mới
function syncCart() {
    const available = new Map(marketProducts().map(p => [p.id, p]));
    const removed = state.cart.filter(item => !available.has(item.id));
    state.cart = state.cart
        .filter(item => available.has(item.id))
        .map(item => ({ ...item, name: available.get(item.id).name, price: available.get(item.id).price, image: available.get(item.id).image }));
    saveCart();
    if (removed.length) {
        showToast(`Đã bỏ khỏi giỏ ${removed.length} món không còn bán: ${removed.map(i => i.name).join(', ')}`, 'error');
    }
}

// Lý do một món không mua được (null = mua được)
function buyBlocker(p) {
    if (!p) return 'Sản phẩm không tồn tại hoặc đã bị gỡ.';
    if (isAdminUser()) return 'Tài khoản quản trị chỉ dùng để kiểm tra và gỡ tin.';
    if (state.user && p.owner === state.user.username) return 'Đây là tin đăng của bạn.';
    if (p.availability === 'reserved') return 'Món này đã có người đặt mua.';
    if (p.availability === 'sold') return 'Món này đã được bán.';
    if (p.availability === 'traded') return 'Món này đã được trao đổi.';
    if (p.type === 'trade') return 'Món này chỉ nhận trao đổi, không bán.';
    return null;
}

function myProducts() {
    return state.user ? products.filter(p => p.owner === state.user.username) : [];
}

function canManage(p) {
    return Boolean(state.user && (state.user.role === 'admin' || p.owner === state.user.username));
}

const LISTED_BADGE = ['Đang hiện', 'bg-green-100 text-green-800'];

const AVAILABILITY_BADGES = {
    reserved: ['Có người đặt', 'bg-blue-100 text-blue-800'],
    sold: ['Đã bán', 'bg-gray-200 text-gray-700'],
    traded: ['Đã đổi', 'bg-amber-100 text-amber-800']
};

// Hiện tình trạng mua bán (đã đặt/đã bán/đã đổi) nếu có, không thì "Đang hiện"
function statusBadge(p) {
    const [label, cls] = AVAILABILITY_BADGES[p.availability] || LISTED_BADGE;
    return `<span class="${cls} text-[10px] font-bold px-2 py-0.5 rounded whitespace-nowrap">${label}</span>`;
}

function renderUserBar() {
    const el = document.getElementById('user-top-bar');
    if (!el) return;
    if (!state.user) {
        el.innerHTML = `
            <a href="#" onclick="promptLogin(); return false;" class="hover:text-brand-700 flex items-center gap-1.5 font-medium">
                <i class="far fa-user-circle text-sm"></i> <span>Đăng nhập</span>
            </a>
            <a href="#" onclick="promptRegister(); return false;" class="bg-brand-600 hover:bg-brand-700 text-white px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1.5">
                <i class="fas fa-user-plus text-sm"></i> <span>Đăng ký</span>
            </a>`;
        return;
    }
    el.innerHTML = `
        <a href="#" onclick="navigateTo('orders'); return false;" class="hover:text-brand-700 flex items-center gap-1" title="Đơn hàng & trao đổi">
            <i class="fas fa-receipt"></i> <span class="hidden md:inline">Đơn hàng</span>
        </a>
        ${state.user.role === 'admin' ? `
            <a href="#" onclick="navigateTo('admin'); return false;" class="hover:text-brand-700 text-brand-700 font-semibold flex items-center gap-1" title="Quản trị">
                <i class="fas fa-user-shield"></i> <span class="hidden md:inline">Quản trị</span>
            </a>` : ''}
        <a href="#" onclick="navigateTo('profile'); return false;" class="hover:text-brand-700 flex items-center gap-1.5">
            <i class="far fa-user-circle text-sm"></i>
            <span class="font-medium hidden sm:inline">${escapeHtml(state.user.name)}</span>
        </a>`;
}

function promptLogin(returnTo = null) {
    state.afterLogin = returnTo;
    navigateTo('login');
}

async function handleLogin(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
        const data = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                username: document.getElementById('login-username').value,
                password: document.getElementById('login-password').value
            })
        });
        await finishLogin(data.user);
    } catch (err) {
        showToast(err.message, 'error');
        if (btn) btn.disabled = false;
    }
}

async function demoLogin(username) {
    document.querySelectorAll('.demo-login-btn').forEach(b => { b.disabled = true; });
    try {
        const data = await api('/api/auth/demo-login', { method: 'POST', body: JSON.stringify({ username }) });
        await finishLogin(data.user);
    } catch (err) {
        showToast(err.message, 'error');
        document.querySelectorAll('.demo-login-btn').forEach(b => { b.disabled = false; });
    }
}

async function finishLogin(user) {
    state.user = user;
    // Bỏ dữ liệu đã tải của tài khoản trước (đổi tài khoản không cần đăng xuất)
    state.admin = { stats: null, loading: false, error: null };
    state.activity = { orders: null, offers: null, loading: false, error: null, tab: 'purchases' };
    renderUserBar();
    await loadListings();
    showToast(`Xin chào ${user.name}!`);
    const target = state.afterLogin;
    state.afterLogin = null;
    if (target === 'seller') switchChannel('seller');
    else if (target) navigateTo(target);
    else navigateTo(user.role === 'admin' ? 'admin' : 'home');
}

async function handleLogout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* vẫn xóa phiên phía trình duyệt */ }
    state.user = null;
    state.admin = { stats: null, loading: false, error: null };
    state.activity = { orders: null, offers: null, loading: false, error: null, tab: 'purchases' };
    renderUserBar();
    await loadListings();
    showToast('Đã đăng xuất');
    goToBuyerHome();
}

async function deleteListing(id) {
    const item = products.find(p => p.id === id);
    if (!item || !confirm(`Gỡ tin "${item.name}"? Thao tác này không hoàn tác được.`)) return;
    try {
        await api(`/api/listings/${id}`, { method: 'DELETE' });
        products.splice(products.indexOf(item), 1);
        showToast('Đã gỡ tin đăng');
        if (state.currentPage === 'admin') loadAdminStats();
        if (state.currentPage === 'detail') navigateTo('home');
        else renderPage();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function loadAdminStats() {
    state.admin.loading = true;
    state.admin.error = null;
    try {
        state.admin.stats = await api('/api/admin/stats');
    } catch (err) {
        state.admin.error = err.message;
    } finally {
        state.admin.loading = false;
        if (state.currentPage === 'admin') renderPage();
    }
}

async function refreshAdmin() {
    await loadListings();
    await loadAdminStats();
}

const categories = [
    { id: 'all', name: 'Tất Cả', icon: 'fa-th-large' },
    { id: 'thoi-trang', name: 'Thời Trang', icon: 'fa-tshirt' },
    { id: 'dien-tu', name: 'Thiết Bị Điện Tử', icon: 'fa-laptop' },
    { id: 'gia-dung', name: 'Nhà Cửa & Đời Sống', icon: 'fa-home' },
    { id: 'my-pham', name: 'Sức Khỏe & Sắc Đẹp', icon: 'fa-pump-soap' }
];

// --- CORE NAVIGATION & HELPER FUNCTIONS ---
// Màu chữ riêng của từng kênh khi không được chọn (giữ đúng thiết kế ban đầu)
const CHANNEL_IDLE_TEXT = { buyer: 'text-slate-600', seller: 'text-slate-600', trade: 'text-slate-600' };

function updateChannelButtons() {
    ['buyer', 'seller', 'trade'].forEach(ch => {
        const btn = document.getElementById(`nav-btn-${ch}`);
        if (!btn) return;
        const base = 'px-2.5 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 flex-shrink-0';
        btn.className = ch === state.channel
            ? `${base} bg-brand-50 text-brand-800`
            : `${base} hover:bg-brand-50 hover:text-brand-700 ${CHANNEL_IDLE_TEXT[ch]}`;
    });
}

function switchChannel(channelName) {
    // Bộ lọc/tìm kiếm của kênh này không áp sang kênh khác
    if (channelName !== state.channel) {
        state.categoryFilter = 'all';
        state.searchQuery = '';
        const input = document.getElementById('search-input');
        if (input) input.value = '';
    }
    state.channel = channelName;
    state.currentPage = 'home';
    updateChannelButtons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderPage();
}

function formatMoney(amount) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(amount) || 0);
}

// Nhãn giảm giá: tính % thật nếu có giá gốc cao hơn, nếu không dùng nhãn văn bản
function discountLabel(p) {
    if (p.originalPrice > p.price && p.price > 0) {
        return `-${Math.round((1 - p.price / p.originalPrice) * 100)}%`;
    }
    return p.discount || '';
}

function hasDiscount(p) {
    return p.originalPrice > p.price;
}

// Bỏ dấu tiếng Việt để tìm "noi chien" vẫn ra "Nồi chiên"
function normalizeSearch(str) {
    return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

function navigateTo(page, productId = null, section = null) {
    state.currentPage = page;
    if (page === 'info' && section) state.infoPage = section;
    if (productId) state.selectedProductId = productId;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    renderPage();
    updateCartBadge();
}

function updateCartBadge() {
    const badge = document.getElementById('cart-badge');
    if (badge) badge.innerText = state.cart.length;
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const bgClass = type === 'success' ? 'bg-brand-800 text-white' : 'bg-red-600 text-white';
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';

    toast.className = `${bgClass} px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 text-sm font-medium toast-slide-in min-w-[250px] max-w-[calc(100vw-2.5rem)]`;
    toast.innerHTML = `<i class="fas ${icon} text-lg"></i> <span></span>`;
    // textContent để nội dung người dùng nhập không bị chèn HTML
    toast.querySelector('span').textContent = message;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Bộ lọc/tìm kiếm áp dụng cho Kênh Người Mua và Kênh Trao Đổi; kênh bán hàng thì chuyển về kênh mua
function goToBuyerHome() {
    if (state.channel !== 'trade') state.channel = 'buyer';
    updateChannelButtons();
    navigateTo('home');
}

function filterByCategory(catId) {
    state.categoryFilter = catId;
    state.searchQuery = '';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    goToBuyerHome();
}

function handleSearch(e) {
    if (e.key === 'Enter' && !e.isComposing) performSearch();
}

function performSearch() {
    const query = document.getElementById('search-input').value.trim();
    state.searchQuery = query;
    state.categoryFilter = 'all';
    goToBuyerHome();
}

// --- PAGE ROUTER & RENDERERS ---
function renderPage() {
    const container = document.getElementById('main-content');

    if (state.currentPage === 'detail') {
        container.innerHTML = renderDetail();
        return;
    }
    if (state.currentPage === 'info') {
        container.innerHTML = renderInfo();
        return;
    }
    if (state.currentPage === 'cart') {
        container.innerHTML = renderCart();
        return;
    }
    if (state.currentPage === 'checkout') {
        container.innerHTML = renderCheckout();
        return;
    }
    if (state.currentPage === 'profile') {
        container.innerHTML = renderProfile();
        return;
    }
    if (state.currentPage === 'ai-valuation') {
        container.innerHTML = renderAIValuation();
        return;
    }
    if (state.currentPage === 'order-success') {
        container.innerHTML = renderOrderSuccess();
        return;
    }
    if (state.currentPage === 'login') {
        container.innerHTML = renderLogin();
        return;
    }
    if (state.currentPage === 'register') {
        container.innerHTML = renderRegister(); // public/register.js
        return;
    }
    if (state.currentPage === 'orders') {
        container.innerHTML = renderOrders();
        if (state.user && !state.activity.orders && !state.activity.loading && !state.activity.error) loadActivity();
        return;
    }
    if (state.currentPage === 'admin') {
        container.innerHTML = renderAdmin();
        if (state.user?.role === 'admin' && !state.admin.stats && !state.admin.loading && !state.admin.error) {
            loadAdminStats();
        }
        return;
    }

    // Trang chủ phân luồng theo Kênh
    switch (state.channel) {
        case 'seller':
            container.innerHTML = renderSellerChannel();
            if (state.user && !state.activity.orders && !state.activity.loading && !state.activity.error) loadActivity();
            break;
        case 'trade':
            container.innerHTML = renderTradingChannel();
            break;
        case 'buyer':
        default:
            container.innerHTML = renderHome();
            break;
    }
}

// =====================================================
// 1. KÊNH NGƯỜI MUA (BUYER CHANNEL)
// =====================================================
function renderHome() {
    let filtered = marketProducts().filter(p => p.type === 'buy' || p.type === 'both');

    if (state.categoryFilter !== 'all') {
        filtered = filtered.filter(p => p.category === state.categoryFilter);
    }

    if (state.searchQuery) {
        const q = normalizeSearch(state.searchQuery);
        filtered = filtered.filter(p => normalizeSearch(p.name).includes(q));
    }

    const heroProducts = filtered.slice(0, 2);
    const productImage = (product, className, loading = 'lazy') => product.image
        ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="${loading}" onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden')" class="${className}"><div class="hidden ${className} flex items-center justify-center bg-emerald-50 text-emerald-700"><i class="fas fa-recycle text-4xl"></i></div>`
        : `<div class="${className} bg-emerald-50 text-emerald-700 flex items-center justify-center"><i class="fas fa-recycle text-4xl"></i></div>`;

    return `
                <div class="space-y-8">
                    <section class="relative isolate overflow-hidden rounded-[2rem] border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-green-50 px-5 py-8 shadow-sm sm:px-8 sm:py-10 lg:px-12 lg:py-12">
                        <div class="pointer-events-none absolute -right-20 -top-24 -z-10 h-72 w-72 rounded-full bg-emerald-100/70 blur-2xl"></div>
                        <div class="grid items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
                            <div>
                                <span class="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 text-[10px] font-bold tracking-[0.16em] text-emerald-700 sm:text-xs">
                                    <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                                    RELOOP – CIRCULAR MARKETPLACE
                                </span>
                                <h1 class="mt-5 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight text-gray-900 sm:text-4xl lg:text-5xl">
                                    Đồ cũ của bạn.<br>
                                    <span class="text-emerald-600">Giá trị mới</span> cho mọi người.
                                </h1>
                                <p class="mt-4 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
                                    Mua sắm tiết kiệm, đăng bán dễ dàng và trao đổi những món đồ còn giá trị. Cùng ReLoop kéo dài vòng đời sản phẩm và xây dựng lối sống bền vững.
                                </p>
                                <div class="mt-6 flex flex-col gap-3 sm:flex-row">
                                    <button onclick="document.getElementById('home-products').scrollIntoView({ behavior: 'smooth' })" class="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-md sm:w-auto">
                                        Khám phá sản phẩm <i class="fas fa-arrow-down text-xs"></i>
                                    </button>
                                    <button onclick="switchChannel('seller')" class="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-5 py-3 text-sm font-bold text-emerald-700 transition hover:border-emerald-400 hover:bg-emerald-50 sm:w-auto">
                                        <i class="fas fa-store"></i> Đăng bán ngay
                                    </button>
                                </div>
                                <div class="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-xs font-medium text-slate-600 sm:text-sm">
                                    <span class="inline-flex items-center gap-2"><i class="fas fa-check-circle text-emerald-600"></i>Mua bán tiết kiệm</span>
                                    <span class="inline-flex items-center gap-2"><i class="fas fa-sync-alt text-emerald-600"></i>Trao đổi linh hoạt</span>
                                    <span class="inline-flex items-center gap-2"><i class="fas fa-wand-magic-sparkles text-emerald-600"></i>Hỗ trợ định giá bằng AI</span>
                                </div>
                            </div>

                            <div class="relative mx-auto w-full max-w-lg">
                                <div class="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-100 sm:h-72 sm:w-72"></div>
                                <div class="absolute right-2 top-1 z-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-xl text-emerald-600 shadow-lg sm:right-6 sm:top-3 sm:h-14 sm:w-14">
                                    <i class="fas fa-recycle"></i>
                                </div>
                                ${heroProducts.length ? `
                                    <div class="relative z-10 grid grid-cols-2 items-end gap-3 px-1 pb-2 pt-12 sm:gap-4 sm:px-4 sm:pt-14">
                                        ${heroProducts.map((product, index) => `
                                            <button onclick="navigateTo('detail', ${product.id})" class="group overflow-hidden rounded-2xl border border-white bg-white text-left shadow-xl transition hover:-translate-y-1 hover:shadow-2xl ${index === 0 ? 'col-span-2 sm:col-span-1 sm:translate-y-5' : 'col-span-2 sm:col-span-1'}">
                                                ${productImage(product, `h-36 w-full object-cover sm:h-44 ${index === 0 ? 'sm:h-52' : ''}`, index === 0 ? 'eager' : 'lazy')}
                                                <span class="block p-3 sm:p-4">
                                                    <span class="block truncate text-xs font-semibold text-slate-700 sm:text-sm">${escapeHtml(product.name)}</span>
                                                    <span class="mt-1 block text-sm font-extrabold text-emerald-700 sm:text-base">${formatMoney(product.price)}</span>
                                                </span>
                                            </button>
                                        `).join('')}
                                    </div>
                                ` : `
                                    <div class="relative z-10 flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center sm:min-h-80">
                                        <div class="flex h-24 w-24 items-center justify-center rounded-3xl border border-white bg-white/90 text-5xl text-emerald-600 shadow-xl">
                                            <i class="fas fa-recycle"></i>
                                        </div>
                                        <p class="mt-5 max-w-xs text-sm font-semibold text-emerald-900">Mỗi món đồ đều có thể bắt đầu một vòng đời mới.</p>
                                    </div>
                                `}
                                <div class="absolute bottom-1 left-0 z-20 hidden items-center gap-2 rounded-xl border border-emerald-100 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 shadow-lg sm:flex">
                                    <i class="fas fa-leaf text-emerald-600"></i> Chọn sống xanh hơn
                                </div>
                            </div>
                        </div>
                    </section>

                    <section aria-labelledby="home-categories-heading" class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                        <div class="mb-4 flex items-end justify-between gap-3">
                            <div>
                                <p class="text-xs font-semibold uppercase tracking-wider text-emerald-700">Tìm theo nhu cầu</p>
                                <h2 id="home-categories-heading" class="mt-1 text-lg font-bold text-gray-900 sm:text-xl">Danh mục sản phẩm</h2>
                            </div>
                        </div>
                        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
                        ${categories.map(cat => `
                            <button onclick="filterByCategory('${cat.id}')"
                                class="group flex min-h-20 items-center gap-3 rounded-xl border px-3 py-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50 ${state.categoryFilter === cat.id ? 'border-emerald-500 bg-emerald-50 text-emerald-800 font-bold' : 'border-slate-100 text-slate-600'}">
                                <span class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-lg text-emerald-700 transition group-hover:bg-white">
                                    <i class="fas ${cat.icon}"></i>
                                </span>
                                <span class="text-xs font-semibold leading-snug sm:text-sm">${cat.name}</span>
                            </button>
                        `).join('')}
                        </div>
                    </section>

                    <section id="home-products" aria-labelledby="home-products-heading" class="scroll-mt-28">
                        <div class="mb-4 flex items-end justify-between gap-3">
                            <div>
                                <p class="text-xs font-semibold uppercase tracking-wider text-emerald-700">Đồ tốt, thêm vòng đời</p>
                                <h2 id="home-products-heading" class="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">
                                    ${state.searchQuery ? `Kết quả tìm kiếm cho "${escapeHtml(state.searchQuery)}"` : 'Sản phẩm nổi bật'}
                                </h2>
                            </div>
                            ${state.categoryFilter !== 'all' || state.searchQuery ? `
                                <button onclick="filterByCategory('all')" class="flex-shrink-0 text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline">Xóa bộ lọc</button>
                            ` : ''}
                        </div>

                        ${filtered.length === 0 ? `
                            <div class="rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center text-slate-500 shadow-sm sm:px-12">
                                <i class="fas fa-box-open text-5xl text-slate-300"></i>
                                <p class="mt-3 text-base font-semibold">Không tìm thấy sản phẩm phù hợp.</p>
                                <button onclick="filterByCategory('all')" class="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700">Quay lại trang chính</button>
                            </div>
                        ` : `
                            <div class="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
                                ${filtered.map(product => {
                                    const condition = typeof product.condition === 'string' ? product.condition : product.condition?.grade;
                                    return `
                                        <button onclick="navigateTo('detail', ${product.id})" class="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-lg">
                                            <span class="relative block w-full overflow-hidden bg-slate-100">
                                                ${productImage(product, 'h-40 w-full object-cover transition duration-300 group-hover:scale-105 sm:h-48')}
                                                ${discountLabel(product) ? `
                                                    <span class="absolute right-3 top-3 rounded-full bg-emerald-700 px-2.5 py-1 text-[10px] font-bold text-white shadow">
                                                        ${escapeHtml(discountLabel(product))}
                                                    </span>` : ''}
                                            </span>
                                            <span class="flex flex-1 flex-col p-3 sm:p-4">
                                                <span class="line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-gray-800 transition group-hover:text-emerald-700">${escapeHtml(product.name)}</span>
                                                <span class="mt-2 flex flex-wrap items-baseline gap-x-2">
                                                    <span class="text-base font-extrabold text-emerald-700 sm:text-lg">${formatMoney(product.price)}</span>
                                                    ${hasDiscount(product) ? `<span class="text-xs text-slate-400 line-through">${formatMoney(product.originalPrice)}</span>` : ''}
                                                </span>
                                                <span class="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-3 text-[11px] text-slate-500">
                                                    ${condition ? `<span class="rounded-full bg-slate-100 px-2 py-1">${escapeHtml(condition)}</span>` : ''}
                                                    ${product.type === 'both' ? `<span class="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700"><i class="fas fa-sync-alt mr-1"></i>Có thể trao đổi</span>` : ''}
                                                </span>
                                                ${product.location ? `<span class="mt-2 truncate text-xs text-slate-500"><i class="fas fa-map-marker-alt mr-1.5 text-slate-400"></i>${escapeHtml(product.location)}</span>` : ''}
                                            </span>
                                        </button>
                                    `;
                                }).join('')}
                            </div>
                        `}
                    </section>

                    <section class="overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-white p-5 sm:p-7">
                        <div class="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                            <div class="flex items-start gap-4">
                                <div class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white text-xl text-emerald-600 shadow-sm"><i class="fas fa-wand-magic-sparkles"></i></div>
                                <div>
                                    <p class="text-xs font-semibold uppercase tracking-wider text-emerald-700">ReLoop AI</p>
                                    <h2 class="mt-1 text-lg font-bold text-gray-900 sm:text-xl">Chưa biết món đồ của bạn đáng giá bao nhiêu?</h2>
                                    <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Khám phá công cụ AI hỗ trợ tham khảo giá trị sản phẩm đã qua sử dụng.</p>
                                </div>
                            </div>
                            <button onclick="navigateTo('ai-valuation')" class="inline-flex w-full flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 sm:w-auto">
                                Thử định giá AI <i class="fas fa-arrow-right text-xs"></i>
                            </button>
                        </div>
                    </section>

                    <section aria-labelledby="home-steps-heading" class="pb-2">
                        <div class="mb-5 text-center">
                            <p class="text-xs font-semibold uppercase tracking-wider text-emerald-700">Bắt đầu thật dễ dàng</p>
                            <h2 id="home-steps-heading" class="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">Một vòng đời mới, chỉ với 3 bước</h2>
                        </div>
                        <div class="grid gap-3 sm:grid-cols-3 sm:gap-4">
                            ${[
                                ['01', 'Khám phá hoặc đăng sản phẩm', 'Tìm món đồ phù hợp hoặc đăng món bạn muốn trao đi.', 'fa-magnifying-glass'],
                                ['02', 'Mua bán hoặc đề xuất trao đổi', 'Chọn cách giao dịch phù hợp với nhu cầu của bạn.', 'fa-handshake'],
                                ['03', 'Kết nối và hoàn tất giao dịch', 'Liên hệ với đối phương để thống nhất cách giao nhận.', 'fa-comments']
                            ].map(([number, title, description, icon]) => `
                                <div class="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                                    <div class="flex items-center justify-between">
                                        <span class="text-xs font-extrabold tracking-widest text-emerald-700">${number}</span>
                                        <i class="fas ${icon} text-lg text-emerald-600"></i>
                                    </div>
                                    <h3 class="mt-4 text-sm font-bold text-gray-900">${title}</h3>
                                    <p class="mt-2 text-xs leading-5 text-slate-500">${description}</p>
                                </div>
                            `).join('')}
                        </div>
                    </section>
                </div>
            `;
}

// =====================================================
// 2. KÊNH NGƯỜI BÁN (SELLER CHANNEL)
// =====================================================
function renderSellerChannel() {
    if (!state.user) {
        return `
                <div class="bg-white rounded-xl shadow-sm p-8 text-center max-w-lg mx-auto border border-brand-100">
                    <div class="w-14 h-14 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-2xl mx-auto mb-3"><i class="fas fa-store"></i></div>
                    <h2 class="text-base font-bold text-gray-800 mb-1">Đăng nhập để đăng bán</h2>
                    <p class="text-xs text-gray-500 mb-5">Bạn cần đăng nhập để đăng sản phẩm lên chợ và quản lý tin của mình.</p>
                    <div class="flex flex-wrap justify-center gap-2">
                        <button onclick="promptLogin('seller')" class="bg-brand-700 hover:bg-brand-800 text-white px-6 py-2.5 rounded-lg text-sm font-bold shadow transition">Đăng nhập</button>
                        <button onclick="promptRegister('seller')" class="border-2 border-brand-700 text-brand-800 hover:bg-brand-50 px-6 py-2 rounded-lg text-sm font-bold transition">Đăng ký</button>
                    </div>
                </div>
            `;
    }
    if (isAdminUser()) {
        return `
                <div class="bg-white rounded-xl shadow-sm p-8 text-center max-w-lg mx-auto border border-brand-100">
                    <div class="w-14 h-14 rounded-full bg-yellow-50 text-yellow-700 flex items-center justify-center text-2xl mx-auto mb-3"><i class="fas fa-user-shield"></i></div>
                    <h2 class="text-base font-bold text-gray-800 mb-1">Tài khoản quản trị không đăng bán</h2>
                    <p class="text-xs text-gray-500 mb-5">Quản trị viên chỉ kiểm tra tin đăng và gỡ tin vi phạm. Hãy dùng tài khoản người dùng để mua bán.</p>
                    <button onclick="navigateTo('admin')" class="bg-brand-700 hover:bg-brand-800 text-white px-6 py-2.5 rounded-lg text-sm font-bold shadow transition">Về trang quản trị</button>
                </div>
            `;
    }
    const mine = myProducts();
    const sales = state.activity.orders?.sales || [];
    const revenue = sales.filter(o => o.status === 'completed').reduce((sum, o) => sum + o.price, 0);
    const waiting = sales.filter(o => o.status === 'pending').length
        + (state.activity.offers?.received || []).filter(o => o.status === 'pending').length;
    return `
                <div class="grid grid-cols-1 gap-5 lg:grid-cols-3">
                    <!-- Form Upload Sản Phẩm Mới -->
                    <div class="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-7 lg:col-span-2">
                        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                            <div>
                                <p class="text-xs font-semibold uppercase tracking-wider text-brand-700">Kênh người bán</p>
                                <h2 class="mt-1 flex items-center gap-2 text-xl font-bold text-gray-900">
                                    <i class="fas fa-cloud-upload-alt text-brand-700"></i> Đăng Sản Phẩm Mới Lên Chợ
                                </h2>
                                <p class="mt-1 text-sm text-slate-500">Chia sẻ món đồ còn giá trị với cộng đồng ReLoop.</p>
                            </div>
                            <button onclick="navigateTo('ai-valuation')" class="rounded-xl bg-brand-50 px-3 py-2 text-xs font-bold text-brand-800 transition hover:bg-brand-100">
                                <i class="fas fa-magic"></i> Dùng AI Định Giá
                            </button>
                        </div>

                        <form onsubmit="handleUploadProduct(event)" class="space-y-5 text-sm">
                            <div>
                                <label class="font-bold text-gray-700 block mb-1">Tên Sản Phẩm / Món Đồ Cũ *</label>
                                <input type="text" id="up-name" required placeholder="VD: Tai nghe Sony WH-1000XM4 đã sử dụng 6 tháng"
                                    class="w-full border rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-brand-600 outline-none">
                            </div>

                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label class="font-bold text-gray-700 block mb-1">Hình Thức Niêm Yết *</label>
                                    <select id="up-type" onchange="toggleExchangeInput(this.value)" class="w-full border rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-brand-600 outline-none bg-white">
                                        <option value="buy">Chỉ Bán Lấy Tiền</option>
                                        <option value="trade">Chỉ Trao Đổi Đồ</option>
                                        <option value="both">Vừa Bán Vừa Cho Đổi Đồ</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="font-bold text-gray-700 block mb-1">Danh Mục Sản Phẩm *</label>
                                    <select id="up-category" class="w-full border rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-brand-600 outline-none bg-white">
                                        <option value="dien-tu">Thiết Bị Điện Tử</option>
                                        <option value="thoi-trang">Thời Trang</option>
                                        <option value="gia-dung">Nhà Cửa & Đời Sống</option>
                                        <option value="my-pham">Sức Khỏe & Sắc Đẹp</option>
                                    </select>
                                </div>
                            </div>

                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label class="font-bold text-gray-700 block mb-1">Giá Bán / Giá Trị Ước Tính (VNĐ) *</label>
                                    <input type="number" id="up-price" min="1" required placeholder="VD: 450000"
                                        class="w-full border rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-brand-600 outline-none">
                                </div>
                                <div>
                                    <label class="font-bold text-gray-700 block mb-1">Giá Gốc Lúc Mua (VNĐ)</label>
                                    <input type="number" id="up-original-price" min="0" placeholder="VD: 750000"
                                        class="w-full border rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-brand-600 outline-none">
                                </div>
                            </div>

                            <!-- Món đồ muốn đổi (Hiện khi chọn trade/both) -->
                            <div id="exchange-need-box" class="hidden rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                                <label class="mb-1 block font-bold text-emerald-900"><i class="fas fa-sync-alt"></i> Món Đồ Muốn Nhận Đổi Lại</label>
                                <input type="text" id="up-desired" placeholder="VD: Muốn đổi lấy Loa Bluetooth mini hoặc Nồi chiên không dầu..."
                                    class="w-full border rounded-xl p-3 text-sm focus:ring-1 focus:ring-brand-600 outline-none">
                                <p class="mt-2 text-xs leading-5 text-emerald-800">Trao đổi theo nguyên tắc ngang giá: người đề nghị phải dùng một món của họ có giá chênh lệch với giá bạn nhập không quá ${TRADE_TOLERANCE_PERCENT}%.</p>
                            </div>

                            <div>
                                <label class="font-bold text-gray-700 block mb-1">Hình Ảnh Sản Phẩm *</label>
                                <label for="up-image-file" class="block cursor-pointer rounded-2xl border-2 border-dashed border-emerald-200 bg-slate-50 p-6 text-center transition hover:border-emerald-400 hover:bg-emerald-50">
                                    <img id="up-image-preview" alt="" class="hidden mx-auto mb-2 h-24 w-24 object-cover rounded-lg border">
                                    <i class="fas fa-camera text-2xl text-gray-400 mb-1"></i>
                                    <p class="text-gray-500">Tải ảnh sản phẩm từ thiết bị của bạn</p>
                                    <input type="file" id="up-image-file" accept="image/*" required class="mt-2 text-xs max-w-full" onchange="previewUploadImage(this)">
                                </label>
                            </div>

                            <div>
                                <label class="font-bold text-gray-700 block mb-1">Mô Tả Chi Tiết & Tình Trạng Hiện Tại</label>
                                <textarea id="up-desc" rows="3" placeholder="Ghi rõ độ mới, vết xước, phụ kiện kèm theo..."
                                    class="w-full border rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-brand-600 outline-none"></textarea>
                            </div>

                            <p class="flex items-center gap-1.5 text-xs leading-5 text-slate-500"><i class="fas fa-info-circle text-brand-600"></i> Tin đăng sẽ hiển thị ngay trên chợ. Quản trị viên có thể gỡ tin nếu vi phạm.</p>
                            <button type="submit" class="w-full rounded-xl bg-brand-600 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60">
                                <i class="fas fa-check-circle mr-1"></i> Đăng Bán Ngay
                            </button>
                        </form>
                    </div>

                    <!-- Sidebar Thống Kê & Quản Lý Đơn -->
                    <div class="space-y-4">
                        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <h3 class="mb-3 border-b border-slate-100 pb-3 text-sm font-bold text-gray-900">Thống kê kênh bán</h3>
                            ${state.activity.error ? `<p role="alert" class="mb-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">${escapeHtml(state.activity.error)}</p>` : ''}
                            <div class="grid grid-cols-2 gap-3 text-center">
                                <div class="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                                    <div class="text-lg font-black text-brand-800">${state.activity.orders ? formatMoney(revenue) : '—'}</div>
                                    <div class="text-[10px] font-bold uppercase text-slate-500">Hoàn tất</div>
                                </div>
                                <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                    <div class="text-lg font-black text-slate-800">${mine.filter(p => p.availability === 'available').length}</div>
                                    <div class="text-[10px] font-bold uppercase text-slate-500">Đang hiển thị</div>
                                </div>
                            </div>
                            <button onclick="openActivity('sales')" class="mt-3 w-full rounded-xl border border-brand-200 py-2.5 text-xs font-bold text-brand-800 transition hover:bg-brand-50">
                                <i class="fas fa-receipt mr-1"></i> Đơn bán & đề nghị đổi${waiting ? ` <span class="bg-red-500 text-white rounded-full px-1.5 ml-1">${waiting}</span>` : ''}
                            </button>
                        </div>

                        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                            <h3 class="mb-3 border-b border-slate-100 pb-3 text-sm font-bold text-gray-900">Sản phẩm của tôi <span class="font-medium text-slate-400">(${mine.length})</span></h3>
                            <div class="space-y-3 max-h-96 overflow-y-auto">
                                ${mine.length === 0 ? `<p class="py-4 text-center text-xs text-slate-500">${state.activity.loading ? 'Đang tải tin đăng...' : 'Bạn chưa đăng sản phẩm nào.'}</p>` : ''}
                                ${mine.map(p => `
                                    <div class="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 p-2 text-xs transition hover:border-emerald-200 hover:bg-emerald-50/50" onclick="navigateTo('detail', ${p.id})">
                                        <img src="${escapeHtml(p.image)}" alt="" class="w-10 h-10 rounded object-cover flex-shrink-0 bg-gray-100">
                                        <div class="flex-1 min-w-0">
                                            <h4 class="font-semibold text-gray-800 truncate">${escapeHtml(p.name)}</h4>
                                            <span class="text-brand-800 font-bold">${formatMoney(p.price)}</span>
                                        </div>
                                        <div class="flex flex-col items-end gap-1 flex-shrink-0">
                                            ${statusBadge(p)}
                                            <button onclick="event.stopPropagation(); deleteListing(${p.id})" class="text-[10px] text-red-600 hover:underline">Gỡ tin</button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            `;
}

function toggleExchangeInput(val) {
    const box = document.getElementById('exchange-need-box');
    if (!box) return;
    if (val === 'trade' || val === 'both') {
        box.classList.remove('hidden');
    } else {
        box.classList.add('hidden');
    }
}

async function previewUploadImage(input) {
    const preview = document.getElementById('up-image-preview');
    const file = input.files && input.files[0];
    if (!preview) return;
    if (!file) { preview.classList.add('hidden'); return; }
    try {
        const img = await compressImage(file);
        preview.src = img.dataUrl;
        preview.classList.remove('hidden');
    } catch (err) {
        input.value = '';
        preview.classList.add('hidden');
        showToast(err.message, 'error');
    }
}

// Chặn bấm đăng nhiều lần: mọi lần bấm khi một yêu cầu đăng tin đang chạy đều bị bỏ qua
let publishing = false;

async function handleUploadProduct(e) {
    e.preventDefault();
    if (publishing) return;
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const name = document.getElementById('up-name').value.trim();
    const price = Math.max(0, Number(document.getElementById('up-price').value) || 0);
    const originalPrice = Math.max(price, Number(document.getElementById('up-original-price').value) || 0);
    const type = document.getElementById('up-type').value;
    const category = document.getElementById('up-category').value;
    const desiredExchange = type === 'buy' ? '' : document.getElementById('up-desired').value.trim();
    const desc = document.getElementById('up-desc').value.trim();
    const file = document.getElementById('up-image-file').files[0];

    if (!name) { showToast('Vui lòng nhập tên sản phẩm', 'error'); return; }
    if (price <= 0) { showToast(type === 'trade' ? 'Vui lòng nhập giá trị ước tính của món đồ' : 'Vui lòng nhập giá bán hợp lệ', 'error'); return; }

    publishing = true;
    if (submitBtn) submitBtn.disabled = true;
    try {
        // Bỏ trống ảnh -> máy chủ dùng ảnh mặc định
        const image = file ? (await compressImage(file)).dataUrl : '';
        const data = await api('/api/listings', {
            method: 'POST',
            body: JSON.stringify({
                name, price, originalPrice, type, category, desiredExchange, image,
                description: desc,
                discount: 'Mới đăng'
            })
        });
        await publishedListing(data.listing);
    } catch (err) {
        if (err.status === 401) { state.user = null; renderUserBar(); promptLogin('seller'); }
        showToast(err.message, 'error');
        if (submitBtn) submitBtn.disabled = false;
    } finally {
        publishing = false;
    }
}

// Sau khi đăng: tin hiện ngay trên chợ (không thêm trùng nếu máy chủ trả lại tin đã có)
function publishedListing(listing) {
    if (!products.some(p => p.id === listing.id)) products.unshift(listing);
    if (listing.duplicate) {
        showToast('Tin này bạn vừa đăng rồi nên không tạo thêm. Nếu muốn đổi ảnh hoặc nội dung, hãy gỡ tin cũ rồi đăng lại.', 'error');
        return;
    }
    showToast('Đã đăng sản phẩm thành công!');
    switchChannel(listing.type === 'trade' ? 'trade' : 'buyer');
}

// =====================================================
// 3. KÊNH TRAO ĐỔI SẢN PHẨM (TRADING CHANNEL)
// =====================================================
// Đổi ngang giá: hai món chênh nhau tối đa bấy nhiêu phần trăm. Số này lấy từ máy chủ khi tải tin (10 là giá trị dự phòng)
let TRADE_TOLERANCE_PERCENT = 10;

function isFairTrade(priceA, priceB) {
    const high = Math.max(priceA, priceB);
    const low = Math.min(priceA, priceB);
    return low > 0 && (high - low) * 100 <= high * TRADE_TOLERANCE_PERCENT;
}

// Khoảng giá của những món đổi ngang được với một món có giá `price`
function tradeRange(price) {
    const keep = 100 - TRADE_TOLERANCE_PERCENT;
    return [Math.ceil(price * keep / 100), Math.floor(price * 100 / keep)];
}

// --- Hộp thoại dùng chung ---
function openModal(html) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = 'modal-root';
    overlay.className = 'fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-3 backdrop-blur-sm sm:p-4';
    overlay.innerHTML = `<div role="dialog" aria-modal="true" class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 text-xs shadow-2xl sm:p-6">${html}</div>`;
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
}

function closeModal() {
    document.getElementById('modal-root')?.remove();
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function renderTradingChannel() {
    let tradeItems = marketProducts().filter(p => p.type === 'trade' || p.type === 'both');
    if (state.categoryFilter !== 'all') tradeItems = tradeItems.filter(p => p.category === state.categoryFilter);
    if (state.searchQuery) {
        const q = normalizeSearch(state.searchQuery);
        tradeItems = tradeItems.filter(p => normalizeSearch(`${p.name} ${p.desiredExchange}`).includes(q));
    }
    const filtering = state.categoryFilter !== 'all' || state.searchQuery;
    const receivedWaiting = (state.activity.offers?.received || []).filter(o => o.status === 'pending').length;

    return `
                <div class="space-y-6">
                    <div class="relative overflow-hidden rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-white p-5 shadow-sm sm:p-8">
                        <div>
                            <span class="inline-flex rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">Sàn trao đổi đồ cũ</span>
                            <h1 class="mt-3 text-2xl font-extrabold text-gray-900 sm:text-3xl">Đổi ngang giá, hai bên cùng đồng ý</h1>
                            <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Chọn món bạn muốn, đề nghị đổi bằng một món của bạn có giá trị chênh lệch không quá ${TRADE_TOLERANCE_PERCENT}%. Chủ món chấp nhận thì hai món cùng được đánh dấu đã đổi và hai bên nhận số điện thoại của nhau để hẹn giao nhận.</p>
                        </div>
                        <div class="mt-5 flex flex-wrap gap-2">
                            <button onclick="switchChannel('seller')" class="whitespace-nowrap rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700">
                                <i class="fas fa-plus-circle mr-1"></i> Đăng đồ muốn đổi
                            </button>
                            <button onclick="openActivity('received')" class="whitespace-nowrap rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-bold text-emerald-800 transition hover:bg-emerald-50">
                                <i class="fas fa-inbox mr-1"></i> Đề nghị đã nhận${receivedWaiting ? ` <span class="ml-1 rounded-full bg-emerald-100 px-1.5 text-emerald-800">${receivedWaiting}</span>` : ''}
                            </button>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        ${[
                            ['1', 'Chọn món muốn nhận', 'Xem các món đang mở trao đổi và giá trị của chúng.'],
                            ['2', 'Đề nghị đổi bằng món của bạn', `Chọn một món bạn đang đăng, giá chênh nhau tối đa ${TRADE_TOLERANCE_PERCENT}%, kèm số điện thoại.`],
                            ['3', 'Hai bên đồng ý là xong', 'Cả hai món đều biến khỏi chợ, bạn nhận số điện thoại của đối phương.']
                        ].map(([n, title, text]) => `
                            <div class="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                                <span class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 font-black text-emerald-800">${n}</span>
                                <div><h3 class="font-bold text-gray-800">${title}</h3><p class="text-gray-500 mt-0.5">${text}</p></div>
                            </div>`).join('')}
                    </div>

                    <div class="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                        ${categories.map(cat => `
                            <button onclick="filterByCategory('${cat.id}')" class="rounded-full border px-3 py-1.5 text-xs transition ${state.categoryFilter === cat.id ? 'border-emerald-500 bg-emerald-50 font-bold text-emerald-800' : 'border-slate-200 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50'}">${cat.name}</button>
                        `).join('')}
                    </div>

                    <div>
                        <div class="flex items-center justify-between mb-4">
                            <h2 class="border-l-4 border-emerald-600 pl-3 text-base font-bold uppercase text-gray-900">
                                ${state.searchQuery ? `Kết quả cho "${escapeHtml(state.searchQuery)}"` : `Đồ đang chờ trao đổi (${tradeItems.length})`}
                            </h2>
                            ${filtering ? `<button onclick="filterByCategory('all')" class="text-xs font-semibold text-emerald-700 hover:underline">Xóa bộ lọc</button>` : ''}
                        </div>
                        ${tradeItems.length === 0 ? `
                            <div class="rounded-2xl border border-slate-200 bg-white p-10 text-center text-gray-500 shadow-sm sm:p-12">
                                <i class="fas fa-exchange-alt text-5xl text-gray-300 mb-3"></i>
                                <p class="text-base font-medium">${filtering ? 'Không có món nào phù hợp.' : 'Chưa có vật phẩm nào đang chờ trao đổi.'}</p>
                                <button onclick="switchChannel('seller')" class="mt-4 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">Đăng đồ muốn đổi</button>
                            </div>
                        ` : `
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            ${tradeItems.map(tradeCard).join('')}
                        </div>`}
                    </div>
                </div>
            `;
}

function tradeCard(item) {
    const mine = Boolean(state.user && item.owner === state.user.username);
    const [low, high] = tradeRange(item.price);
    return `
                                <div class="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md sm:flex-row">
                                    <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy" class="h-48 w-full flex-shrink-0 cursor-pointer rounded-xl bg-slate-100 object-cover sm:h-36 sm:w-36" onclick="navigateTo('detail', ${item.id})">
                                    <div class="flex-1 min-w-0 space-y-2 text-xs w-full">
                                        <div class="flex items-center gap-2 flex-wrap">
                                            <span class="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-800">${item.type === 'both' ? 'BÁN HOẶC ĐỔI' : 'CHỈ TRAO ĐỔI'}</span>
                                            <span class="text-gray-400"><i class="far fa-user"></i> ${escapeHtml(item.ownerName || 'Người đăng')}</span>
                                        </div>
                                        <h3 class="font-bold text-gray-900 text-sm line-clamp-1 cursor-pointer hover:text-brand-700" onclick="navigateTo('detail', ${item.id})">${escapeHtml(item.name)}</h3>
                                        <div class="text-brand-800 font-extrabold text-base">${formatMoney(item.price)} <span class="text-[10px] font-medium text-gray-400">giá trị ước tính</span></div>
                                        <div class="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/60 p-3 text-gray-700">
                                            <i class="fas fa-exchange-alt mr-1 text-emerald-700"></i>
                                            <span class="font-bold">Muốn đổi lấy:</span> ${escapeHtml(item.desiredExchange || 'Đồ có giá trị tương đương')}
                                            <div class="text-[10px] text-gray-500 mt-0.5">Nhận món trị giá ${formatMoney(low)} – ${formatMoney(high)}</div>
                                        </div>
                                        <div class="pt-1 flex items-center justify-between gap-2">
                                            <span class="text-gray-400 text-[10px] truncate"><i class="fas fa-map-marker-alt"></i> ${escapeHtml(item.location)}</span>
                                            ${mine
                                                ? `<span class="text-gray-400 font-semibold whitespace-nowrap">Tin của bạn</span>`
                                                : `<button onclick="openTradeOffer(${item.id})" class="flex-shrink-0 whitespace-nowrap rounded-xl bg-brand-600 px-4 py-2 font-bold text-white transition hover:bg-brand-700">Đề nghị đổi</button>`}
                                        </div>
                                    </div>
                                </article>`;
}

// Mở hộp thoại chọn món của mình để đổi lấy `targetId`
function openTradeOffer(targetId) {
    const target = products.find(p => p.id === targetId);
    if (!target) return;
    if (!state.user) {
        showToast('Vui lòng đăng nhập để gửi đề nghị đổi', 'error');
        promptLogin();
        return;
    }
    if (isAdminUser()) { showToast('Tài khoản quản trị chỉ dùng để kiểm tra và gỡ tin.', 'error'); return; }
    if (target.owner === state.user.username) { showToast('Đây là món đồ của bạn', 'error'); return; }
    if (target.type === 'buy') { showToast('Món này chỉ bán, không nhận trao đổi.', 'error'); return; }
    if (target.availability !== 'available') { showToast('Món này không còn nhận trao đổi.', 'error'); return; }

    const [low, high] = tradeRange(target.price);
    const mine = products.filter(p => p.owner === state.user.username && p.availability === 'available' && p.type !== 'buy');
    const fair = mine.filter(p => isFairTrade(p.price, target.price));
    const header = `
        <div class="flex items-start justify-between gap-3 border-b pb-3 mb-3">
            <div class="flex items-center gap-3 min-w-0">
                <img src="${escapeHtml(target.image)}" alt="" class="w-12 h-12 rounded object-cover bg-gray-100 flex-shrink-0">
                <div class="min-w-0"><div class="text-[10px] text-gray-400 uppercase font-bold">Bạn muốn nhận</div>
                    <div class="font-bold text-gray-800 truncate">${escapeHtml(target.name)}</div>
                    <div class="text-brand-800 font-bold">${formatMoney(target.price)}</div></div>
            </div>
            <button onclick="closeModal()" aria-label="Đóng" class="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
        </article>`;

    if (fair.length === 0) {
        openModal(`${header}
            <p class="text-gray-700 mb-2">Bạn chưa có món nào phù hợp để đổi lấy món này.</p>
            <p class="text-gray-500 mb-4">Món dùng để đổi phải do bạn đăng, đang để chế độ <strong>trao đổi</strong> hoặc <strong>vừa bán vừa đổi</strong>, và có giá từ <strong>${formatMoney(low)}</strong> đến <strong>${formatMoney(high)}</strong>.${mine.length ? ` Bạn đang có ${mine.length} món khác nhưng chưa nằm trong khoảng giá này.` : ''}</p>
            <div class="flex gap-2 justify-end">
                <button onclick="closeModal()" class="border border-gray-300 text-gray-700 font-bold px-4 py-2 rounded-lg hover:bg-gray-50">Để sau</button>
                <button onclick="closeModal(); switchChannel('seller')" class="rounded-xl bg-brand-600 px-4 py-2 font-bold text-white transition hover:bg-brand-700">Đăng món để đổi</button>
            </div>`);
        return;
    }
    openModal(`${header}
        <form onsubmit="submitTradeOffer(event, ${target.id})" class="space-y-3">
            <fieldset class="space-y-2">
                <legend class="font-bold text-gray-700 mb-1">Chọn món của bạn để đổi (giá ${formatMoney(low)} – ${formatMoney(high)})</legend>
                ${fair.map((p, i) => `
                    <label class="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-emerald-300 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50">
                        <input type="radio" name="offered" value="${p.id}" ${i === 0 ? 'checked' : ''} class="accent-emerald-600">
                        <img src="${escapeHtml(p.image)}" alt="" class="w-10 h-10 rounded object-cover bg-gray-100 flex-shrink-0">
                        <span class="flex-1 min-w-0 truncate">${escapeHtml(p.name)}</span>
                        <span class="font-bold text-brand-800 whitespace-nowrap">${formatMoney(p.price)}</span>
                    </label>`).join('')}
            </fieldset>
            <div>
                <label for="to-phone" class="font-bold text-gray-700 block mb-1">Số điện thoại của bạn *</label>
                <input id="to-phone" type="tel" required autocomplete="tel" placeholder="VD: 0901234567" class="w-full border rounded-lg p-2.5 focus:ring-1 focus:ring-amber-500 outline-none">
                <p class="text-gray-400 mt-1">Chỉ hiện cho chủ món khi họ đồng ý đổi.</p>
            </div>
            <div>
                <label for="to-message" class="font-bold text-gray-700 block mb-1">Lời nhắn</label>
                <textarea id="to-message" rows="2" maxlength="500" placeholder="VD: Món của mình còn bảo hành, có thể gặp trực tiếp ở Quận 1..." class="w-full border rounded-lg p-2.5 focus:ring-1 focus:ring-amber-500 outline-none"></textarea>
            </div>
            <div class="flex gap-2 justify-end">
                <button type="button" onclick="closeModal()" class="border border-gray-300 text-gray-700 font-bold px-4 py-2 rounded-lg hover:bg-gray-50">Hủy</button>
                <button type="submit" class="rounded-xl bg-brand-600 px-4 py-2 font-bold text-white transition hover:bg-brand-700 disabled:opacity-60">Gửi đề nghị đổi</button>
            </div>
        </form>`);
}

async function submitTradeOffer(e, targetId) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    try {
        await api(`/api/listings/${targetId}/offers`, {
            method: 'POST',
            body: JSON.stringify({
                offeredListingId: Number(e.target.elements.offered.value),
                phone: document.getElementById('to-phone').value,
                message: document.getElementById('to-message').value
            })
        });
        closeModal();
        state.activity.offers = null; // tải lại ở trang Đơn hàng
        showToast('Đã gửi đề nghị đổi. Theo dõi phản hồi ở mục Đơn hàng & trao đổi.');
    } catch (err) {
        if (err.status === 401) { closeModal(); state.user = null; renderUserBar(); promptLogin(); }
        showToast(err.message, 'error');
        if (btn) btn.disabled = false;
        if (err.status === 409 || err.status === 404) { await loadListings(); renderPage(); }
    }
}


// =====================================================
// TRANG CHI TIẾT SẢN PHẨM & TÍNH NĂNG KHÁC (GIỮ NGUYÊN)
// =====================================================
function renderDetail() {
    const product = products.find(p => p.id === state.selectedProductId);
    if (!product) {
        return `
                <div class="bg-white rounded-xl p-12 text-center text-gray-500 shadow-sm">
                    <i class="fas fa-box-open text-5xl text-gray-300 mb-3"></i>
                    <p class="text-base font-medium">Sản phẩm không tồn tại hoặc đã bị gỡ.</p>
                    <button onclick="navigateTo('home')" class="mt-4 bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-800 transition">Quay lại trang chính</button>
                </div>
            `;
    }
    const variants = product.variants && product.variants.length ? product.variants : ['Mặc định'];
    const categoryName = categories.find(category => category.id === product.category)?.name;
    const relatedProducts = products
        .filter(item => item.id !== product.id && item.category === product.category && item.availability === 'available')
        .slice(0, 4);
    const canBuy = !buyBlocker(product);
    const isMine = Boolean(state.user && product.owner === state.user.username);
    const canOffer = product.type !== 'buy' && product.availability === 'available' && !isMine && !isAdminUser();
    // Tin chỉ trao đổi còn nhận đổi: không hiện thông báo "không bán", chỉ hiện nút gửi đề nghị đổi
    const blocker = canBuy || canOffer ? null : buyBlocker(product);

    return `
                <div class="space-y-6">
                    <nav aria-label="Điều hướng đường dẫn" class="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <a href="#" onclick="navigateTo('home'); return false;" class="hover:text-brand-700">Trang chủ</a>
                        <i class="fas fa-chevron-right text-[8px]"></i>
                        ${categoryName ? `<button onclick="filterByCategory('${product.category}')" class="hover:text-brand-700">${escapeHtml(categoryName)}</button><i class="fas fa-chevron-right text-[8px]"></i>` : ''}
                        <span class="font-medium text-slate-800 line-clamp-1">${escapeHtml(product.name)}</span>
                    </nav>

                    <div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2 lg:gap-8">
                        <div class="space-y-3">
                            <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                                <img id="main-product-img" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" class="h-72 w-full rounded-xl bg-slate-50 object-contain sm:h-[28rem]">
                            </div>
                            <p class="text-center text-xs text-slate-500"><i class="fas fa-image mr-1 text-brand-600"></i> Ảnh sản phẩm do người đăng cung cấp</p>
                        </div>

                        <div class="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                            <div>
                                ${product.availability !== 'available' ? `
                                    <div class="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                                        ${statusBadge(product)}
                                        <span>Tin này không còn hiển thị trên chợ.</span>
                                    </div>
                                ` : ''}
                                <div class="mb-3 flex flex-wrap gap-2">
                                    ${categoryName ? `<span class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">${escapeHtml(categoryName)}</span>` : ''}
                                    <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Đồ đã qua sử dụng</span>
                                </div>
                                <h1 class="mb-4 break-words text-2xl font-extrabold leading-tight text-gray-900 sm:text-3xl">${escapeHtml(product.name)}</h1>

                                <div class="mb-5 flex flex-wrap items-center gap-3 border-b border-slate-100 pb-5 text-xs">
                                    <span class="rounded-full bg-brand-50 px-3 py-1 font-semibold text-brand-800">Mỗi tin một món</span>
                                    ${product.ownerName ? `
                                        <span class="inline-flex min-w-0 items-center gap-2 text-slate-600">
                                            <span class="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-brand-700"><i class="far fa-user"></i></span>
                                            <span class="truncate">Người đăng: <strong>${escapeHtml(product.ownerName)}</strong></span>
                                        </span>
                                    ` : ''}
                                    ${canManage(product) ? `
                                        <button onclick="deleteListing(${product.id})" class="ml-auto whitespace-nowrap text-red-600 hover:underline"><i class="far fa-trash-alt"></i> Gỡ tin</button>
                                    ` : ''}
                                </div>

                                <div class="mb-5 flex flex-wrap items-baseline gap-3 rounded-2xl bg-emerald-50 p-4">
                                    <span class="text-3xl font-extrabold text-brand-800 sm:text-4xl">${formatMoney(product.price)}</span>
                                    ${hasDiscount(product) ? `
                                        <span class="text-sm text-gray-400 line-through">${formatMoney(product.originalPrice)}</span>
                                        <span class="rounded-full bg-emerald-700 px-2.5 py-1 text-xs font-bold text-white">GIẢM ${escapeHtml(discountLabel(product).replace('-', ''))}</span>
                                    ` : (product.discount ? `<span class="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">${escapeHtml(product.discount)}</span>` : '')}
                                </div>

                                ${product.desiredExchange ? `
                                    <div class="mb-5 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
                                        <i class="fas fa-exchange-alt mr-1 text-emerald-700"></i> <strong>Nhu cầu trao đổi đồ:</strong> ${escapeHtml(product.desiredExchange)}
                                    </div>
                                ` : ''}

                                <div class="mb-5 space-y-4">
                                    ${variants.some(v => v !== 'Mặc định') ? `
                                    <div class="flex flex-wrap items-center gap-2 text-sm">
                                        <span class="font-bold text-slate-600">Tình trạng:</span>
                                        ${variants.map(v => `<span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">${escapeHtml(v)}</span>`).join('')}
                                    </div>` : ''}
                                    ${product.location ? `<p class="text-sm text-slate-500"><i class="fas fa-map-marker-alt mr-1.5 text-brand-600"></i>${escapeHtml(product.location)}</p>` : ''}
                                    <p class="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600"><i class="fas fa-info-circle mr-1 text-brand-600"></i> Mỗi tin chỉ có một món. Khi có người đặt, món sẽ được giữ cho người đó tới khi giao dịch xong.</p>
                                </div>
                            </div>

                            ${blocker ? `
                                <div class="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 pt-4 text-sm text-gray-600">
                                    <i class="fas fa-ban text-gray-400"></i> ${escapeHtml(blocker)}
                                </div>` : !canBuy ? '' : `
                                <div class="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row">
                                    <button onclick="addToCart(${product.id})" class="flex flex-1 items-center justify-center gap-2 rounded-xl border border-brand-600 py-3 text-sm font-bold text-brand-700 transition hover:bg-brand-50">
                                        <i class="fas fa-cart-plus"></i> Thêm Vào Giỏ Hàng
                                    </button>
                                    <button onclick="buyNow(${product.id})" class="flex-1 rounded-xl bg-brand-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700">
                                        Mua Ngay
                                    </button>
                                </div>`}
                            ${canOffer ? `
                                <button onclick="openTradeOffer(${product.id})" class="mt-3 w-full rounded-xl bg-emerald-50 py-3 text-sm font-bold text-emerald-800 ring-1 ring-emerald-200 transition hover:bg-emerald-100">
                                    <i class="fas fa-exchange-alt mr-1"></i> Đề nghị đổi ngang giá
                                </button>
                                <p class="text-[11px] text-gray-500 mt-1.5 text-center">Đổi bằng món của bạn có giá ${formatMoney(tradeRange(product.price)[0])} – ${formatMoney(tradeRange(product.price)[1])}.</p>` : ''}
                        </div>
                    </div>

                    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                        <h2 class="text-lg font-bold text-gray-900">Mô tả sản phẩm</h2>
                        <p class="mt-3 max-w-4xl whitespace-pre-line break-words text-sm leading-7 text-slate-600">${escapeHtml(product.description || 'Người đăng chưa bổ sung mô tả.')}</p>
                    </section>
                    ${relatedProducts.length ? `
                        <section aria-labelledby="related-products-heading">
                            <h2 id="related-products-heading" class="mb-4 text-xl font-bold text-gray-900">Sản phẩm cùng danh mục</h2>
                            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
                                ${relatedProducts.map(item => `
                                    <button onclick="navigateTo('detail', ${item.id})" class="overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                                        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy" class="h-32 w-full bg-slate-100 object-cover sm:h-40">
                                        <span class="block p-3"><span class="line-clamp-2 block text-sm font-semibold text-gray-800">${escapeHtml(item.name)}</span><span class="mt-2 block text-sm font-extrabold text-brand-700">${formatMoney(item.price)}</span></span>
                                    </button>
                                `).join('')}
                            </div>
                        </section>
                    ` : ''}
                </div>
            `;
}

function renderCart() {
    const total = state.cart.reduce((sum, item) => sum + item.price, 0);

    return `
                <div class="space-y-5">
                    <div class="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <p class="text-xs font-semibold uppercase tracking-wider text-brand-700">ReLoop Marketplace</p>
                            <h1 class="mt-1 flex items-center gap-2 text-2xl font-extrabold text-gray-900 sm:text-3xl">
                                Giỏ hàng <span class="text-base font-medium text-slate-500">(${state.cart.length} món)</span>
                            </h1>
                        </div>
                        <button onclick="navigateTo('home')" class="text-sm font-semibold text-brand-700 hover:text-brand-800"><i class="fas fa-arrow-left mr-1"></i> Tiếp tục mua sắm</button>
                    </div>

                    ${state.cart.length === 0 ? `
                        <div class="rounded-2xl border border-slate-200 bg-white px-5 py-14 text-center shadow-sm">
                            <span class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-3xl text-brand-600"><i class="fas fa-shopping-basket"></i></span>
                            <p class="mt-4 font-semibold text-slate-600">Giỏ hàng của bạn đang trống.</p>
                            <button onclick="navigateTo('home')" class="mt-5 rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-brand-700">
                                Tiếp Tục Mua Sắm
                            </button>
                        </div>
                    ` : `
                        <div class="grid items-start gap-5 lg:grid-cols-[1fr_340px]">
                            <div class="space-y-3">
                                ${state.cart.map((item, idx) => `
                                    <article class="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:gap-4 sm:p-4">
                                        <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="h-20 w-20 flex-shrink-0 cursor-pointer rounded-xl border border-slate-100 bg-slate-50 object-cover sm:h-24 sm:w-24" onclick="navigateTo('detail', ${item.id})">
                                        <div class="min-w-0 flex-1">
                                            <h2 class="line-clamp-2 text-sm font-bold text-gray-900 sm:text-base">${escapeHtml(item.name)}</h2>
                                            <p class="mt-1 text-xs text-slate-500">Sản phẩm đã qua sử dụng · 1 món</p>
                                            <p class="mt-2 text-base font-extrabold text-brand-700">${formatMoney(item.price)}</p>
                                        </div>
                                        <button onclick="removeFromCart(${idx})" aria-label="Xóa ${escapeHtml(item.name)} khỏi giỏ" class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600">
                                            <i class="far fa-trash-alt"></i>
                                        </button>
                                    </article>
                                `).join('')}
                            </div>
                            <aside class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-36">
                                <h2 class="text-lg font-bold text-gray-900">Tóm tắt đơn hàng</h2>
                                <div class="mt-4 flex justify-between gap-3 border-b border-slate-100 pb-4 text-sm">
                                    <span class="text-slate-500">Tạm tính (${state.cart.length} món)</span>
                                    <span class="font-semibold text-gray-800">${formatMoney(total)}</span>
                                </div>
                                <div class="mt-4 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 p-3">
                                    <span class="font-bold text-gray-900">Tổng cộng</span>
                                    <span class="text-lg font-extrabold text-brand-800">${formatMoney(total)}</span>
                                </div>
                                <p class="mt-3 text-xs leading-5 text-slate-500">Số lượng mỗi tin là một món đồ duy nhất.</p>
                                <button onclick="navigateTo('checkout')" class="mt-4 w-full rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700">
                                    Tiến hành đặt hàng <i class="fas fa-arrow-right ml-1"></i>
                                </button>
                            </aside>
                        </div>
                    `}
                </div>
            `;
}

// =====================================================
// ĐỊNH GIÁ AI & CHECKOUT (GIỮ NGUYÊN)
// =====================================================
const AI_CONFIG = { endpoint: '/api/valuate', maxImages: 3, maxSizePx: 1024, jpegQuality: 0.85 };
state.ai = { images: [], note: '', originalPrice: '', usedFor: '', loading: false, result: null, error: null };

function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Không đọc được ảnh'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('File không phải ảnh hợp lệ'));
            img.onload = () => {
                const scale = Math.min(1, AI_CONFIG.maxSizePx / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext('2d');
                // Nền trắng: ảnh PNG/WEBP trong suốt khi chuyển sang JPEG sẽ không bị nền đen
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', AI_CONFIG.jpegQuality);
                resolve({ dataUrl, base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleAIImages(input) {
    const files = Array.from(input.files || []);
    input.value = ''; // cho phép chọn lại cùng một file
    if (!files.length) return;
    const room = AI_CONFIG.maxImages - state.ai.images.length;
    if (room <= 0) { showToast(`Tối đa ${AI_CONFIG.maxImages} ảnh`, 'error'); return; }
    if (files.length > room) showToast(`Chỉ nhận thêm ${room} ảnh (tối đa ${AI_CONFIG.maxImages})`, 'error');
    let added = 0;
    for (const f of files.slice(0, room)) {
        if (!f.type.startsWith('image/')) { showToast('Chỉ nhận file ảnh', 'error'); continue; }
        try {
            state.ai.images.push(await compressImage(f));
            added++;
        } catch (err) { showToast(err.message, 'error'); }
    }
    if (added) {
        state.ai.result = null; state.ai.error = null;
        renderPage();
    }
}

function removeAIImage(index) {
    if (state.ai.loading) return;
    state.ai.images.splice(index, 1);
    state.ai.result = null;
    state.ai.error = null;
    renderPage();
}

function resetAIValuation() {
    state.ai = { images: [], note: '', originalPrice: '', usedFor: '', loading: false, result: null, error: null };
}

function updateAIField(field, value) {
    state.ai[field] = value;
}

// Sửa model AI đoán sai chỉ bằng một chạm: ghi model vào đầu ô Ghi chú rồi định giá lại
function revaluateWithModel(model) {
    const value = String(model || '').trim();
    if (!value) return;
    const rest = state.ai.note.replace(/^Model: .*(\n|$)/, '');
    state.ai.note = `Model: ${value}${rest ? `\n${rest}` : ''}`;
    runAIValuation();
}

// Khung "AI đoán là X": các model khác có thể là, kèm ô tự gõ model đúng
function renderModelFix(r) {
    const candidates = (Array.isArray(r.model_candidates) ? r.model_candidates : [])
        .filter(m => m && m !== r.model).slice(0, 3);
    if (!r.model_assumed && !(r.requires_more_info && candidates.length)) return '';
    return `
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs space-y-2">
            <p class="text-amber-900">${r.model
                ? `AI đoán đây là <strong>${escapeHtml(r.model)}</strong> (độ chắc chắn ${Math.round((r.identification_confidence || 0) * 100)}%). Không đúng? Chọn model khác:`
                : 'Có thể là một trong các model sau:'}</p>
            <div class="flex flex-wrap gap-1.5">
                ${candidates.map(m => `<button type="button" data-model="${escapeHtml(m)}" onclick="revaluateWithModel(this.dataset.model)" class="bg-white border border-amber-300 text-amber-900 font-semibold px-2.5 py-1 rounded-full hover:bg-amber-100">${escapeHtml(m)}</button>`).join('')}
            </div>
            <form onsubmit="event.preventDefault(); revaluateWithModel(this.model.value)" class="flex gap-1.5">
                <input name="model" type="text" maxlength="100" placeholder="Hoặc gõ model đúng, vd: iPhone 17 Pro 256GB" class="flex-1 min-w-0 border rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-amber-500 outline-none">
                <button type="submit" class="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded-lg whitespace-nowrap">Định giá lại</button>
            </form>
        </div>`;
}

async function runAIValuation() {
    const ai = state.ai;
    if (ai.loading) return; // chống bấm nhiều lần gửi trùng request
    if (!ai.images || ai.images.length === 0) {
        showToast("Vui lòng tải ảnh sản phẩm trước", "error");
        return;
    }
    // Máy chủ (Vercel) giới hạn mỗi request khoảng 4 MB
    const totalBase64 = ai.images.reduce((sum, img) => sum + img.base64.length, 0);
    if (totalBase64 > 3.8 * 1024 * 1024) {
        showToast("Tổng dung lượng ảnh quá lớn, vui lòng bớt ảnh", "error");
        return;
    }
    ai.loading = true;
    ai.error = null;
    ai.result = null;
    renderPage();

    try {
        const response = await fetch(AI_CONFIG.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                images: ai.images.map(img => ({
                    base64: img.base64,
                    mediaType: img.mediaType
                })),
                note: ai.note || "",
                originalPrice: Number(ai.originalPrice) > 0 ? Number(ai.originalPrice) : null,
                usedFor: ai.usedFor || ""
            })
        });

        // Máy chủ/proxy có thể trả HTML (502, 504...) thay vì JSON
        let data = null;
        try { data = await response.json(); } catch { data = null; }
        if (!response.ok) {
            if (response.status === 429) throw new Error((data && data.error) || "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.");
            throw new Error((data && data.error) || `Máy chủ định giá đang gặp sự cố (mã ${response.status}).`);
        }
        if (!data) throw new Error("Máy chủ trả về dữ liệu không hợp lệ.");
        ai.result = data;
    } catch (error) {
        ai.error = error instanceof TypeError
            ? "Không thể kết nối máy chủ định giá. Vui lòng kiểm tra mạng và thử lại."
            : (error.message || "Không thể kết nối máy chủ");
    } finally {
        ai.loading = false;
        // Chỉ vẽ lại nếu người dùng vẫn đang ở trang định giá
        if (state.currentPage === 'ai-valuation') renderPage();
    }
}

const CATEGORY_GUESS = [
    { id: 'thoi-trang', re: /\b(thoi trang|quan|ao|giay|dep|tui xach|fashion|clothing|shoes?|bags?)\b/ },
    { id: 'gia-dung', re: /\b(gia dung|nha cua|do bep|noi|chao|quat|may loc|tu lanh|may giat|ghe|home|kitchen|furniture|appliance)\b/ },
    { id: 'my-pham', re: /\b(my pham|lam dep|suc khoe|son moi|kem|nuoc hoa|beauty|cosmetics?|health)\b/ }
];

function guessCategory(text) {
    const t = normalizeSearch(text);
    const hit = CATEGORY_GUESS.find(c => c.re.test(t));
    return hit ? hit.id : 'dien-tu';
}

async function publishAIProduct() {
    if (publishing) return;
    const r = state.ai.result;
    if (!r || !r.price) return;
    if (!state.user) {
        showToast('Vui lòng đăng nhập để đăng bán', 'error');
        promptLogin('ai-valuation');
        return;
    }
    const grade = r.condition?.grade || 'Chưa xác định';
    const score = Number.isFinite(r.condition?.score) ? ` (${r.condition.score}/100)` : '';
    publishing = true;
    try {
        const data = await api('/api/listings', {
            method: 'POST',
            body: JSON.stringify({
                // Gửi dữ liệu thô; việc escape được thực hiện khi render để tránh hiển thị "&amp;"
                name: String(r.product_name || 'Sản phẩm đã qua sử dụng'),
                price: r.price.suggested,
                originalPrice: Number(state.ai.originalPrice) > r.price.suggested ? Number(state.ai.originalPrice) : r.price.suggested,
                discount: 'Đồ cũ',
                category: guessCategory(`${r.category || ''} ${r.product_name || ''}`),
                type: 'buy',
                image: state.ai.images[0]?.dataUrl || '',
                variants: [grade],
                description: `Tình trạng: ${grade}${score}.` +
                    (Array.isArray(r.condition?.defects) && r.condition.defects.length ? `\nKhuyết điểm: ${r.condition.defects.join(', ')}.` : '') +
                    (state.ai.note ? `\n${state.ai.note}` : '')
            })
        });
        resetAIValuation();
        if (!products.some(p => p.id === data.listing.id)) products.unshift(data.listing);
        showToast(data.listing.duplicate ? 'Tin này bạn vừa đăng rồi nên không tạo thêm.' : 'Đã đăng sản phẩm thành công!',
            data.listing.duplicate ? 'error' : 'success');
        navigateTo('detail', data.listing.id);
    } catch (err) {
        if (err.status === 401) { state.user = null; renderUserBar(); promptLogin('ai-valuation'); }
        showToast(err.message, 'error');
    } finally {
        publishing = false;
    }
}

function renderAISources(r) {
    const sources = Array.isArray(r.sources) ? r.sources.filter(s => /^https?:\/\//i.test(s.url || '')) : [];
    if (!sources.length) return '';
    return `
        <div class="pt-3 border-t">
            <p class="font-semibold text-xs mb-2 text-gray-700">Nguồn giá tham khảo</p>
            <ul class="space-y-2 text-xs">
                ${sources.map(s => `
                    <li class="break-words">
                        <a class="text-blue-700 underline" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url)}</a>
                        ${Array.isArray(s.prices_vnd) && s.prices_vnd.length
                            ? `<span class="text-gray-600"> — ${s.prices_vnd.map(p => formatMoney(p)).join(", ")}</span>`
                            : ""}
                    </li>`).join("")}
            </ul>
            ${r.market_data_note ? `<p class="text-[11px] text-gray-500 mt-2">${escapeHtml(r.market_data_note)}</p>` : ''}
        </div>`;
}

function renderAIResult() {
    const ai = state.ai;
    if (ai.loading) {
        return `<div role="status" aria-live="polite" class="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm"><span class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50"><i class="fas fa-circle-notch fa-spin text-2xl text-brand-600"></i></span><p class="mt-4 text-sm font-semibold text-gray-800">AI đang phân tích ảnh và tìm giá thị trường...</p><p class="mt-1 text-xs text-slate-500">Quá trình này có thể mất 10–30 giây.</p></div>`;
    }
    if (ai.error) {
        return `<div role="alert" class="rounded-2xl border border-red-200 bg-white p-5 text-xs text-red-700 shadow-sm"><p class="mb-3 break-words font-bold">Không định giá được: ${escapeHtml(ai.error)}</p><button onclick="runAIValuation()" class="rounded-xl bg-red-600 px-4 py-2 font-semibold text-white transition hover:bg-red-700">Thử lại</button></div>`;
    }
    const r = ai.result;
    if (!r) {
        return `<div class="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400 shadow-sm"><span class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50"><i class="fas fa-wand-magic-sparkles text-2xl text-brand-500"></i></span><p class="mt-4 text-sm">Kết quả định giá sẽ hiển thị tại đây sau khi phân tích.</p></div>`;
    }
    if (!r.price) {
        // Lỗi tạm thời của dịch vụ (hết lượt/quá tải): chỉ cần thử lại, không bắt người dùng bổ sung thông tin
        const serviceIssue = r.price_unavailable_reason === 'service';
        return `
            <div class="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 class="font-bold text-gray-800">${escapeHtml(r.product_name || "Sản phẩm")}</h3>
                ${serviceIssue ? `
                    <div class="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <i class="fas fa-exclamation-triangle mt-0.5"></i>
                        <span>Đã nhận diện được sản phẩm nhưng chưa lấy được giá: ${escapeHtml(r.reasoning || "dịch vụ tìm giá đang bận")}</span>
                    </div>
                ` : `<p class="text-sm text-gray-700">${escapeHtml(r.reasoning || "Chưa đủ dữ liệu giá thị trường.")}</p>`}
                <p class="text-xs text-gray-500">Tình trạng: ${escapeHtml(r.condition?.grade || "Chưa xác định")}</p>
                ${serviceIssue ? '' : renderModelFix(r)}
                ${!serviceIssue && Array.isArray(r.questions) && r.questions.length
                    ? `<div><p class="font-semibold text-sm mb-1">Cần bổ sung</p><ul class="list-disc pl-5 text-sm">${r.questions.map(q => `<li>${escapeHtml(q)}</li>`).join("")}</ul></div>`
                    : ""}
                ${serviceIssue ? '' : `<p class="text-xs text-gray-500">Bổ sung thông tin vào ô "Ghi chú" bên trái rồi bấm Thử Lại.</p>`}
                ${renderAISources(r)}
                <button onclick="runAIValuation()" class="mt-2 w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700">Thử lại</button>
            </div>
        `;
    }
    const grade = r.condition?.grade || 'Chưa xác định';
    const score = Number.isFinite(r.condition?.score) ? ` (${r.condition.score}/100)` : '';
    return `
        <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div class="border-b border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5">
                <p class="text-xs font-bold uppercase tracking-wider text-emerald-700">Giá tham khảo</p>
                <p class="mt-1 text-3xl font-black text-emerald-800">${formatMoney(r.price.suggested)}</p>
                <p class="mt-1 text-xs text-slate-600">Khoảng giá: ${formatMoney(r.price.min)} – ${formatMoney(r.price.max)}</p>
                ${r.price_basis === 'new_price_depreciated' ? `<p class="mt-2 inline-block rounded-lg bg-white px-2 py-1 text-[11px] text-slate-600 ring-1 ring-emerald-100">Ước tính từ giá bán mới (chưa có tin rao đồ cũ)</p>` : ''}
            </div>
            <div class="p-5 space-y-4 text-sm">
                <h3 class="font-bold text-gray-800">${escapeHtml(r.product_name)}</h3>
                <div class="text-xs text-gray-600"><span class="font-semibold">Tình trạng:</span> ${escapeHtml(grade)}${score}</div>
                ${renderModelFix(r)}
                ${Array.isArray(r.questions) && r.questions.length ? `<p class="text-xs text-gray-500">Để giá sát hơn: ${r.questions.map(escapeHtml).join(' ')}</p>` : ''}
                <p class="text-xs text-gray-500">${escapeHtml(r.reasoning || "")}</p>
                ${renderAISources(r)}
                <p class="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">Đây là mức tham khảo do AI hỗ trợ ước tính, không đảm bảo giá giao dịch thực tế.</p>
                <button onclick="publishAIProduct()" class="w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700">Đăng bán với giá này</button>
            </div>
        </div>
    `;
}
function renderAIValuation() {
    const ai = state.ai;
    return `
                <div class="space-y-5">
                    <div class="flex items-center gap-2 text-xs text-gray-500">
                        <a href="#" onclick="navigateTo('home'); return false;" class="hover:text-brand-700">Trang chủ</a>
                        <i class="fas fa-chevron-right text-[8px]"></i>
                        <span class="text-gray-800 font-medium">Định giá AI</span>
                    </div>

                    <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
                        <div class="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                            <div><p class="text-xs font-semibold uppercase tracking-wider text-brand-700">ReLoop AI</p><h1 class="mt-1 text-xl font-bold text-gray-900">Định giá đồ cũ bằng AI</h1><p class="mt-2 text-sm leading-6 text-slate-500">Tải ảnh và chia sẻ thêm thông tin để nhận mức giá tham khảo.</p></div>
                            <div class="grid grid-cols-3 gap-3">
                                ${ai.images.map((img, i) => `
                                    <div class="relative aspect-square overflow-hidden rounded-xl border border-slate-200">
                                        <img src="${img.dataUrl}" alt="Ảnh sản phẩm ${i + 1}" class="w-full h-full object-cover">
                                        <button onclick="removeAIImage(${i})" aria-label="Xóa ảnh" class="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full w-6 h-6 text-xs flex items-center justify-center ${ai.loading ? 'hidden' : ''}"><i class="fas fa-times"></i></button>
                                    </div>
                                `).join('')}
                                ${ai.images.length < AI_CONFIG.maxImages && !ai.loading ? `
                                    <label class="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50 text-center text-xs text-emerald-800 transition hover:bg-emerald-100">
                                        <i class="fas fa-camera text-2xl"></i>
                                        <span class="font-semibold">Chọn Ảnh</span>
                                        <span class="text-[10px] text-brand-600">${ai.images.length}/${AI_CONFIG.maxImages}</span>
                                        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple class="hidden" onchange="handleAIImages(this)">
                                    </label>
                                ` : ''}
                            </div>
                            <div class="space-y-3 text-xs">
                                <div>
                                    <label class="font-bold text-gray-700 block mb-1">Ghi chú (tên, hãng, model, tình trạng...)</label>
                                    <textarea rows="2" maxlength="1500" placeholder="VD: iPhone 12 Pro 128GB, pin 85%, trầy nhẹ viền" oninput="updateAIField('note', this.value)" ${ai.loading ? 'disabled' : ''}
                                        class="w-full border rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-brand-600 outline-none disabled:bg-gray-50">${escapeHtml(ai.note)}</textarea>
                                </div>
                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label class="font-bold text-gray-700 block mb-1">Giá mua ban đầu (VNĐ)</label>
                                        <input type="number" min="0" placeholder="VD: 15000000" value="${escapeHtml(ai.originalPrice)}" oninput="updateAIField('originalPrice', this.value)" ${ai.loading ? 'disabled' : ''}
                                            class="w-full border rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-brand-600 outline-none disabled:bg-gray-50">
                                    </div>
                                    <div>
                                        <label class="font-bold text-gray-700 block mb-1">Thời gian đã dùng</label>
                                        <input type="text" maxlength="500" placeholder="VD: 1 năm" value="${escapeHtml(ai.usedFor)}" oninput="updateAIField('usedFor', this.value)" ${ai.loading ? 'disabled' : ''}
                                            class="w-full border rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-brand-600 outline-none disabled:bg-gray-50">
                                    </div>
                                </div>
                            </div>
                            <button onclick="runAIValuation()" ${ai.loading || ai.images.length === 0 ? 'disabled' : ''} class="w-full rounded-xl bg-brand-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">
                                ${ai.loading ? '<i class="fas fa-circle-notch fa-spin"></i> Đang Định Giá...' : '<i class="fas fa-magic"></i> Định Giá Bằng AI'}
                            </button>
                        </div>
                        <div>${renderAIResult()}</div>
                    </div>
                </div>
            `;
}

// Đồ cũ chỉ có 1 món mỗi tin: thêm lại món đã có trong giỏ thì chỉ báo là đã có
function addToCart(productId, silent = false) {
    const product = products.find(p => p.id === productId);
    const blocker = buyBlocker(product);
    if (blocker) { showToast(blocker, 'error'); return false; }

    if (state.cart.some(item => item.id === productId)) {
        if (!silent) showToast('Món này đã có trong giỏ hàng');
        return true;
    }
    state.cart.push({ id: product.id, name: product.name, price: product.price, image: product.image });
    saveCart();
    if (!silent) showToast('Đã thêm sản phẩm vào giỏ hàng!');
    return true;
}

function buyNow(productId) {
    if (addToCart(productId, true)) navigateTo('checkout');
}

function removeFromCart(idx) {
    state.cart.splice(idx, 1);
    saveCart();
    renderPage();
    showToast('Đã xóa sản phẩm khỏi giỏ hàng!');
}

function renderCheckout() {
    const total = state.cart.reduce((sum, item) => sum + item.price, 0);
    if (!state.user) {
        return `
                <div class="bg-white rounded-2xl shadow-sm p-8 text-center max-w-lg mx-auto border border-slate-200">
                <div class="w-14 h-14 rounded-2xl bg-brand-50 text-brand-700 flex items-center justify-center text-2xl mx-auto mb-3"><i class="fas fa-lock"></i></div>
                    <h2 class="text-base font-bold text-gray-800 mb-1">Đăng nhập để đặt hàng</h2>
                    <p class="text-xs text-gray-500 mb-5">Đơn hàng được gắn với tài khoản để người bán xác nhận và bạn theo dõi giao hàng.</p>
                    <div class="flex flex-wrap justify-center gap-2">
                        <button onclick="promptLogin('checkout')" class="bg-brand-700 hover:bg-brand-800 text-white px-6 py-2.5 rounded-lg text-sm font-bold shadow transition">Đăng nhập</button>
                        <button onclick="promptRegister('checkout')" class="border-2 border-brand-700 text-brand-800 hover:bg-brand-50 px-6 py-2 rounded-lg text-sm font-bold transition">Đăng ký</button>
                    </div>
                </div>
            `;
    }
    if (state.cart.length === 0) {
        return `
                <div class="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm max-w-2xl mx-auto space-y-4 text-xs text-center">
                    <h1 class="text-lg font-bold text-gray-800 border-b pb-3 text-left">Thanh Toán Đơn Hàng Escrow</h1>
                    <p class="text-gray-500 py-4">Giỏ hàng đang trống, chưa có gì để thanh toán.</p>
                    <button onclick="navigateTo('home')" class="bg-brand-700 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-brand-800 transition">Tiếp Tục Mua Sắm</button>
                </div>
            `;
    }
    return `
                <div class="mx-auto max-w-3xl space-y-5">
                    <div class="flex flex-wrap items-end justify-between gap-3">
                        <div><p class="text-xs font-semibold uppercase tracking-wider text-brand-700">Đơn hàng</p><h1 class="mt-1 text-2xl font-extrabold text-gray-900">Thông tin nhận hàng</h1></div>
                        <button onclick="navigateTo('cart')" class="text-xs font-semibold text-brand-700 hover:text-brand-800"><i class="fas fa-arrow-left mr-1"></i> Về giỏ hàng</button>
                    </div>
                    <div class="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 text-xs shadow-sm sm:p-7">
                    <h2 class="text-base font-bold text-gray-900">Xác nhận đơn hàng</h2>
                    <p class="text-sm leading-6 text-slate-600">Vui lòng cung cấp thông tin để người bán có thể phối hợp xác nhận đơn hàng và giao nhận.</p>
                    <ul class="divide-y divide-slate-100 rounded-xl border border-slate-200">
                        ${state.cart.map(item => `
                            <li class="flex items-center gap-3 p-3">
                                <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" class="h-12 w-12 flex-shrink-0 rounded-lg bg-slate-100 object-cover">
                                <span class="min-w-0 flex-1 truncate font-medium text-slate-700">${escapeHtml(item.name)}</span>
                                <span class="whitespace-nowrap font-bold text-brand-800">${formatMoney(item.price)}</span>
                            </li>`).join('')}
                    </ul>
                    <div class="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                        <span class="font-semibold text-slate-700">Tổng tiền (${state.cart.length} món)</span>
                        <span class="text-lg font-black text-brand-800">${formatMoney(total)}</span>
                    </div>
                    <form onsubmit="submitOrder(event)" class="space-y-3">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label for="co-phone" class="font-bold text-gray-700 block mb-1">Số điện thoại *</label>
                                <input id="co-phone" type="tel" required autocomplete="tel" placeholder="VD: 0901234567" class="w-full border rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-brand-600 outline-none">
                            </div>
                            <div>
                                <label for="co-address" class="font-bold text-gray-700 block mb-1">Địa chỉ nhận hàng *</label>
                                <input id="co-address" type="text" required maxlength="300" autocomplete="street-address" placeholder="Số nhà, đường, quận, tỉnh" class="w-full border rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-brand-600 outline-none">
                            </div>
                        </div>
                        <div>
                            <label for="co-note" class="font-bold text-gray-700 block mb-1">Ghi chú cho người bán</label>
                            <input id="co-note" type="text" maxlength="500" placeholder="VD: giao giờ hành chính" class="w-full border rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-brand-600 outline-none">
                        </div>
                        <button type="submit" class="w-full bg-brand-700 hover:bg-brand-800 text-white font-bold py-3 rounded-xl shadow transition disabled:opacity-60">Xác Nhận Đặt Hàng</button>
                    </form>
                    </div>
                </div>
            `;
}

// Máy chủ giữ chỗ tất cả món trong một lần; món nào đã có người mua thì cả đơn bị từ chối kèm danh sách món đó
async function submitOrder(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
        await api('/api/orders', {
            method: 'POST',
            body: JSON.stringify({
                items: state.cart.map(item => ({ listingId: item.id })),
                phone: document.getElementById('co-phone').value,
                address: document.getElementById('co-address').value,
                note: document.getElementById('co-note').value
            })
        });
        state.cart = [];
        saveCart();
        state.activity.orders = null;
        await loadListings();
        navigateTo('order-success');
    } catch (err) {
        if (err.status === 401) { state.user = null; renderUserBar(); promptLogin('checkout'); }
        if (err.status === 409 && Array.isArray(err.unavailable)) {
            const gone = new Set(err.unavailable.map(u => u.id));
            state.cart = state.cart.filter(item => !gone.has(item.id));
            saveCart();
            await loadListings();
            renderPage();
            showToast(`Đã bỏ khỏi giỏ các món không còn mua được. Vui lòng kiểm tra lại đơn.`, 'error');
            return;
        }
        showToast(err.message, 'error');
        if (btn) btn.disabled = false;
    }
}

// =====================================================
// ĐƠN HÀNG & ĐỀ NGHỊ TRAO ĐỔI
// =====================================================
const ORDER_STATUS = {
    pending: ['Chờ người bán xác nhận', 'bg-yellow-100 text-yellow-800'],
    confirmed: ['Đang giao', 'bg-blue-100 text-blue-800'],
    completed: ['Hoàn tất', 'bg-green-100 text-green-800'],
    cancelled: ['Đã hủy', 'bg-gray-200 text-gray-600']
};
const OFFER_STATUS = {
    pending: ['Chờ phản hồi', 'bg-yellow-100 text-yellow-800'],
    accepted: ['Đã chấp nhận', 'bg-green-100 text-green-800'],
    rejected: ['Bị từ chối', 'bg-red-100 text-red-700'],
    withdrawn: ['Đã rút', 'bg-gray-200 text-gray-600']
};

function badge([label, cls]) {
    return `<span class="${cls} rounded-full px-2.5 py-1 text-[10px] font-bold whitespace-nowrap">${label}</span>`;
}

async function loadActivity() {
    if (!state.user) return;
    state.activity.loading = true;
    state.activity.error = null;
    try {
        const [orders, offers] = await Promise.all([api('/api/orders'), api('/api/offers')]);
        state.activity.orders = orders;
        state.activity.offers = offers;
    } catch (err) {
        state.activity.error = err.message;
    } finally {
        state.activity.loading = false;
        if (['orders', 'home'].includes(state.currentPage)) renderPage();
    }
}

function openActivity(tab) {
    state.activity.tab = tab;
    state.activity.orders = null; // luôn tải mới khi mở
    navigateTo('orders');
}

function switchActivityTab(tab) {
    state.activity.tab = tab;
    renderPage();
}

async function orderAction(id, action) {
    const confirmText = {
        cancel: 'Hủy đơn hàng này? Món đồ sẽ quay lại chợ.',
        complete: 'Xác nhận bạn đã nhận được hàng? Tiền sẽ được chuyển cho người bán.'
    }[action];
    if (confirmText && !confirm(confirmText)) return;
    try {
        await api(`/api/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) });
        showToast({ confirm: 'Đã xác nhận đơn hàng', complete: 'Giao dịch hoàn tất!', cancel: 'Đã hủy đơn hàng' }[action]);
        await Promise.all([loadActivity(), loadListings()]);
    } catch (err) {
        showToast(err.message, 'error');
        loadActivity();
    }
}

// Chấp nhận đổi cần để lại số điện thoại cho bên kia, nên hỏi trong hộp thoại
function offerAction(id, action) {
    if (action !== 'accept') return sendOfferAction(id, action);
    const offer = (state.activity.offers?.received || []).find(o => o.id === id);
    if (!offer) return;
    openModal(`
        <h3 class="font-bold text-base text-gray-800 mb-3">Chấp nhận đổi?</h3>
        <div class="space-y-1 mb-3 text-gray-600">
            <p>Bạn đưa: <strong>${escapeHtml(offer.listingName)}</strong> (${formatMoney(offer.listingPrice)})</p>
            <p>Bạn nhận: <strong>${escapeHtml(offer.offeredItem)}</strong> (${formatMoney(offer.offeredPrice)}) từ ${escapeHtml(offer.proposerName)}</p>
            <p class="text-gray-400">Sau khi chấp nhận, cả hai món biến khỏi chợ, các đề nghị khác liên quan bị từ chối và hai bên thấy số điện thoại của nhau.</p>
        </div>
        <form onsubmit="confirmAcceptOffer(event, ${id})" class="space-y-3">
            <div>
                <label for="ao-phone" class="font-bold text-gray-700 block mb-1">Số điện thoại của bạn *</label>
                <input id="ao-phone" type="tel" required autocomplete="tel" placeholder="VD: 0901234567" class="w-full border rounded-lg p-2.5 focus:ring-1 focus:ring-amber-500 outline-none">
            </div>
            <div class="flex gap-2 justify-end">
                <button type="button" onclick="closeModal()" class="border border-gray-300 text-gray-700 font-bold px-4 py-2 rounded-lg hover:bg-gray-50">Để sau</button>
                <button type="submit" class="rounded-xl bg-brand-600 px-4 py-2 font-bold text-white transition hover:bg-brand-700 disabled:opacity-60">Đồng ý đổi</button>
            </div>
        </form>`);
}

async function confirmAcceptOffer(e, id) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    const ok = await sendOfferAction(id, 'accept', document.getElementById('ao-phone').value);
    if (ok) closeModal();
    else if (btn) btn.disabled = false;
}

async function sendOfferAction(id, action, phone) {
    try {
        await api(`/api/offers/${id}`, { method: 'PATCH', body: JSON.stringify({ action, phone }) });
        showToast({ accept: 'Đã đồng ý đổi! Hai bên đã thấy số điện thoại của nhau.', reject: 'Đã từ chối đề nghị', withdraw: 'Đã rút đề nghị' }[action]);
        await Promise.all([loadActivity(), loadListings()]);
        return true;
    } catch (err) {
        showToast(err.message, 'error');
        loadActivity();
        return false;
    }
}

function offerRow(o, role) {
    const pending = o.status === 'pending';
    const give = role === 'received'
        ? { name: o.listingName, image: o.listingImage, price: o.listingPrice }
        : { name: o.offeredItem, image: o.offeredImage, price: o.offeredPrice };
    const get = role === 'received'
        ? { name: o.offeredItem, image: o.offeredImage, price: o.offeredPrice }
        : { name: o.listingName, image: o.listingImage, price: o.listingPrice };
    const side = (label, item) => `
        <div class="flex min-w-0 flex-1 items-center gap-2">
            <img src="${escapeHtml(item.image || '')}" alt="" class="w-12 h-12 rounded object-cover flex-shrink-0 bg-gray-100">
            <div class="min-w-0"><div class="text-[10px] text-gray-400 uppercase font-bold">${label}</div>
                <div class="font-semibold text-gray-800 truncate">${escapeHtml(item.name)}</div>
                <div class="text-brand-800 font-bold">${formatMoney(item.price)}</div></div>
        </div>`;
    const phone = role === 'received' ? o.proposerPhone : o.ownerPhone;
    const counterpart = role === 'received' ? o.proposerName : o.ownerName;
    return `
        <article class="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs shadow-sm">
            <div class="flex items-center gap-2 flex-wrap">
                ${badge(OFFER_STATUS[o.status] || OFFER_STATUS.pending)}
                <span class="text-gray-500">${role === 'received' ? `<strong>${escapeHtml(o.proposerName)}</strong> muốn đổi với bạn` : `Bạn gửi đề nghị cho <strong>${escapeHtml(o.ownerName || 'chủ món')}</strong>`}</span>
                <span class="text-gray-400">· ${new Date(o.createdAt).toLocaleString('vi-VN')}</span>
            </div>
            <div class="flex items-center gap-3">
                ${side('Bạn đưa', give)}
                <i class="fas fa-exchange-alt flex-shrink-0 text-brand-600"></i>
                ${side('Bạn nhận', get)}
            </div>
            ${o.message ? `<div class="text-gray-500 break-words">“${escapeHtml(o.message)}”</div>` : ''}
            ${o.status === 'accepted' && phone ? `
                <div class="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-emerald-900">
                    <i class="fas fa-phone-alt"></i> Liên hệ ${escapeHtml(counterpart || 'đối phương')} để hẹn giao nhận: <a href="tel:${escapeHtml(phone)}" class="font-bold underline">${escapeHtml(phone)}</a>
                </div>` : ''}
            <div class="flex flex-wrap gap-1.5">
                ${pending && o.tradable === false ? `<span class="text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">Một trong hai món đang có đơn mua hoặc đã bán/đổi nên chưa thể chấp nhận. Bạn có thể từ chối hoặc chờ.</span>` : ''}
                ${pending && role === 'received' ? `
                    ${o.tradable === false ? '' : `<button onclick="offerAction(${o.id}, 'accept')" class="rounded-lg bg-brand-600 px-3 py-1.5 font-bold text-white transition hover:bg-brand-700">Chấp nhận đổi</button>`}
                    <button onclick="offerAction(${o.id}, 'reject')" class="border border-gray-300 text-gray-700 font-bold px-2.5 py-1 rounded hover:bg-gray-50">Từ chối</button>` : ''}
                ${pending && role === 'sent' ? `<button onclick="offerAction(${o.id}, 'withdraw')" class="border border-gray-300 text-gray-700 font-bold px-2.5 py-1 rounded hover:bg-gray-50">Rút đề nghị</button>` : ''}
            </div>
        </div>`;
}

function orderRow(o, role) {
    const me = state.user;
    const canConfirm = o.status === 'pending' && o.seller === me.username;
    const canComplete = o.status === 'confirmed' && o.buyer === me.username;
    const canCancel = ['pending', 'confirmed'].includes(o.status);
    const counterpart = role === 'sale'
        ? `Người mua: <strong>${escapeHtml(o.buyerName)}</strong> · ${escapeHtml(o.phone)} · ${escapeHtml(o.address)}`
        : `Người bán: <strong>${escapeHtml(o.sellerName)}</strong>`;
    return `
        <article class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs shadow-sm sm:flex-row sm:items-center">
            <img src="${escapeHtml(o.itemImage)}" alt="${escapeHtml(o.itemName)}" class="h-16 w-16 flex-shrink-0 rounded-xl bg-slate-100 object-cover">
            <div class="flex-1 min-w-0 space-y-0.5">
                <div class="flex items-center gap-2 flex-wrap">
                    <h4 class="font-semibold text-gray-800 truncate">${escapeHtml(o.itemName)}</h4>
                    ${badge(ORDER_STATUS[o.status] || ORDER_STATUS.pending)}
                </div>
                <div class="text-gray-500"><span class="text-brand-800 font-bold">${formatMoney(o.price)}</span> · ${escapeHtml(o.variant || 'Mặc định')} · Đơn #${o.id} · ${new Date(o.createdAt).toLocaleString('vi-VN')}</div>
                <div class="text-gray-500 break-words">${counterpart}</div>
                ${o.note ? `<div class="text-gray-500 break-words">Ghi chú: ${escapeHtml(o.note)}</div>` : ''}
            </div>
            <div class="flex flex-wrap gap-1.5 flex-shrink-0">
                ${canConfirm ? `<button onclick="orderAction(${o.id}, 'confirm')" class="bg-brand-700 hover:bg-brand-800 text-white font-bold px-2.5 py-1 rounded">Xác nhận giao</button>` : ''}
                ${canComplete ? `<button onclick="orderAction(${o.id}, 'complete')" class="bg-brand-700 hover:bg-brand-800 text-white font-bold px-2.5 py-1 rounded">Đã nhận hàng</button>` : ''}
                ${canCancel ? `<button onclick="orderAction(${o.id}, 'cancel')" class="border border-red-200 text-red-600 font-bold px-2.5 py-1 rounded hover:bg-red-50">Hủy đơn</button>` : ''}
            </div>
        </div>`;
}


function renderOrders() {
    if (!state.user) return renderLogin();
    const { orders, offers, loading, error, tab } = state.activity;
    const tabs = [
        ['purchases', 'Đơn mua', orders?.purchases],
        ['sales', 'Đơn bán', orders?.sales],
        ['received', 'Đề nghị đổi nhận được', offers?.received],
        ['sent', 'Đề nghị đổi đã gửi', offers?.sent]
    ];
    const current = tabs.find(t => t[0] === tab) || tabs[0];
    const rows = current[2] || [];
    const waitingCount = (list, fn) => (list || []).filter(fn).length;
    const counts = {
        sales: waitingCount(orders?.sales, o => o.status === 'pending'),
        purchases: waitingCount(orders?.purchases, o => o.status === 'confirmed'),
        received: waitingCount(offers?.received, o => o.status === 'pending')
    };
    const empty = { purchases: 'Bạn chưa mua món nào.', sales: 'Chưa có ai đặt mua đồ của bạn.', received: 'Chưa có đề nghị đổi nào.', sent: 'Bạn chưa gửi đề nghị đổi nào.' }[current[0]];
    const renderRow = {
        purchases: o => orderRow(o, 'purchase'),
        sales: o => orderRow(o, 'sale'),
        received: o => offerRow(o, 'received'),
        sent: o => offerRow(o, 'sent')
    }[current[0]];

    return `
                <div class="space-y-5">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <div><p class="text-xs font-semibold uppercase tracking-wider text-brand-700">Tài khoản ReLoop</p><h1 class="mt-1 flex items-center gap-2 text-2xl font-extrabold text-gray-900"><i class="fas fa-receipt text-brand-700"></i> Đơn hàng & trao đổi</h1></div>
                        <button onclick="loadActivity()" ${loading ? 'disabled' : ''} class="rounded-xl border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-800 shadow-sm transition hover:bg-brand-50 disabled:opacity-60">
                            <i class="fas fa-sync-alt ${loading ? 'animate-spin' : ''}"></i> Làm mới
                        </button>
                    </div>
                    <div class="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 text-xs shadow-sm hide-scrollbar">
                        ${tabs.map(([id, label]) => `
                            <button onclick="switchActivityTab('${id}')" class="whitespace-nowrap rounded-xl px-3 py-2 font-bold transition ${id === current[0] ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-50 text-slate-600 hover:bg-brand-50 hover:text-brand-800'}">
                                ${label}${counts[id] ? ` <span class="bg-red-500 text-white rounded-full px-1.5 ml-1">${counts[id]}</span>` : ''}
                            </button>`).join('')}
                    </div>
                    <p class="text-[11px] text-gray-500">Quy trình escrow: người mua đặt → người bán xác nhận giao → người mua bấm "Đã nhận hàng" thì giao dịch hoàn tất. Trước đó bên nào cũng có thể hủy, món đồ sẽ quay lại chợ.</p>
                    ${error ? `<p role="alert" class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">${escapeHtml(error)}</p>` : ''}
                    ${!orders && loading ? `<p role="status" class="rounded-2xl border border-slate-200 bg-white py-10 text-center text-sm text-slate-500"><i class="fas fa-circle-notch fa-spin mr-2 text-brand-600"></i>Đang tải hoạt động...</p>` : ''}
                    ${orders && rows.length === 0 ? `<p class="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">${empty}</p>` : ''}
                    <div class="space-y-3">${rows.map(renderRow).join('')}</div>
                </div>
            `;
}

function renderLogin() {
    if (state.user) return renderProfile();
    const inputCls = 'w-full border border-slate-200 rounded-xl p-3 text-sm focus:ring-1 focus:ring-brand-600 outline-none';
    return `
                <div class="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                    <div class="mb-6 text-center">
                        <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-xl text-brand-700"><i class="fas fa-user"></i></div>
                        <h1 class="text-2xl font-extrabold text-gray-900">Chào mừng trở lại</h1>
                        <p class="mt-2 text-sm text-slate-500">Đăng nhập để tiếp tục với ReLoop.</p>
                    </div>
                    ${state.demoAccounts.length ? `
                        <div class="mb-5">
                            <p class="mb-2 text-xs font-bold text-slate-700">Đăng nhập nhanh</p>
                            <div class="space-y-2">
                                ${state.demoAccounts.map(a => `
                                    <button type="button" data-username="${escapeHtml(a.username)}" onclick="demoLogin(this.dataset.username)" class="demo-login-btn flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-60">
                                        <span class="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${a.role === 'admin' ? 'bg-yellow-100 text-yellow-800' : 'bg-brand-50 text-brand-700'}">
                                            <i class="fas ${a.role === 'admin' ? 'fa-user-shield' : 'fa-user'}"></i>
                                        </span>
                                        <span class="flex-1 min-w-0">
                                            <span class="block text-sm font-bold text-gray-800 truncate">${escapeHtml(a.name)}</span>
                                            <span class="block text-[11px] text-gray-500 truncate">${escapeHtml(a.username)} · ${a.role === 'admin' ? 'Quản trị viên' : 'Người mua & bán'}</span>
                                        </span>
                                        <i class="fas fa-chevron-right text-gray-300 text-xs"></i>
                                    </button>
                                `).join('')}
                            </div>
                            <div class="my-5 flex items-center gap-3 text-[11px] text-slate-400">
                                <span class="flex-1 border-t"></span> hoặc nhập mật khẩu <span class="flex-1 border-t"></span>
                            </div>
                        </div>
                    ` : ''}
                    <form onsubmit="handleLogin(event)" class="space-y-4 text-sm">
                        <div>
                            <label for="login-username" class="mb-1 block font-semibold text-slate-700">Tên đăng nhập</label>
                            <input id="login-username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required class="${inputCls}">
                        </div>
                        <div>
                            <label for="login-password" class="mb-1 block font-semibold text-slate-700">Mật khẩu</label>
                            <input id="login-password" type="password" autocomplete="current-password" required class="${inputCls}">
                        </div>
                        <button type="submit" class="w-full rounded-xl bg-brand-600 py-3 font-bold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60">
                            Đăng nhập
                        </button>
                    </form>
                    <div class="mt-5 border-t border-slate-100 pt-4 text-center text-sm text-slate-500">
                        Chưa có tài khoản?
                        <a href="#" onclick="promptRegister(state.afterLogin); return false;" class="text-brand-700 font-bold hover:underline">Đăng ký tài khoản mới</a>
                    </div>
                </div>
            `;
}

function renderProfile() {
    if (!state.user) return renderLogin();
    const isAdmin = state.user.role === 'admin';
    return `
                <div class="mx-auto max-w-2xl space-y-5 rounded-3xl border border-slate-200 bg-white p-6 text-sm shadow-sm sm:p-8">
                    <div class="flex items-center gap-4 border-b border-slate-100 pb-5">
                        <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-xl text-brand-700"><i class="fas fa-user"></i></span>
                        <div><p class="text-xs font-semibold uppercase tracking-wider text-brand-700">Tài khoản ReLoop</p><h1 class="mt-1 text-xl font-extrabold text-gray-900">Hồ sơ của tôi</h1></div>
                    </div>
                    <dl class="grid gap-3 sm:grid-cols-2">
                        <div class="rounded-xl bg-slate-50 p-4"><dt class="text-xs text-slate-500">Tên</dt><dd class="mt-1 font-semibold text-slate-800">${escapeHtml(state.user.name)}</dd></div>
                        <div class="rounded-xl bg-slate-50 p-4"><dt class="text-xs text-slate-500">Tên đăng nhập</dt><dd class="mt-1 break-all font-semibold text-slate-800">${escapeHtml(state.user.username)}</dd></div>
                        <div class="rounded-xl bg-slate-50 p-4"><dt class="text-xs text-slate-500">Vai trò</dt><dd class="mt-1 font-semibold text-slate-800">${isAdmin ? 'Quản trị viên' : 'Người mua & bán'}</dd></div>
                        <div class="rounded-xl bg-slate-50 p-4"><dt class="text-xs text-slate-500">Tin đã đăng</dt><dd class="mt-1 font-semibold text-slate-800">${myProducts().length}</dd></div>
                    </dl>
                    <div class="flex flex-wrap gap-2 border-t border-slate-100 pt-5">
                        ${isAdmin ? `<button onclick="navigateTo('admin')" class="bg-brand-700 hover:bg-brand-800 text-white font-bold px-4 py-2 rounded-lg transition"><i class="fas fa-user-shield mr-1"></i> Trang quản trị</button>` : ''}
                        <button onclick="switchChannel('seller')" class="border border-brand-200 text-brand-800 font-bold px-4 py-2 rounded-lg hover:bg-brand-50 transition">Quản lý tin đăng</button>
                        <button onclick="openActivity('purchases')" class="border border-brand-200 text-brand-800 font-bold px-4 py-2 rounded-lg hover:bg-brand-50 transition"><i class="fas fa-receipt mr-1"></i> Đơn hàng & trao đổi</button>
                        <button onclick="handleLogout()" class="border border-red-200 text-red-600 font-bold px-4 py-2 rounded-lg hover:bg-red-50 transition"><i class="fas fa-sign-out-alt mr-1"></i> Đăng xuất</button>
                    </div>
                </div>
            `;
}

// =====================================================
// TRANG QUẢN TRỊ (ADMIN)
// =====================================================
function statTile(label, value, sub, cls) {
    return `
        <div class="${cls} p-3 rounded-lg border text-center">
            <div class="text-lg font-black">${escapeHtml(String(value))}</div>
            <div class="text-[10px] text-gray-500 uppercase font-bold">${label}</div>
            ${sub ? `<div class="text-[10px] text-gray-400 mt-0.5">${escapeHtml(sub)}</div>` : ''}
        </div>`;
}

function adminListingRow(p) {
    return `
        <div class="flex items-center gap-3 text-xs border-b py-2">
            <img src="${escapeHtml(p.image)}" alt="" class="w-12 h-12 rounded object-cover flex-shrink-0 bg-gray-100 cursor-pointer" onclick="navigateTo('detail', ${p.id})">
            <div class="flex-1 min-w-0">
                <h4 class="font-semibold text-gray-800 truncate cursor-pointer hover:text-brand-700" onclick="navigateTo('detail', ${p.id})">${escapeHtml(p.name)}</h4>
                <div class="text-gray-500 truncate">
                    <span class="text-brand-800 font-bold">${formatMoney(p.price)}</span>
                    · ${escapeHtml(p.ownerName || p.owner || '')}
                    · ${new Date(p.createdAt).toLocaleString('vi-VN')}
                </div>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-1.5 flex-shrink-0">
                ${statusBadge(p)}
                <button onclick="deleteListing(${p.id})" class="border border-red-200 text-red-600 font-bold px-2.5 py-1 rounded hover:bg-red-50">Gỡ tin</button>
            </div>
        </div>`;
}

function renderAdmin() {
    if (!state.user) return renderLogin();
    if (state.user.role !== 'admin') {
        return `
                <div class="bg-white rounded-xl p-12 text-center text-gray-500 shadow-sm">
                    <i class="fas fa-lock text-5xl text-gray-300 mb-3"></i>
                    <p class="text-base font-medium">Trang này chỉ dành cho quản trị viên.</p>
                </div>`;
    }
    const { stats, loading, error } = state.admin;
    const total = stats?.usage?.total || {};
    const today = stats?.usage?.today || {};
    const pair = (key) => `${today[key] || 0} / ${total[key] || 0}`;

    return `
                <div class="space-y-6">
                    <div class="bg-white rounded-xl shadow-sm p-5 border">
                        <div class="flex flex-wrap items-center justify-between gap-3 border-b pb-3 mb-4">
                            <h2 class="text-lg font-bold text-gray-800 flex items-center gap-2"><i class="fas fa-chart-bar text-brand-700"></i> Thống Kê Sử Dụng</h2>
                            <button onclick="refreshAdmin()" ${loading ? 'disabled' : ''} class="text-xs border border-brand-200 text-brand-800 font-bold px-3 py-1.5 rounded-lg hover:bg-brand-50 disabled:opacity-60">
                                <i class="fas fa-sync-alt ${loading ? 'animate-spin' : ''}"></i> Làm mới
                            </button>
                        </div>
                        ${error ? `<p class="text-xs text-red-600 mb-3">${escapeHtml(error)}</p>` : ''}
                        <p class="text-[11px] text-gray-500 mb-3">Số liệu dạng <strong>hôm nay / tổng cộng</strong> (theo giờ Việt Nam).</p>
                        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-gray-800">
                            ${statTile('Lượt định giá', pair('valuations'), `Lỗi: ${pair('valuation_errors')}`, 'bg-emerald-50 border-emerald-100')}
                            ${statTile('Lượt gọi Gemini', pair('gemini_calls'), '', 'bg-slate-50 border-slate-200')}
                            ${statTile('Lượt gọi Tavily', pair('tavily_calls'), 'Gói Free: 1.000 credit/tháng', 'bg-slate-50 border-slate-200')}
                            ${statTile('Lượt đăng nhập', pair('logins'), '', 'bg-slate-50 border-slate-200')}
                            ${statTile('Tin đăng', stats?.listings?.total ?? '—', stats ? `Hiển thị ${stats.listings.available} · Đã đặt/bán/đổi ${stats.listings.total - stats.listings.available}` : '', 'bg-emerald-50 border-emerald-100')}
                            ${statTile('Món đồ', stats ? stats.listings.available : '—', stats ? `Đang đặt ${stats.listings.reserved} · Đã bán ${stats.listings.sold} · Đã đổi ${stats.listings.traded}` : '', 'bg-slate-50 border-slate-200')}
                            ${statTile('Đơn hàng', stats ? Object.values(stats.orders || {}).reduce((a, b) => a + b, 0) : '—', stats ? `Chờ ${stats.orders?.pending || 0} · Giao ${stats.orders?.confirmed || 0} · Xong ${stats.orders?.completed || 0} · Hủy ${stats.orders?.cancelled || 0}` : '', 'bg-slate-50 border-slate-200')}
                            ${statTile('Đề nghị đổi', stats ? Object.values(stats.offers || {}).reduce((a, b) => a + b, 0) : '—', stats ? `Chờ ${stats.offers?.pending || 0} · Chấp nhận ${stats.offers?.accepted || 0}` : '', 'bg-emerald-50 border-emerald-100')}
                        </div>
                    </div>

                    <div class="bg-white rounded-xl shadow-sm p-5 border">
                        <h2 class="text-base font-bold text-gray-800 border-l-4 border-brand-700 pl-3 mb-1 uppercase">Kiểm Tra Tin Đăng (${products.length})</h2>
                        <p class="text-[11px] text-gray-500 mb-3">Tin hiện ngay khi người bán đăng. Gỡ tin nếu thấy vi phạm.</p>
                        ${products.length === 0 ? `<p class="text-xs text-gray-400 text-center py-4">Chưa có tin đăng nào.</p>` : products.map(adminListingRow).join('')}
                    </div>
                </div>
            `;
}

function renderOrderSuccess() {
    return `
                <div class="bg-white rounded-xl p-8 text-center text-sm shadow-sm max-w-2xl mx-auto space-y-3">
                    <i class="fas fa-check-circle text-5xl text-brand-600"></i>
                    <p class="font-bold text-brand-800 text-base">Đặt hàng thành công!</p>
                    <p class="text-xs text-gray-500">Món đồ đã được giữ cho bạn. Người bán sẽ xác nhận và giao hàng; khi nhận được hàng, hãy bấm "Đã nhận hàng" trong mục Đơn hàng.</p>
                    <div class="flex flex-wrap justify-center gap-2">
                        <button onclick="openActivity('purchases')" class="bg-brand-700 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-brand-800 transition">Xem Đơn Hàng</button>
                        <button onclick="navigateTo('home')" class="border border-brand-200 text-brand-800 px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-brand-50 transition">Tiếp Tục Mua Sắm</button>
                    </div>
                </div>
            `;
}

// INITIAL LOAD — chạy ngay khi DOM sẵn sàng, không đợi tải xong toàn bộ ảnh/font
// (tránh khoảng trắng nhấp nháy giữa header và footer lúc mới vào trang)
updateChannelButtons();
renderUserBar();
renderPage();
updateCartBadge();
initSession();

// Lấy phiên đăng nhập và tin đăng từ máy chủ rồi vẽ lại
async function initSession() {
    try {
        const [me, demo] = await Promise.all([api('/api/auth/me'), api('/api/auth/demo-accounts')]);
        state.user = me.user;
        state.demoAccounts = demo.accounts || [];
    } catch (err) {
        state.user = null;
        showToast(err.message, 'error');
    }
    renderUserBar();
    await loadListings();
    renderPage();
}

// Quay lại tab: tải lại tin đăng để thấy ngay món nào vừa có người mua/đổi.
// Không vẽ lại trang có form đang nhập dở (đăng bán, thanh toán, định giá).
const REFRESHABLE_PAGES = ['home', 'detail', 'cart', 'orders', 'admin'];
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (state.channel === 'seller' && state.currentPage === 'home') return;
    if (!REFRESHABLE_PAGES.includes(state.currentPage)) return;
    await loadListings();
    if (state.currentPage === 'orders') await loadActivity();
    else renderPage();
});
