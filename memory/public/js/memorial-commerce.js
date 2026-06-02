/**
 * Shop catalog, checkout, order confirmation
 */
window.MemorialCommerce = {
  products: [],
  cart: [],
  cartOpen: false,
  selectedProduct: null,
  stripeAvailable: false,
  paymentConfig: null,
  checkoutMode: "physical",

  async init(useApi) {
    this.cart = this.loadCart();
    this.updateCartUI();
    if (!useApi) {
      this.products = this.fallbackProducts();
      this.renderShopGrids();
      return;
    }
    try {
      const data = await MemorialApi.listProducts();
      this.products = data.products || [];
      if (!this.products.length) this.products = this.fallbackProducts();
    } catch {
      this.products = this.fallbackProducts();
    }
    try {
      const status = await MemorialApi.health();
      this.stripeAvailable = !!status?.stripeEnabled;
      this.paymentConfig = status?.payments || null;
      if (window.MEMORIAL_CONFIG) {
        window.MEMORIAL_CONFIG.stripeEnabled = this.stripeAvailable;
      }
    } catch {
      this.stripeAvailable = !!(
        window.MEMORIAL_CONFIG && window.MEMORIAL_CONFIG.stripeEnabled
      );
    }
    this.renderShopGrids();
    this.checkOrderFromUrl();
  },

  fallbackProducts() {
    return [
      { slug: "white-chrysanthemum", name: "白菊花束·思念", price: 128, listPrice: 168, category: "flower", emoji: "🌼", bg: "linear-gradient(135deg,#f5f5f5,#e8e8e8)", badge: "热销", description: "精选白菊与配叶，适合祭奠与追思。" },
      { slug: "white-wreath", name: "白色祭奠花圈", price: 298, category: "flower", emoji: "💐", bg: "linear-gradient(135deg,#f0f5f0,#e0ede0)", description: "含挽联定制，适合灵堂布置。" },
      { slug: "incense-gift-box", name: "祭祀香薰礼盒", price: 198, listPrice: 238, category: "candle", emoji: "🕯️", bg: "linear-gradient(135deg,#fdf5e8,#f5e8d0)", badge: "新品", description: "天然檀香与莲花蜡烛组合。" },
      { slug: "memorial-album", name: "精装纪念相册", price: 688, category: "gift", emoji: "📖", bg: "linear-gradient(135deg,#e8e8f5,#d8d8ed)", description: "30页硬壳相册，含排版服务。" },
      { slug: "memorial-tree", name: "代为种植纪念树", price: 168, category: "plant", emoji: "🌳", bg: "linear-gradient(135deg,#e8f5e8,#d0edd0)", badge: "环保", description: "附证书与坐标。" },
      { slug: "qr-plaque", name: "QR二维码铭牌", price: 388, category: "gift", emoji: "📱", bg: "linear-gradient(135deg,#1a1a1a,#2a2a2a)", description: "不锈钢激光蚀刻，扫码直达纪念馆。" },
      { slug: "brass-plaque", name: "黄铜典藏铭牌", price: 588, category: "gift", emoji: "🥉", bg: "linear-gradient(135deg,#8b6914,#5a4010)", description: "铸造黄铜磨砂工艺，含红木底座。" },
      { slug: "stainless-plaque", name: "经典不锈钢铭牌", price: 298, category: "gift", emoji: "🪨", bg: "linear-gradient(135deg,#c8c8c8,#888)", description: "304不锈钢，8×5cm，附安装配件。" },
      { slug: "plan-premium-year", name: "高级版会员（年付）", price: 399, category: "plan", emoji: "✨", bg: "linear-gradient(135deg,#f4f3f0,#e8e6e0)", description: "全部主题、无限照片与 AI 讣告。" },
      { slug: "plan-lifetime", name: "终身版会员", price: 999, category: "plan", emoji: "♾️", bg: "linear-gradient(135deg,#1a1a1a,#3a3a3a)", description: "一次付费，永久享有高级版权益。" },
    ];
  },

  loadCart() {
    try {
      return JSON.parse(localStorage.getItem("nianguichu_cart_v1") || "[]");
    } catch {
      return [];
    }
  },

  saveCart() {
    localStorage.setItem("nianguichu_cart_v1", JSON.stringify(this.cart));
  },

  productCard(p, detailFn) {
    if (window.MemorialI18n) p = MemorialI18n.localizeProduct(p);
    const esc = MemorialStore.escapeHtml;
    const list =
      p.listPrice && p.listPrice > p.price
        ? `<span>¥${p.listPrice}</span>`
        : "";
    return `
    <div class="product-card" data-cat="${p.category}" onclick="${detailFn}('${esc(p.slug)}')">
      <div class="product-img" style="background:${p.bg || "#eee"}">${p.emoji || "🛍️"}${p.badge ? `<div class="product-badge">${esc(p.badge)}</div>` : ""}</div>
      <div class="product-body">
        <div class="product-name">${esc(p.name)}</div>
        <div class="product-price">¥${p.price}${list}</div>
      </div>
    </div>`;
  },

  renderShopGrids() {
    const html = this.products
      .map((p) => this.productCard(p, "MemorialCommerce.openProduct"))
      .join("");
    ["shop-products-grid", "shop-page-grid"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        const empty =
          window.MemorialI18n?.t("shop.empty") || "暂无商品";
        el.innerHTML =
          html ||
          `<p class="p0-empty" style="padding:24px;grid-column:1/-1">${empty}</p>`;
      }
    });
    const qr = document.getElementById("qr-products-grid");
    if (qr) {
      const qrProducts = this.products.filter((p) =>
        ["qr-plaque", "brass-plaque", "stainless-plaque"].includes(p.slug)
      );
      const list = qrProducts.length
        ? qrProducts
        : this.products.filter((p) => p.category === "gift").slice(0, 3);
      qr.innerHTML = list
        .map(
          (p) => `
        <div class="qr-prod-card">
          <div class="qr-prod-visual" style="background:${p.bg}">${p.emoji}</div>
          <div class="qr-prod-info">
            <div class="qr-prod-name">${MemorialStore.escapeHtml(p.name)}</div>
            <div class="qr-prod-desc">${MemorialStore.escapeHtml(p.description || "")}</div>
            <div class="qr-prod-price">¥${p.price}<button class="qr-prod-btn" onclick="event.stopPropagation();MemorialCommerce.addBySlug('${MemorialStore.escapeHtml(p.slug)}')">加入购物车</button></div>
          </div>
        </div>`
        )
        .join("");
    }
  },

  filterShop(cat, el) {
    document.querySelectorAll(".shop-cat").forEach((t) => t.classList.remove("active"));
    if (el) el.classList.add("active");
    document
      .querySelectorAll("#shop-products-grid .product-card, #shop-page-grid .product-card")
      .forEach((card) => {
        card.style.display =
          cat === "all" || card.dataset.cat === cat ? "block" : "none";
      });
  },

  updatePlaquePreview() {
    const name = document.getElementById("plaque-name")?.value?.trim() || "—";
    const years = document.getElementById("plaque-years")?.value?.trim() || "";
    const quote =
      document.getElementById("plaque-inscription")?.value?.trim() || "";
    const nameEl = document.getElementById("plaque-preview-name");
    const yearsEl = document.getElementById("plaque-preview-years");
    const quoteEl = document.getElementById("plaque-preview-quote");
    if (nameEl) nameEl.textContent = name;
    if (yearsEl) yearsEl.textContent = years;
    if (quoteEl) quoteEl.textContent = quote;

    const qrWrap = document.getElementById("plaque-preview-qr");
    const slug = window.MemorialCore?.slug || "li-mingde";
    if (qrWrap && window.MemorialCore?.useApi && window.MemorialApi) {
      qrWrap.innerHTML = `<img src="${MemorialApi.base}/api/memorials/${encodeURIComponent(slug)}/qr" alt="纪念馆二维码" width="88" height="88" style="background:#fff;padding:6px;border-radius:6px;margin-bottom:12px" onerror="this.outerHTML='📱'"/>`;
    } else if (qrWrap) {
      qrWrap.innerHTML = '<div style="font-size:48px;margin-bottom:12px">📱</div>';
    }
  },

  addPlaqueToCart() {
    const slug = document.getElementById("plaque-material")?.value || "qr-plaque";
    const base = this.findProduct(slug);
    if (!base) {
      showToast("请选择铭牌材质");
      return;
    }
    const name = document.getElementById("plaque-name")?.value?.trim() || "";
    const years = document.getElementById("plaque-years")?.value?.trim() || "";
    const inscription =
      document.getElementById("plaque-inscription")?.value?.trim() || "";
    const label = name ? `${base.name}（${name}）` : base.name;
    const custom = {
      ...base,
      name: label,
      plaqueMeta: { name, years, inscription, materialSlug: slug },
    };
    this.addToCart(custom);
    showToast("铭牌已加入购物车，结算时可填写收货地址");
  },

  findProduct(slug) {
    return this.products.find((p) => p.slug === slug);
  },

  addBySlug(slug) {
    const p = this.findProduct(slug);
    if (p) this.addToCart(p);
  },

  addToCart(product, qty) {
    const q = qty || 1;
    const catalog = this.findProduct(product.slug) || product;
    const existing = this.cart.find((i) => i.slug === catalog.slug);
    if (existing) {
      existing.qty += q;
      existing.price = catalog.price;
      existing.name = catalog.name;
    } else {
      this.cart.push({
        slug: catalog.slug,
        name: catalog.name,
        price: catalog.price,
        qty: q,
      });
    }
    this.saveCart();
    this.updateCartUI();
    showToast(product.name + " 已加入购物车");
  },

  removeFromCart(index) {
    this.cart.splice(index, 1);
    this.saveCart();
    this.updateCartUI();
  },

  updateCartUI() {
    const fab = document.getElementById("cart-fab");
    const badge = document.getElementById("cart-badge");
    const items = document.getElementById("cart-items");
    const total = document.getElementById("cart-total");
    const count = this.cart.reduce((s, i) => s + i.qty, 0);
    const sum = this.cart.reduce((s, i) => s + i.price * i.qty, 0);
    if (badge) badge.textContent = count;
    if (fab) fab.classList.toggle("show", count > 0);
    if (items) {
      items.innerHTML = this.cart
        .map(
          (item, i) => `
        <div class="cart-item">
          <span class="cart-item-icon">🛍️</span>
          <span class="cart-item-name">${MemorialStore.escapeHtml(item.name)} ×${item.qty}</span>
          <span class="cart-item-price">¥${item.price * item.qty}</span>
          <button class="cart-item-del" onclick="MemorialCommerce.removeFromCart(${i})">✕</button>
        </div>`
        )
        .join("");
    }
    if (total) total.textContent = "¥" + sum;
  },

  toggleCart() {
    this.cartOpen = !this.cartOpen;
    document.getElementById("cart-drawer")?.classList.toggle("open", this.cartOpen);
    document.getElementById("cart-backdrop")?.classList.toggle("open", this.cartOpen);
  },

  cartIsDigitalOnly() {
    return this.cart.every((i) => {
      const p = this.findProduct(i.slug);
      return p?.category === "plan";
    });
  },

  purchaseMembership(planSlug) {
    const p = this.findProduct(planSlug);
    if (!p) {
      showToast("会员商品未加载，请刷新后重试");
      return;
    }
    if (!window.MemorialAuth?.user) {
      showToast("请先登录后再购买会员");
      if (window.MemorialAuth) MemorialAuth.openPage("login");
      return;
    }
    this.cart = [{ slug: p.slug, name: p.name, price: p.price, qty: 1 }];
    this.saveCart();
    this.updateCartUI();
    this.checkoutMode = "membership";
    this.openCheckout();
  },

  openCheckout() {
    if (!this.cart.length) {
      showToast(window.MemorialI18n?.isEn() ? "Cart is empty" : "购物车为空");
      return;
    }
    const sum = this.cart.reduce((s, i) => s + i.price * i.qty, 0);
    if (sum <= 0) {
      showToast(
        window.MemorialI18n?.isEn()
          ? "Invalid order total"
          : "订单金额无效，请重新选择商品"
      );
      return;
    }
    this.cartOpen = false;
    document.getElementById("cart-drawer")?.classList.remove("open");
    document.getElementById("cart-backdrop")?.classList.remove("open");
    const checkout = document.getElementById("checkout-modal");
    if (checkout) {
      checkout.classList.add("open");
      checkout.setAttribute("aria-hidden", "false");
      checkout.scrollTop = 0;
      document.body.style.overflow = "hidden";
    }
    this.renderCheckoutFormI18n();

    const digital = this.cartIsDigitalOnly();
    const shipBlock = document.getElementById("checkout-shipping-block");
    if (shipBlock) {
      shipBlock.style.display = digital ? "none" : "block";
    }
    const shipHint = document.getElementById("checkout-digital-hint");
    if (shipHint) {
      shipHint.style.display = digital ? "block" : "none";
    }

    const user = window.MemorialAuth?.user;
    if (user) {
      const emailEl = document.getElementById("co-email");
      const nameEl = document.getElementById("co-name");
      const phoneEl = document.getElementById("co-phone");
      const loginId = user.email?.includes("@nianguichu.local")
        ? user.phone || ""
        : user.email;
      if (emailEl && !emailEl.value) {
        emailEl.value = user.email?.includes("@nianguichu.local")
          ? ""
          : user.email;
      }
      if (phoneEl && !phoneEl.value && loginId && /^1\d{10}$/.test(String(loginId))) {
        phoneEl.value = loginId;
      }
      if (nameEl && !nameEl.value && user.name) nameEl.value = user.name;
    }

    const method = document.querySelector('input[name="pay-method"]:checked');
    if (method) method.checked = true;

    const summary = document.getElementById("checkout-summary");
    if (summary) {
      summary.innerHTML = this.cart
        .map(
          (i) =>
            `<div class="checkout-line">${MemorialStore.escapeHtml(i.name)} ×${i.qty} — ¥${(i.price * i.qty).toFixed(2)}</div>`
        )
        .join("");
      summary.innerHTML += `<div class="checkout-total-line">合计：¥${sum.toFixed(2)}</div>`;
    }
  },

  closeCheckout() {
    const checkout = document.getElementById("checkout-modal");
    checkout?.classList.remove("open");
    checkout?.setAttribute("aria-hidden", "true");
    document.getElementById("cart-backdrop")?.classList.remove("open");
    document.body.style.overflow = "";
  },

  renderCheckoutFormI18n() {
    const I = window.MemorialI18n;
    if (!I) return;
    const t = (k, fb) => I.t(k) || fb;
    const map = [
      ["co-name", "checkout.name", "联系人姓名 *", "Contact name *"],
      ["co-email", "checkout.email", "联系邮箱 *", "Email *"],
      ["co-phone", "checkout.phone", "手机号 *", "Phone *"],
      ["co-province", "checkout.province", "省份 *", "Province *"],
      ["co-city", "checkout.city", "城市 *", "City *"],
      ["co-address", "checkout.address", "详细地址 *", "Street address *"],
      ["co-postal", "checkout.postal", "邮编（可选）", "Postal code (optional)"],
      ["co-note", "checkout.note", "备注（可选）", "Note (optional)"],
    ];
    map.forEach(([id, key, zh, en]) => {
      const el = document.getElementById(id);
      if (el) el.placeholder = t(key, I.isEn() ? en : zh);
    });
    const hint = document.getElementById("checkout-digital-hint");
    if (hint) {
      hint.textContent = t(
        "checkout.digitalHint",
        I.isEn()
          ? "Digital membership needs no shipping address."
          : "数字会员服务无需填写收货地址，支付后为您开通。"
      );
    }
    const legend = document.querySelector("#checkout-modal .payment-methods legend");
    if (legend) legend.textContent = t("checkout.payLegend", I.isEn() ? "Payment" : "支付方式");
    const submitBtn = document.querySelector("#checkout-modal .submit-btn");
    if (submitBtn) {
      submitBtn.textContent = t(
        "checkout.submit",
        I.isEn() ? "Place order & pay" : "提交订单并支付"
      );
    }
    const head = document.querySelector("#checkout-modal .modal-head h3");
    if (head) head.textContent = t("checkout.title", I.isEn() ? "Checkout" : "确认订单");
  },

  getSelectedPaymentMethod() {
    const el = document.querySelector('input[name="pay-method"]:checked');
    return el?.value || "alipay";
  },

  async submitCheckout(paymentMethod) {
    const method = paymentMethod || this.getSelectedPaymentMethod();
    const digital = this.cartIsDigitalOnly();
    const email = document.getElementById("co-email")?.value?.trim();
    const phone = document.getElementById("co-phone")?.value?.trim();
    const contactEmail =
      email ||
      (phone ? `phone_${phone.replace(/\s/g, "")}@nianguichu.local` : "");

    const payload = {
      contactName: document.getElementById("co-name")?.value?.trim(),
      contactEmail,
      contactPhone: phone,
      shippingProvince: document.getElementById("co-province")?.value?.trim(),
      shippingCity: document.getElementById("co-city")?.value?.trim(),
      shippingAddress: document.getElementById("co-address")?.value?.trim(),
      shippingPostal: document.getElementById("co-postal")?.value?.trim(),
      note: document.getElementById("co-note")?.value?.trim(),
      memorialSlug: window.MemorialCore?.slug,
      items: this.cart.map((i) => ({
        slug: i.slug,
        qty: i.qty,
        name: i.name,
      })),
      paymentMethod: method,
    };

    const I = window.MemorialI18n;
    if (!payload.contactName || !payload.contactPhone) {
      showToast(
        I?.isEn()
          ? "Please enter contact name and phone"
          : "请填写联系人姓名与手机号"
      );
      return;
    }
    if (!contactEmail || !contactEmail.includes("@")) {
      showToast(I?.isEn() ? "Please enter a valid email" : "请填写有效联系邮箱");
      return;
    }
    if (
      !digital &&
      (!payload.shippingAddress ||
        !payload.shippingCity ||
        !payload.shippingProvince)
    ) {
      showToast(
        I?.isEn()
          ? "Please enter full shipping address"
          : "实物商品请填写完整收货地址"
      );
      return;
    }

    const orderTotal = this.cart.reduce((s, i) => s + i.price * i.qty, 0);

    if (window.MemorialCore?.useApi) {
      try {
        const res = await MemorialApi.createOrder(payload);
        this.closeCheckout();
        this.cart = [];
        this.saveCart();
        this.updateCartUI();
        if (res.checkoutUrl) {
          window.location.href = res.checkoutUrl;
          return;
        }
        if (res.payment) {
          this.showPaymentPage(res.orderNumber, res.total, res.paymentMethod, res.payment);
        } else {
          this.showOrderConfirm(res.orderNumber, res.total, res.paymentMethod);
        }
        return;
      } catch (e) {
        showToast(e.message);
        return;
      }
    }

    this.closeCheckout();
    this.cart = [];
    this.saveCart();
    this.updateCartUI();
    this.showOrderConfirm(
      "NG-DEMO-" + Date.now().toString(36).toUpperCase(),
      orderTotal,
      "inquiry"
    );
  },

  paymentMethodLabel(method) {
    const map = {
      stripe: "Stripe 在线支付",
      alipay: "支付宝",
      wechat: "微信支付",
      bank: "银行转账",
      inquiry: "支付宝",
    };
    return map[method] || method;
  },

  showOrderConfirm(orderNumber, total, method) {
    const page = document.getElementById("page-order-confirm");
    if (!page) return;
    document.getElementById("order-num").textContent = orderNumber;
    document.getElementById("order-total").textContent =
      typeof total === "number" ? "¥" + total.toFixed(2) : "¥" + total;
    document.getElementById("order-method").textContent =
      this.paymentMethodLabel(method);
    goPage("order-confirm");
  },

  showPaymentPage(orderNumber, total, method, payment) {
    const body = document.getElementById("payment-page-body");
    if (!body) {
      this.showOrderConfirm(orderNumber, total, method);
      return;
    }
    const en = window.MemorialI18n?.isEn();
    const qr =
      payment.qrUrl
        ? `<div class="payment-qr-wrap"><img src="${MemorialStore.escapeHtml(payment.qrUrl)}" alt="${en ? "QR code" : "收款码"}" class="payment-qr" /></div>`
        : `<p class="payment-no-qr">${en ? "QR code will be sent by support — include your order number when paying." : "收款码由客服提供，请备注订单号完成支付。"}</p>`;
    const steps = (payment.steps || [])
      .map((s) => `<li>${MemorialStore.escapeHtml(s)}</li>`)
      .join("");
    body.innerHTML = `
      <div class="payment-page-card">
        <p class="payment-page-kicker">${en ? "Payment due" : "待支付"}</p>
        <h1 class="payment-page-title">${MemorialStore.escapeHtml(payment.title || (en ? "Complete payment" : "完成支付"))}</h1>
        <p class="payment-page-amount">¥${Number(total).toFixed(2)}</p>
        <p class="payment-page-order">${en ? "Order" : "订单号"}：<strong>${MemorialStore.escapeHtml(orderNumber)}</strong></p>
        ${qr}
        <ol class="payment-steps">${steps}</ol>
        <button type="button" class="submit-btn" style="width:100%" onclick="MemorialCommerce.finishPayment('${MemorialStore.escapeHtml(orderNumber)}',${total},'${MemorialStore.escapeHtml(method)}')">${en ? "I have paid" : "我已完成支付"}</button>
        <button type="button" class="obit-back-btn" style="width:100%;margin-top:10px" onclick="goPage('home')">${en ? "Back to home" : "返回首页"}</button>
      </div>`;
    goPage("payment");
    window.scrollTo(0, 0);
  },

  finishPayment(orderNumber, total, method) {
    this.showOrderConfirm(orderNumber, total, method);
    showToast("感谢支付，客服将尽快确认并开通服务");
  },

  async checkOrderFromUrl() {
    const params = new URLSearchParams(location.search);
    const order = params.get("order");
    if (!order) return;
    const paid = params.get("paid");
    if (paid === "1") {
      let total = "—";
      if (window.MemorialCore?.useApi) {
        try {
          const data = await MemorialApi.getOrder(order);
          total = data.order?.total ?? total;
        } catch {
          /* ignore */
        }
      }
      this.showOrderConfirm(order, total, "stripe");
      showToast("支付成功，感谢您的订购");
      history.replaceState({}, "", location.pathname);
    }
  },

  async openProduct(slug) {
    const local = this.findProduct(slug);
    if (window.MemorialCore?.useApi) {
      try {
        const data = await MemorialApi.getProduct(slug);
        this.selectedProduct = data.product;
      } catch {
        this.selectedProduct = local;
      }
    } else {
      this.selectedProduct = local;
    }
    if (!this.selectedProduct) return;
    this.renderProductPage(this.selectedProduct);
    goPage("product-detail");
  },

  renderProductPage(p) {
    const root = document.getElementById("product-detail-root");
    if (!root) return;
    const esc = MemorialStore.escapeHtml;
    const list =
      p.listPrice && p.listPrice > p.price
        ? `<span class="product-detail-list">¥${p.listPrice}</span>`
        : "";
    const specs = [
      { label: "分类", value: this.categoryLabel(p.category) },
      { label: "配送", value: p.category === "plan" ? "数字服务 · 即时开通" : "全国配送" },
      { label: "编号", value: p.slug },
    ];
    root.innerHTML = `
      <nav class="product-breadcrumb"><button type="button" class="obit-back-btn" onclick="goPage('shop')">← 返回商城</button></nav>
      <div class="product-detail-layout">
        <div class="product-detail-visual" style="background:${p.bg || "#eee"}">
          <span class="product-detail-emoji">${p.emoji || "🛍️"}</span>
          ${p.badge ? `<span class="product-detail-badge">${esc(p.badge)}</span>` : ""}
        </div>
        <div class="product-detail-main">
          <h1>${esc(p.name)}</h1>
          <div class="product-detail-price-row">¥${p.price} ${list}</div>
          <p class="product-detail-desc">${esc(p.description || "暂无详细说明")}</p>
          <ul class="product-spec-list">${specs.map((s) => `<li><span>${esc(s.label)}</span><strong>${esc(s.value)}</strong></li>`).join("")}</ul>
          <div class="product-detail-actions">
            <button type="button" class="submit-btn" onclick="MemorialCommerce.addBySlug('${esc(p.slug)}');showToast('已加入购物车')">加入购物车</button>
            <button type="button" class="obit-action-btn primary" onclick="MemorialCommerce.addBySlug('${esc(p.slug)}');MemorialCommerce.openCheckout()">立即购买</button>
          </div>
        </div>
      </div>`;
  },

  categoryLabel(cat) {
    const map = {
      flower: "鲜花花圈",
      candle: "蜡烛香品",
      gift: "纪念礼品",
      plant: "种植纪念",
      plan: "会员服务",
    };
    return map[cat] || cat;
  },
};

function addToCart(name, price) {
  const p = MemorialCommerce.products.find((x) => x.name === name);
  if (p) MemorialCommerce.addToCart(p);
  else showToast("该商品暂不可下单，请从商城选择");
}

function filterShop(el, cat) {
  MemorialCommerce.filterShop(cat, el);
}

function toggleCart() {
  MemorialCommerce.toggleCart();
}

function submitCartInquiry() {
  MemorialCommerce.openCheckout();
}

function removeCart(i) {
  MemorialCommerce.removeFromCart(i);
}

function updateCart() {
  MemorialCommerce.updateCartUI();
}
