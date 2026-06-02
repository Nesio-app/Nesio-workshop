/** Login / register UI */
window.MemorialAuth = {
  user: null,
  useApi: false,
  _mode: "login",
  _regChannel: "email",

  async init(useApi) {
    this.useApi = !!useApi;
    this.renderNav();
    this.renderAuthPage();
    if (!this.useApi) return;
    await this.refresh();
  },

  async refresh() {
    if (!this.useApi || !window.MemorialApi) return;
    try {
      this.user = (await MemorialApi.me()).user;
    } catch {
      this.user = null;
    }
    this.renderNav();
    this.renderAuthPage();
    if (window.MemorialContent) MemorialContent.renderGuidesAdmin();
    return this.user;
  },

  renderNav() {
    const slot = document.getElementById("nav-auth-slot");
    if (!slot) return;

    if (this.user) {
      const label = this.user.name || this.user.email.split("@")[0];
      const accountLabel = window.MemorialI18n
        ? MemorialI18n.t("auth.account")
        : "我的账户";
      const logoutLabel = window.MemorialI18n
        ? MemorialI18n.t("auth.logout")
        : "退出";
      slot.innerHTML = `
        <button type="button" class="nav-auth-user" title="${MemorialStore.escapeHtml(this.user.email)}" onclick="MemorialAuth.openAccount()">${accountLabel}</button>
        <button type="button" class="nav-auth-btn" onclick="MemorialAuth.logout()">${logoutLabel}</button>
      `;
      return;
    }

    const loginLabel = window.MemorialI18n ? MemorialI18n.t("auth.login") : "登录";
    const demoLabel = window.MemorialI18n ? MemorialI18n.t("auth.demo") : "演示";
    slot.innerHTML = `
      <button type="button" class="nav-auth-btn" onclick="MemorialAuth.openPage('login')">${loginLabel}</button>
      <button type="button" class="nav-auth-btn nav-auth-demo" onclick="MemorialAuth.demoLogin()">${demoLabel}</button>
    `;
  },

  openPage(mode) {
    this._mode = mode || "login";
    if (typeof goPage === "function") goPage("auth");
    this.renderAuthPage();
  },

  openAccount() {
    if (!this.user) {
      this.openPage("login");
      return;
    }
    if (typeof goPage === "function") goPage("account");
    this.renderAccountPage();
  },

  open(mode) {
    this.openPage(mode);
  },

  close() {
    document.getElementById("auth-modal")?.classList.remove("open");
  },

  switchMode(mode) {
    this._mode = mode;
    this.renderAuthPage();
  },

  setRegChannel(channel) {
    this._regChannel = channel;
    this.renderAuthPage();
  },

  getMode() {
    const modal = document.getElementById("auth-modal");
    if (modal?.classList.contains("open")) {
      return modal.dataset.mode !== "register" ? "login" : "register";
    }
    return this._mode === "register" ? "register" : "login";
  },

  wechatEnabled() {
    return !!(
      window.MEMORIAL_CONFIG && window.MEMORIAL_CONFIG.wechatLoginEnabled
    );
  },

  wechatLogin() {
    if (!this.useApi) {
      showToast("请等待服务器连接");
      return;
    }
    const base = window.MemorialApi?.base || "";
    window.location.href = base + "/api/auth/wechat";
  },

  formHtml(isLogin) {
    const offline = !this.useApi;
    const wechatBtn = this.wechatEnabled()
      ? `<button type="button" class="submit-btn secondary wechat-login-btn" style="width:100%;margin-bottom:12px" onclick="MemorialAuth.wechatLogin()">微信扫码登录</button>`
      : "";
    if (isLogin) {
      return `
      <h2 class="auth-title">登录念归处</h2>
      <p class="auth-sub">${
        offline
          ? "当前为离线演示。连接服务器后可登录、上传照片与下单。"
          : "使用注册邮箱或手机号登录"
      }</p>
      <div class="auth-field"><label>邮箱或手机号</label><input id="auth-email" type="text" autocomplete="username" placeholder="邮箱 / 11位手机号" /></div>
      <div class="auth-field"><label>密码</label><input id="auth-password" type="password" autocomplete="current-password" /></div>
      ${wechatBtn}
      <button type="button" class="submit-btn auth-submit" onclick="MemorialAuth.submit()" ${offline ? "disabled" : ""}>登录</button>
      <p class="auth-switch">
        还没有账号？<button type="button" class="auth-link" onclick="MemorialAuth.switchMode('register')">注册</button>
      </p>
      <p class="auth-hint">演示账号：demo@nianguichu.local / demo-demo-demo</p>`;
    }

    const ch = this._regChannel;
    return `
      <h2 class="auth-title">注册账号</h2>
      <p class="auth-sub">${
        offline
          ? "请连接服务器后注册"
          : "邮箱或手机号 + 验证码注册；微信登录即将上线"
      }</p>
      <div class="auth-channel-tabs">
        <button type="button" class="auth-channel-tab ${ch === "email" ? "active" : ""}" onclick="MemorialAuth.setRegChannel('email')">邮箱注册</button>
        <button type="button" class="auth-channel-tab ${ch === "phone" ? "active" : ""}" onclick="MemorialAuth.setRegChannel('phone')">手机注册</button>
        ${
          this.wechatEnabled()
            ? `<button type="button" class="auth-channel-tab" onclick="MemorialAuth.wechatLogin()">微信扫码</button>`
            : `<button type="button" class="auth-channel-tab disabled" disabled title="配置 WECHAT_APP_ID 后启用">微信</button>`
        }
      </div>
      ${
        ch === "phone"
          ? `<div class="auth-field"><label>手机号</label><input id="auth-phone" type="tel" placeholder="11位手机号" maxlength="11" /></div>`
          : `<div class="auth-field"><label>邮箱</label><input id="auth-email" type="email" autocomplete="username" /></div>`
      }
      <div class="auth-field auth-code-row">
        <label>验证码</label>
        <div class="auth-code-inputs">
          <input id="auth-code" type="text" inputmode="numeric" maxlength="6" placeholder="6位验证码" />
          <button type="button" class="obit-action-btn" id="auth-send-code-btn" onclick="MemorialAuth.sendCode()" ${offline ? "disabled" : ""}>获取验证码</button>
        </div>
      </div>
      <div class="auth-field"><label>设置密码（至少8位）</label><input id="auth-password" type="password" autocomplete="new-password" /></div>
      <div class="auth-field"><label>称呼（可选）</label><input id="auth-name" type="text" /></div>
      <button type="button" class="submit-btn auth-submit" onclick="MemorialAuth.submit()" ${offline ? "disabled" : ""}>注册</button>
      <p class="auth-switch">
        已有账号？<button type="button" class="auth-link" onclick="MemorialAuth.switchMode('login')">登录</button>
      </p>`;
  },

  renderAuthPage() {
    const page = document.getElementById("auth-page-body");
    if (!page) return;
    const isLogin = this.getMode() !== "register";
    page.innerHTML = this.formHtml(isLogin);
  },

  renderForm() {
    const body = document.getElementById("auth-modal-body");
    const modal = document.getElementById("auth-modal");
    if (!body || !modal) return;
    const isLogin = modal.dataset.mode !== "register";
    body.innerHTML = this.formHtml(isLogin);
  },

  async sendCode() {
    if (!this.useApi) {
      showToast("请等待服务器连接");
      return;
    }
    const ch = this._regChannel;
    const target =
      ch === "phone"
        ? document.getElementById("auth-phone")?.value?.replace(/\s/g, "")
        : document.getElementById("auth-email")?.value?.trim();
    if (!target) {
      showToast(ch === "phone" ? "请填写手机号" : "请填写邮箱");
      return;
    }
    const btn = document.getElementById("auth-send-code-btn");
    if (btn) btn.disabled = true;
    try {
      const res = await MemorialApi.sendCode({ channel: ch, target });
      showToast(res.message || "验证码已发送");
      let sec = 60;
      const tick = () => {
        if (btn) {
          btn.textContent = sec > 0 ? `${sec}s 后重发` : "获取验证码";
          btn.disabled = sec > 0;
        }
        if (sec-- > 0) setTimeout(tick, 1000);
      };
      tick();
    } catch (e) {
      showToast(e.message);
      if (btn) btn.disabled = false;
    }
  },

  async submit() {
    if (!this.useApi) {
      showToast("请等待服务器连接后再登录");
      return;
    }
    const password = document.getElementById("auth-password")?.value;
    if (!password) {
      showToast("请填写密码");
      return;
    }
    const isLogin = this.getMode() !== "register";
    try {
      if (isLogin) {
        const login = document.getElementById("auth-email")?.value?.trim();
        if (!login) {
          showToast("请填写邮箱或手机号");
          return;
        }
        await MemorialApi.login({ email: login, password });
        showToast("欢迎回来");
      } else {
        const code = document.getElementById("auth-code")?.value?.trim();
        if (!code || code.length !== 6) {
          showToast("请填写6位验证码");
          return;
        }
        const ch = this._regChannel;
        const payload = {
          channel: ch,
          code,
          password,
          name: document.getElementById("auth-name")?.value?.trim() || undefined,
        };
        if (ch === "phone") {
          payload.phone = document
            .getElementById("auth-phone")
            ?.value?.replace(/\s/g, "");
        } else {
          payload.email = document.getElementById("auth-email")?.value?.trim();
        }
        const reg = await MemorialApi.register(payload);
        showToast("注册成功");
        await this.refresh();
        this.close();
        if (window.MemorialCore) await MemorialCore.onAuthChanged();
        if (reg.memorialSlug && window.MemorialCore) {
          await MemorialCore.loadMemorial(reg.memorialSlug);
          goPage("profile-li");
        } else {
          goPage("account");
          this.renderAccountPage();
        }
        return;
      }
      await this.refresh();
      this.close();
      if (window.MemorialCore) await MemorialCore.onAuthChanged();
      if (isLogin) goPage("profile-li");
    } catch (e) {
      showToast(e.message || "操作失败");
    }
  },

  async demoLogin() {
    if (!this.useApi) {
      showToast("服务器未连接，请稍后再试");
      return;
    }
    try {
      await MemorialApi.login({
        email: "demo@nianguichu.local",
        password: "demo-demo-demo",
      });
      showToast("已以演示账号登录");
      await this.refresh();
      if (window.MemorialCore) await MemorialCore.onAuthChanged();
    } catch (e) {
      showToast(e.message || "演示登录失败");
    }
  },

  async logout() {
    if (this.useApi) {
      try {
        await MemorialApi.logout();
      } catch {
        /* ignore */
      }
    }
    this.user = null;
    this.renderNav();
    showToast("已退出登录");
    if (window.MemorialCore) await MemorialCore.onAuthChanged();
  },

  renderAccountPage() {
    const body = document.getElementById("account-page-body");
    if (!body || !this.user) return;
    body.innerHTML = `<p class="p0-empty">加载账户信息…</p>`;
    this.loadAccountData();
  },

  async loadAccountData() {
    const body = document.getElementById("account-page-body");
    if (!body || !this.user) return;
    let memorials = [];
    try {
      const data = await MemorialApi.listMyMemorials();
      memorials = data.memorials || [];
    } catch {
      /* ignore */
    }
    const list =
      memorials.length > 0
        ? memorials
            .map(
              (m) =>
                `<div class="account-memorial-row"><span>${MemorialStore.escapeHtml(m.name)}</span><button type="button" class="obit-action-btn" onclick="MemorialCore.loadMemorial('${MemorialStore.escapeHtml(m.slug)}');goPage('profile-li')">进入</button></div>`
            )
            .join("")
        : `<p class="p0-empty">您还没有纪念馆，可点击下方创建。</p>`;

    body.innerHTML = `
      <h2 class="auth-title">我的账户</h2>
      <p class="auth-sub">${MemorialStore.escapeHtml(this.user.email)}</p>
      <div class="auth-field"><label>显示名称</label><input id="account-name" type="text" value="${MemorialStore.escapeHtml(this.user.name || "")}" /></div>
      <button type="button" class="submit-btn" onclick="MemorialAuth.saveAccount()">保存资料</button>
      <h3 class="account-section-title">我的纪念馆</h3>
      ${list}
      <div class="create-account-box" style="margin-top:20px">
        <p class="p0-hint">创建新纪念馆后，您将成为管理员并可上传照片、选择主题。</p>
        <button type="button" class="submit-btn" data-action="create-memorial" style="margin-top:12px">创建纪念馆</button>
      </div>`;
  },

  async saveAccount() {
    const name = document.getElementById("account-name")?.value?.trim();
    try {
      await MemorialApi.updateProfile({ name: name || undefined });
      showToast("已保存");
      await this.refresh();
    } catch (e) {
      showToast(e.message);
    }
  },

  requireLogin(message) {
    if (this.user) return true;
    showToast(message || "请先登录");
    this.openPage("login");
    return false;
  },

  promptLogin(message) {
    showToast(message || "请先登录");
    this.openPage("login");
  },
};
