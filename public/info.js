// Các trang thông tin ở chân trang: hướng dẫn, giới thiệu, điều khoản, chính sách.
// Nội dung là HTML tĩnh do nhóm vận hành viết (không chứa dữ liệu người dùng nên không cần escape).
// Thay CONTACT_EMAIL bằng email hỗ trợ thật khi vận hành.
const CONTACT_EMAIL = 'hotro@reloop.example';

const INFO_GROUPS = [
    { title: 'Hỗ trợ', pages: ['help', 'how-to-buy', 'how-to-sell', 'how-to-trade', 'shipping'] },
    { title: 'Về ReLoop', pages: ['about', 'rules', 'terms', 'privacy', 'contact'] }
];

const infoSection = (title, body) => `<section class="space-y-2"><h2 class="text-base font-bold text-gray-900">${title}</h2>${body}</section>`;
const infoList = (items, ordered = false) => `<${ordered ? 'ol' : 'ul'} class="${ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1.5">${items.map(i => `<li>${i}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
const infoFaq = (q, a) => `<details class="group rounded-xl border border-slate-200 bg-white p-4 transition open:border-emerald-200 open:bg-emerald-50/40"><summary class="cursor-pointer font-semibold text-slate-800 marker:text-emerald-600">${q}</summary><p class="mt-3 text-sm leading-6 text-slate-600">${a}</p></details>`;
const infoLink = (label, onclick) => `<button onclick="${onclick}" class="font-semibold text-emerald-700 hover:text-emerald-800 hover:underline">${label}</button>`;

const INFO_PAGES = {
    help: {
        title: 'Trung tâm trợ giúp', icon: 'fa-life-ring',
        intro: 'Giải đáp nhanh những câu hỏi thường gặp khi mua, bán và đổi đồ cũ trên ReLoop.',
        body: () => [
            infoSection('Câu hỏi thường gặp', `<div class="space-y-2">${[
                ['Vì sao mỗi món chỉ bán được một lần?', 'ReLoop là chợ đồ cũ: mỗi tin là một món đồ có thật, chỉ có một cái. Khi có người đặt, món đó được giữ cho người ấy và biến khỏi chợ. Nếu đơn bị hủy, món sẽ hiện lại.'],
                ['Tôi có tự mua được món mình đăng không?', 'Không. Hệ thống chặn việc tự mua và tự đổi món của chính bạn để giá và lượt giao dịch luôn là thật.'],
                ['Tin của tôi có cần chờ duyệt không?', 'Không. Tin hiện ngay sau khi đăng. Quản trị viên kiểm tra sau và sẽ gỡ những tin vi phạm quy định đăng tin.'],
                ['Tôi lỡ bấm đăng hai lần thì sao?', 'Hệ thống nhận ra tin trùng trong vòng 1 phút và chỉ giữ một tin.'],
                ['Tôi hủy đơn được không?', 'Được, khi người mua chưa bấm “Đã nhận hàng”. Cả người mua và người bán đều có thể hủy, món đồ sẽ quay lại chợ.'],
                ['Đổi đồ ngang giá là gì?', 'Hai món được phép đổi cho nhau khi giá trị chênh nhau tối đa 10%. Chi tiết xem ở mục “Hướng dẫn trao đổi”.'],
                ['Vì sao tôi không thấy món mình vừa đăng ở trang chợ?', 'Nếu có người đặt mua hoặc đổi, món sẽ ẩn khỏi chợ. Bạn vẫn thấy nó trong “Kênh Người Bán” với nhãn “Có người đặt”, “Đã bán” hoặc “Đã đổi”.'],
                ['Tài khoản quản trị có mua bán được không?', 'Không. Quản trị viên chỉ kiểm tra tin đăng, gỡ tin vi phạm và xem thống kê.']
            ].map(([q, a]) => infoFaq(q, a)).join('')}</div>`),
            infoSection('Cần thêm trợ giúp?', `<p>Xem các hướng dẫn chi tiết bên trái, hoặc ${infoLink('liên hệ ReLoop', "navigateTo('info', null, 'contact')")}.</p>`)
        ].join('')
    },

    'how-to-buy': {
        title: 'Hướng dẫn mua hàng', icon: 'fa-shopping-bag',
        intro: 'Từ lúc chọn món đến lúc nhận hàng chỉ gồm vài bước.',
        body: () => [
            infoSection('Các bước mua', infoList([
                '<strong>Đăng nhập</strong> tài khoản người dùng (tài khoản quản trị không mua bán được).',
                '<strong>Tìm món</strong> bằng ô tìm kiếm hoặc danh mục. Mở tin để xem ảnh, mô tả, tình trạng và người đăng.',
                'Bấm <strong>Thêm vào giỏ</strong> hoặc <strong>Mua ngay</strong>. Mỗi món chỉ có một cái nên không chọn số lượng.',
                'Nhập <strong>số điện thoại</strong> và <strong>địa chỉ nhận hàng</strong>, rồi xác nhận đặt hàng. Giá được lấy từ tin đăng, không thể thay đổi từ phía trình duyệt.',
                'Người bán xác nhận giao. Khi nhận được hàng và hài lòng, bạn bấm <strong>Đã nhận hàng</strong> trong mục “Đơn hàng & trao đổi” để hoàn tất.'
            ], true)),
            infoSection('Lưu ý khi mua đồ cũ', infoList([
                'Đọc kỹ mô tả, xem ảnh thật và hỏi lại người bán nếu cần trước khi đặt.',
                'Nếu món đã có người đặt trước, bạn sẽ được báo và món tự bị bỏ khỏi giỏ.',
                'Chỉ bấm “Đã nhận hàng” sau khi bạn đã kiểm tra món đồ.',
                'Muốn đổi ý trước khi nhận hàng, hãy hủy đơn trong mục “Đơn hàng & trao đổi”.'
            ])),
            infoSection('Xem thêm', `<p>${infoLink('Giao nhận & thanh toán an toàn', "navigateTo('info', null, 'shipping')")}</p>`)
        ].join('')
    },

    'how-to-sell': {
        title: 'Hướng dẫn đăng bán', icon: 'fa-store',
        intro: 'Đăng tin trong vài phút, tin hiện ngay trên chợ.',
        body: () => [
            infoSection('Các bước đăng bán', infoList([
                'Đăng nhập, vào <strong>Kênh Người Bán</strong>.',
                'Điền tên món, chọn hình thức (<em>chỉ bán</em>, <em>chỉ trao đổi</em> hoặc <em>vừa bán vừa đổi</em>) và danh mục.',
                'Nhập giá. Với món chỉ trao đổi, đây là <strong>giá trị ước tính</strong> dùng để so sánh ngang giá.',
                'Tải ít nhất một ảnh rõ nét, viết mô tả trung thực về độ mới, vết xước, phụ kiện đi kèm.',
                'Bấm <strong>Đăng bán ngay</strong>. Tin hiện ngay trên chợ, không cần chờ duyệt.'
            ], true)),
            infoSection('Không biết định giá bao nhiêu?', `<p>Dùng ${infoLink('Định giá AI', "navigateTo('ai-valuation')")}: chụp ảnh món đồ, hệ thống gợi ý khoảng giá và tình trạng, bạn có thể đăng bán luôn từ kết quả.</p>`),
            infoSection('Sau khi có người đặt', infoList([
                'Món chuyển sang trạng thái “Có người đặt” và ẩn khỏi chợ.',
                'Bạn vào <strong>Đơn bán</strong>, kiểm tra thông tin người mua rồi bấm <strong>Xác nhận giao</strong>.',
                'Khi người mua bấm “Đã nhận hàng”, món chuyển sang “Đã bán”.',
                'Bạn chỉ gỡ được tin khi không có đơn đang chờ xử lý. Muốn gỡ, hãy hủy đơn trước.'
            ])),
            infoSection('Mẹo bán nhanh', infoList([
                'Chụp ảnh thật, đủ sáng, thấy rõ cả vết xước hoặc lỗi nếu có.',
                'Ghi rõ lý do bán, thời gian đã dùng, còn bảo hành hay không.',
                'Đặt giá sát với giá thị trường đồ cũ.'
            ])),
            infoSection('Xem thêm', `<p>${infoLink('Quy định đăng tin', "navigateTo('info', null, 'rules')")}</p>`)
        ].join('')
    },

    'how-to-trade': {
        title: 'Hướng dẫn trao đổi', icon: 'fa-exchange-alt',
        intro: 'Đổi món bạn không dùng lấy món bạn cần, công bằng cho cả hai bên.',
        body: () => [
            infoSection('Nguyên tắc đổi ngang giá', `<p>Hai món chỉ được đổi cho nhau khi giá trị chênh nhau <strong>tối đa 10%</strong>. Ví dụ muốn nhận món 1.000.000đ, bạn dùng được món có giá từ 900.000đ đến 1.111.111đ.</p>`),
            infoSection('Người muốn đổi', infoList([
                'Đăng món của bạn ở chế độ <em>chỉ trao đổi</em> hoặc <em>vừa bán vừa đổi</em>, với giá trị ước tính hợp lý.',
                'Vào <strong>Kênh Trao Đổi</strong>, chọn món bạn muốn nhận rồi bấm <strong>Đề nghị đổi</strong>.',
                'Chọn một món của chính bạn trong khoảng giá cho phép, để lại số điện thoại và lời nhắn.',
                'Theo dõi phản hồi ở “Đơn hàng & trao đổi” → “Đề nghị đổi đã gửi”. Bạn có thể rút đề nghị khi chưa được trả lời.'
            ], true)),
            infoSection('Chủ món được đề nghị', infoList([
                'Vào “Đề nghị đổi nhận được” để xem món được đem ra đổi, giá và lời nhắn.',
                'Bấm <strong>Chấp nhận đổi</strong> và để lại số điện thoại, hoặc <strong>Từ chối</strong>.',
                'Khi cả hai đã đồng ý, <strong>cả hai món</strong> được đánh dấu “Đã đổi” và biến khỏi chợ; các đề nghị khác liên quan đến hai món này tự bị từ chối.',
                'Hai bên thấy số điện thoại của nhau để hẹn gặp hoặc gửi hàng.'
            ], true)),
            infoSection('Cần biết', infoList([
                'Chỉ đổi được bằng món <strong>do chính bạn đăng</strong> và đang còn trên chợ.',
                'Nếu một trong hai món đã có người đặt mua hoặc đã đổi, đề nghị không thể chấp nhận.',
                'Không thể tự đổi với món của mình. Tài khoản quản trị không tham gia trao đổi.',
                'Hãy kiểm tra món tận tay khi gặp nhau và chỉ giao đồ khi hai bên đã hài lòng.'
            ]))
        ].join('')
    },

    shipping: {
        title: 'Giao nhận & thanh toán an toàn', icon: 'fa-shield-alt',
        intro: 'Quy trình đặt hàng được chia thành từng bước để hai bên cùng yên tâm.',
        body: () => [
            infoSection('Quy trình một đơn hàng', infoList([
                '<strong>Chờ người bán xác nhận</strong>: người mua đặt hàng, món được giữ riêng cho đơn này.',
                '<strong>Đang giao</strong>: người bán xác nhận sẽ giao hàng.',
                '<strong>Đã hoàn tất</strong>: người mua bấm “Đã nhận hàng”. Món chuyển sang “Đã bán”.',
                '<strong>Đã hủy</strong>: người mua hoặc người bán hủy trước khi hoàn tất. Món quay lại chợ.'
            ], true)),
            infoSection('Thanh toán', `<p>Khoản thanh toán chỉ được xem là hoàn tất cho người bán khi người mua xác nhận đã nhận hàng. Trước thời điểm đó, bên nào cũng có thể hủy đơn. Hãy chỉ bấm “Đã nhận hàng” khi bạn đã kiểm tra món đồ.</p>`),
            infoSection('Giao nhận', infoList([
                'Địa chỉ và số điện thoại bạn nhập khi đặt hàng chỉ hiển thị cho người bán của đơn đó.',
                'Hai bên tự thỏa thuận cách giao: gặp trực tiếp hoặc gửi qua đơn vị vận chuyển. Hãy trao đổi rõ phí gửi và thời gian giao trước khi người bán xác nhận.',
                'Nên quay video lúc mở gói hàng để làm bằng chứng nếu có tranh chấp.'
            ])),
            infoSection('Khi có vấn đề', `<p>Hàng không đúng mô tả hoặc người bán không phản hồi? Đừng bấm “Đã nhận hàng”, hãy hủy đơn hoặc ${infoLink('liên hệ ReLoop', "navigateTo('info', null, 'contact')")} kèm mã đơn.</p>`)
        ].join('')
    },

    about: {
        title: 'Giới thiệu về ReLoop', icon: 'fa-recycle',
        intro: 'Trao món đồ cũ, trao giá trị mới.',
        body: () => [
            infoSection('ReLoop là gì?', `<p>ReLoop là chợ mua bán và trao đổi đồ cũ. Mỗi tin là một món đồ có thật, chỉ có một cái, nên mỗi món chỉ bán hoặc đổi được một lần. Chúng tôi muốn việc mua đồ đã qua sử dụng đơn giản, công bằng và đáng tin cậy.</p>`),
            infoSection('Chúng tôi làm gì', infoList([
                '<strong>Mua bán:</strong> đăng tin miễn phí, tin hiện ngay, đặt hàng theo từng bước có xác nhận hai chiều.',
                '<strong>Trao đổi ngang giá:</strong> đổi món bạn không dùng lấy món bạn cần khi hai bên cùng đồng ý.',
                '<strong>Định giá bằng AI:</strong> gợi ý khoảng giá và tình trạng từ ảnh sản phẩm, dựa trên giá đồ cũ tham khảo trên thị trường.'
            ])),
            infoSection('Vì sao đồ cũ?', `<p>Kéo dài vòng đời của một món đồ là cách đơn giản nhất để giảm rác thải và tiết kiệm tiền. Mỗi món đồ được trao tay là một món đồ không phải sản xuất mới.</p>`),
            infoSection('Giá trị cốt lõi', infoList([
                '<strong>Minh bạch:</strong> giá, tình trạng và người đăng đều hiển thị rõ ràng.',
                '<strong>Công bằng:</strong> không tự mua món của mình, không bán trùng một món cho hai người.',
                '<strong>An toàn:</strong> quản trị viên kiểm tra và gỡ tin vi phạm.'
            ])),
            infoSection('Những người đứng sau ReLoop', `<p>Tìm hiểu thêm về ${infoLink('đội ngũ ReLoop', "navigateTo('team')")} và những giá trị kết nối chúng tôi.</p>`)
        ].join('')
    },

    rules: {
        title: 'Quy định đăng tin & kiểm duyệt', icon: 'fa-clipboard-check',
        intro: 'Những quy tắc giúp chợ ReLoop luôn sạch và đáng tin.',
        body: () => [
            infoSection('Cách kiểm duyệt', `<p>Tin được đăng và hiển thị ngay. Quản trị viên kiểm tra tin sau khi đăng và gỡ những tin vi phạm. Quản trị viên chỉ làm nhiệm vụ kiểm tra và gỡ tin, không tham gia mua bán hay can thiệp vào đơn hàng.</p>`),
            infoSection('Không được đăng', infoList([
                'Hàng giả, hàng nhái, hàng nghi ngờ nguồn gốc không rõ ràng hoặc đồ ăn cắp.',
                'Hàng cấm hoặc hạn chế theo pháp luật: vũ khí, chất cấm, thuốc kê đơn, pháo nổ, động vật hoang dã...',
                'Nội dung khiêu dâm, bạo lực, xúc phạm hoặc kích động thù ghét.',
                'Tài khoản, mã giảm giá, dịch vụ hoặc thứ không phải là một món đồ vật cụ thể.',
                'Tin lừa đảo: ảnh không phải đồ thật, giá ảo để câu khách, yêu cầu chuyển tiền ngoài hệ thống.'
            ])),
            infoSection('Yêu cầu với một tin tốt', infoList([
                'Ảnh thật của chính món đồ, tên và mô tả đúng sự thật.',
                'Giá hợp lý. Món chỉ trao đổi phải có giá trị ước tính sát thực tế.',
                'Mỗi món một tin. Tin trùng lặp có thể bị gỡ.'
            ])),
            infoSection('Hậu quả khi vi phạm', `<p>Tin vi phạm sẽ bị gỡ. Nếu tin đang có đơn chờ xử lý, các đơn này sẽ bị hủy theo và món đồ không còn được bán. Vi phạm nhiều lần có thể bị khóa tài khoản.</p>`)
        ].join('')
    },

    terms: {
        title: 'Điều khoản sử dụng', icon: 'fa-file-contract',
        intro: 'Khi sử dụng ReLoop, bạn đồng ý với các điều khoản dưới đây.',
        body: () => [
            infoSection('1. Tài khoản', `<p>Bạn chịu trách nhiệm giữ bí mật thông tin đăng nhập và mọi hoạt động diễn ra dưới tài khoản của mình. Thông tin bạn cung cấp phải chính xác. Tài khoản quản trị chỉ dùng để kiểm tra và gỡ tin, không được dùng để mua, bán hay trao đổi.</p>`),
            infoSection('2. Đăng tin', `<p>Bạn cam kết là chủ sở hữu hợp pháp của món đồ, mô tả đúng sự thật và tuân thủ ${infoLink('Quy định đăng tin', "navigateTo('info', null, 'rules')")}. ReLoop có quyền gỡ tin vi phạm mà không cần báo trước.</p>`),
            infoSection('3. Mua bán', infoList([
                'Mỗi tin là một món đồ duy nhất. Món đã có người đặt sẽ được giữ cho người đó cho đến khi đơn hoàn tất hoặc bị hủy.',
                'Người bán không được mua món của chính mình; người mua không được đặt món đã giữ cho người khác.',
                'Đơn chỉ hoàn tất khi người mua xác nhận đã nhận hàng. Trước đó hai bên đều có thể hủy.'
            ])),
            infoSection('4. Trao đổi', `<p>Việc trao đổi chỉ diễn ra khi cả hai bên đồng ý, giữa hai món do chính hai bên đăng và có giá trị chênh lệch không quá 10%. Sau khi đồng ý, hai bên có trách nhiệm tự hẹn giao nhận và kiểm tra món đồ.</p>`),
            infoSection('5. Trách nhiệm', `<p>ReLoop là nền tảng kết nối người mua và người bán. Chất lượng thực tế của món đồ do người đăng chịu trách nhiệm. ReLoop nỗ lực kiểm tra tin đăng nhưng không bảo đảm tuyệt đối mọi tin đều chính xác.</p>`),
            infoSection('6. Giá gợi ý từ AI', `<p>Giá và tình trạng do AI đưa ra chỉ mang tính tham khảo, không phải cam kết về giá trị món đồ.</p>`),
            infoSection('7. Thay đổi điều khoản', `<p>ReLoop có thể cập nhật điều khoản. Việc tiếp tục sử dụng dịch vụ sau khi cập nhật được hiểu là bạn đồng ý với nội dung mới.</p>`)
        ].join('')
    },

    privacy: {
        title: 'Chính sách bảo mật', icon: 'fa-user-shield',
        intro: 'ReLoop thu thập ít thông tin nhất có thể và chỉ dùng để vận hành giao dịch.',
        body: () => [
            infoSection('Thông tin chúng tôi lưu', infoList([
                '<strong>Tài khoản:</strong> tên hiển thị và tên đăng nhập.',
                '<strong>Tin đăng:</strong> tên, giá, mô tả, ảnh bạn tải lên.',
                '<strong>Đơn hàng:</strong> số điện thoại, địa chỉ nhận hàng và ghi chú.',
                '<strong>Trao đổi:</strong> số điện thoại và lời nhắn trong đề nghị đổi.',
                '<strong>Thống kê ẩn danh:</strong> số lượt sử dụng các tính năng để vận hành hệ thống.'
            ])),
            infoSection('Ai nhìn thấy gì', infoList([
                'Địa chỉ và số điện thoại đặt hàng chỉ hiện cho <strong>người bán của đơn đó</strong>.',
                'Số điện thoại trong đề nghị đổi chỉ hiện cho bên kia <strong>sau khi cả hai đã đồng ý đổi</strong>.',
                'Quản trị viên không xem được đơn hàng hay đề nghị trao đổi của người dùng.',
                'Mọi người đều thấy tên hiển thị của người đăng trên tin.'
            ])),
            infoSection('Ảnh và định giá AI', `<p>Khi dùng Định giá AI, ảnh và mô tả bạn gửi được chuyển đến dịch vụ AI và dịch vụ tìm kiếm giá để phân tích. Chúng chỉ được dùng để tạo kết quả định giá cho bạn. Ảnh của tin đăng được lưu trên dịch vụ lưu trữ đám mây và hiển thị công khai cùng tin.</p>`),
            infoSection('Cookie', `<p>ReLoop dùng một cookie phiên để giữ trạng thái đăng nhập. Giỏ hàng được lưu trong trình duyệt của bạn. Chúng tôi không dùng cookie quảng cáo.</p>`),
            infoSection('Quyền của bạn', `<p>Bạn có thể gỡ tin của mình bất cứ lúc nào (khi không có đơn đang chờ). Muốn xóa hoặc chỉnh sửa dữ liệu cá nhân, hãy ${infoLink('liên hệ ReLoop', "navigateTo('info', null, 'contact')")}.</p>`)
        ].join('')
    },

    contact: {
        title: 'Liên hệ', icon: 'fa-envelope',
        intro: 'Chúng tôi luôn sẵn sàng lắng nghe.',
        body: () => [
            infoSection('Hỗ trợ khách hàng', `<p>Gửi email đến <a href="mailto:${CONTACT_EMAIL}" class="text-brand-700 font-semibold hover:underline">${CONTACT_EMAIL}</a>. Chúng tôi phản hồi trong giờ hành chính, thường trong vòng 1–2 ngày làm việc.</p>`),
            infoSection('Khi gửi phản ánh, hãy kèm', infoList([
                'Tên đăng nhập của bạn.',
                'Mã đơn hàng (dạng “Đơn #123”) hoặc đường dẫn/tên tin đăng liên quan.',
                'Mô tả ngắn gọn vấn đề và ảnh chụp màn hình nếu có.'
            ])),
            infoSection('Báo cáo tin vi phạm', `<p>Gặp tin hàng giả, lừa đảo hoặc nội dung không phù hợp? Gửi tên tin và lý do qua email trên, quản trị viên sẽ kiểm tra và gỡ nếu đúng vi phạm.</p>`),
            infoSection('Tìm câu trả lời nhanh', `<p>Nhiều câu hỏi đã có sẵn ở ${infoLink('Trung tâm trợ giúp', "navigateTo('info', null, 'help')")}.</p>`)
        ].join('')
    }
};

function renderInfo() {
    const slug = INFO_PAGES[state.infoPage] ? state.infoPage : 'help';
    const page = INFO_PAGES[slug];
    return `
                <div class="grid grid-cols-1 gap-5 md:grid-cols-4">
                    <nav aria-label="Trang thông tin" class="h-max space-y-4 rounded-2xl border border-slate-200 bg-white p-4 text-xs shadow-sm md:col-span-1">
                        ${INFO_GROUPS.map(group => `
                            <div>
                                <h3 class="font-bold text-gray-400 uppercase tracking-wider mb-2">${group.title}</h3>
                                <ul class="space-y-1">
                                    ${group.pages.map(key => `
                                        <li><button onclick="navigateTo('info', null, '${key}')" ${key === slug ? 'aria-current="page"' : ''}
                                            class="w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 ${key === slug ? 'bg-brand-50 text-brand-800 font-bold' : 'text-gray-600 hover:bg-gray-50'}">
                                            <i class="fas ${INFO_PAGES[key].icon} w-4 text-center"></i> ${INFO_PAGES[key].title}</button></li>`).join('')}
                                </ul>
                            </div>`).join('')}
                    </nav>
                    <article class="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-relaxed text-gray-600 shadow-sm md:col-span-3 md:p-8">
                        <header class="border-b border-slate-100 pb-4">
                            <h1 class="flex items-center gap-2 text-xl font-extrabold text-gray-900 md:text-2xl"><i class="fas ${page.icon} text-brand-700"></i> ${page.title}</h1>
                            <p class="mt-2 text-slate-500">${page.intro}</p>
                        </header>
                        ${page.body()}
                    </article>
                </div>
            `;
}
