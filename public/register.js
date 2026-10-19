// =====================================================
// TRANG ĐĂNG KÝ TÀI KHOẢN (tách riêng khỏi trang Đăng nhập)
// - Đăng ký: người mới TẠO tài khoản (họ tên, tên đăng nhập, mật khẩu, nhập lại mật khẩu)
//   -> gọi POST /api/auth/register -> máy chủ lưu vào database (lib/accounts.js)
//   -> tạo xong tự đăng nhập và quay lại trang đang làm dở (thanh toán, đăng bán...).
// - Đăng nhập (app.js): người ĐÃ CÓ tài khoản nhập tên + mật khẩu.
// File này dùng các hàm chung trong app.js: state, api, navigateTo, finishLogin, showToast, renderProfile.
// =====================================================

const REGISTER_RULES = {
    usernamePattern: /^[a-z0-9][a-z0-9._]{2,29}$/,
    passwordMin: 6
};

// Mở trang Đăng ký; returnTo = trang quay lại sau khi đăng ký xong (vd 'checkout', 'seller')
function promptRegister(returnTo = null) {
    state.afterLogin = returnTo;
    navigateTo('register');
}

function renderRegister() {
    if (state.user) return renderProfile(); // đã đăng nhập thì không cần đăng ký
    const inputCls = 'w-full border rounded-lg p-2.5 text-sm focus:ring-1 focus:ring-brand-600 outline-none';
    const hint = 'text-[11px] text-gray-400 mt-1';
    return `
                <div class="bg-white rounded-xl shadow-sm p-6 md:p-8 max-w-sm mx-auto border border-brand-100">
                    <div class="text-center mb-6">
                        <div class="w-12 h-12 rounded-full bg-yellow-100 text-yellow-800 flex items-center justify-center text-xl mx-auto mb-3"><i class="fas fa-user-plus"></i></div>
                        <h1 class="text-lg font-bold text-gray-800">Đăng ký tài khoản ReLoop</h1>
                        <p class="text-xs text-gray-500 mt-1">Miễn phí. Tạo xong là mua hàng, đăng tin và trao đổi đồ được ngay.</p>
                    </div>
                    <form onsubmit="handleRegister(event)" class="space-y-4 text-xs" novalidate>
                        <div>
                            <label for="reg-name" class="font-bold text-gray-700 block mb-1">Họ tên *</label>
                            <input id="reg-name" type="text" autocomplete="name" maxlength="60" placeholder="VD: Nguyễn Văn An" class="${inputCls}">
                            <p class="${hint}">Hiện với người mua/bán khi giao dịch.</p>
                        </div>
                        <div>
                            <label for="reg-username" class="font-bold text-gray-700 block mb-1">Tên đăng nhập *</label>
                            <input id="reg-username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="30" placeholder="VD: nguyenvanan" class="${inputCls}">
                            <p class="${hint}">3–30 ký tự: chữ không dấu, số, dấu chấm hoặc gạch dưới. Dùng để đăng nhập sau này.</p>
                        </div>
                        <div>
                            <label for="reg-password" class="font-bold text-gray-700 block mb-1">Mật khẩu *</label>
                            <input id="reg-password" type="password" autocomplete="new-password" maxlength="128" placeholder="Ít nhất ${REGISTER_RULES.passwordMin} ký tự" class="${inputCls}">
                        </div>
                        <div>
                            <label for="reg-password2" class="font-bold text-gray-700 block mb-1">Nhập lại mật khẩu *</label>
                            <input id="reg-password2" type="password" autocomplete="new-password" maxlength="128" class="${inputCls}">
                        </div>
                        <label class="flex items-start gap-2 text-gray-600">
                            <input id="reg-agree" type="checkbox" class="mt-0.5">
                            <span>Tôi đồng ý với điều khoản sử dụng và cam kết đăng bán đồ thật, đúng mô tả.</span>
                        </label>
                        <button type="submit" class="w-full bg-yellow-400 hover:bg-yellow-300 text-brand-900 font-bold py-3 rounded-xl transition shadow text-xs uppercase tracking-wider disabled:opacity-60">
                            Tạo tài khoản
                        </button>
                    </form>
                    <div class="mt-5 pt-4 border-t text-center text-xs text-gray-500">
                        Đã có tài khoản?
                        <a href="#" onclick="promptLogin(state.afterLogin); return false;" class="text-brand-700 font-bold hover:underline">Đăng nhập</a>
                    </div>
                </div>
            `;
}

// Kiểm tra ngay trên trình duyệt để báo lỗi nhanh (máy chủ vẫn kiểm tra lại lần nữa)
function checkRegisterForm({ name, username, password, password2, agree }) {
    if (name.length < 2) return ['reg-name', 'Vui lòng nhập họ tên (ít nhất 2 ký tự).'];
    if (!REGISTER_RULES.usernamePattern.test(username)) {
        return ['reg-username', 'Tên đăng nhập 3–30 ký tự, chỉ gồm chữ không dấu, số, dấu chấm hoặc gạch dưới.'];
    }
    if (password.length < REGISTER_RULES.passwordMin) return ['reg-password', `Mật khẩu cần ít nhất ${REGISTER_RULES.passwordMin} ký tự.`];
    if (password !== password2) return ['reg-password2', 'Hai lần nhập mật khẩu không khớp.'];
    if (!agree) return ['reg-agree', 'Vui lòng đồng ý điều khoản sử dụng.'];
    return null;
}

async function handleRegister(e) {
    e.preventDefault();
    const val = id => document.getElementById(id).value;
    const form = {
        name: val('reg-name').trim(),
        username: val('reg-username').trim().toLowerCase(),
        password: val('reg-password'),
        password2: val('reg-password2'),
        agree: document.getElementById('reg-agree').checked
    };
    const problem = checkRegisterForm(form);
    if (problem) {
        showToast(problem[1], 'error');
        document.getElementById(problem[0])?.focus();
        return;
    }
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.innerText = 'Đang tạo tài khoản...'; }
    try {
        const data = await api('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ name: form.name, username: form.username, password: form.password })
        });
        showToast('Tạo tài khoản thành công!');
        await finishLogin(data.user); // đăng ký xong tự đăng nhập, quay lại trang đang làm dở
    } catch (err) {
        showToast(err.message, 'error');
        if (err.status === 409) document.getElementById('reg-username')?.focus();
        if (btn) { btn.disabled = false; btn.innerText = 'Tạo tài khoản'; }
    }
}
