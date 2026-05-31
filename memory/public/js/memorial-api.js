/**
 * API client — syncs with Next.js backend when deployed on VPS
 */
window.MemorialApi = {
  base: (window.MEMORIAL_CONFIG && window.MEMORIAL_CONFIG.apiBase) || "",

  assetUrl(path) {
    if (!path) return "";
    if (path.startsWith("http://") || path.startsWith("https://")) {
      try {
        const u = new URL(path);
        if (u.pathname.startsWith("/uploads/")) {
          return this.base + "/api" + u.pathname;
        }
      } catch {
        /* ignore */
      }
      return path;
    }
    if (path.startsWith("/uploads/")) {
      return this.base + "/api" + path;
    }
    return this.base + path;
  },

  async request(path, options = {}) {
    const res = await fetch(this.base + path, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      const err = new Error(json.error || res.statusText || "请求失败");
      err.status = res.status;
      throw err;
    }
    return json.data;
  },

  async health() {
    try {
      return await this.request("/api/integrations/status");
    } catch {
      return null;
    }
  },

  async me() {
    return this.request("/api/auth/me");
  },

  async login({ email, password }) {
    return this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  async logout() {
    return this.request("/api/auth/logout", { method: "POST" });
  },

  async listMemorials() {
    return this.request("/api/memorials");
  },

  async searchMemorials(q) {
    const params = new URLSearchParams({ q });
    return this.request("/api/memorials/search?" + params.toString());
  },

  async getMemorial(slug) {
    return this.request("/api/memorials/" + encodeURIComponent(slug));
  },

  async patchMemorial(slug, patch) {
    return this.request("/api/memorials/" + encodeURIComponent(slug), {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },

  async addRitual(slug, { type, message, author }) {
    return this.request("/api/rituals", {
      method: "POST",
      body: JSON.stringify({ slug, type, message, author }),
    });
  },

  async addFragment(slug, payload) {
    return this.request("/api/fragments", {
      method: "POST",
      body: JSON.stringify({ slug, ...payload }),
    });
  },

  async approveFragment(slug, fragmentId) {
    return this.request("/api/fragments/approve", {
      method: "POST",
      body: JSON.stringify({ slug, fragmentId }),
    });
  },

  async subscribeReminder(slug, email) {
    return this.request("/api/reminders", {
      method: "POST",
      body: JSON.stringify({ slug, email }),
    });
  },

  async createMemorial(payload) {
    return this.request("/api/memorials", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async listPublicMemorials() {
    return this.request("/api/memorials/public");
  },

  async submitInquiry(payload) {
    return this.request("/api/inquiries", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async listArticles(cat) {
    const q = cat && cat !== "all" ? "?cat=" + encodeURIComponent(cat) : "";
    return this.request("/api/articles" + q);
  },

  async getArticle(id) {
    return this.request("/api/articles/" + encodeURIComponent(id));
  },

  async createArticle(payload) {
    return this.request("/api/articles", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async listProducts(cat) {
    const q = cat && cat !== "all" ? "?cat=" + encodeURIComponent(cat) : "";
    return this.request("/api/products" + q);
  },

  async getProduct(slug) {
    return this.request("/api/products/" + encodeURIComponent(slug));
  },

  async createOrder(payload) {
    return this.request("/api/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async getOrder(orderNumber) {
    const params = new URLSearchParams({ orderNumber });
    return this.request("/api/orders?" + params.toString());
  },

  async listMedia(slug) {
    return this.request(
      "/api/memorials/" + encodeURIComponent(slug) + "/media"
    );
  },

  async uploadMedia(slug, formData) {
    const res = await fetch(
      this.base + "/api/memorials/" + encodeURIComponent(slug) + "/media",
      {
        method: "POST",
        credentials: "include",
        body: formData,
      }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      const err = new Error(json.error || res.statusText || "上传失败");
      err.status = res.status;
      throw err;
    }
    return json.data;
  },

  async deleteMedia(slug, mediaId) {
    return this.request(
      "/api/memorials/" +
        encodeURIComponent(slug) +
        "/media/" +
        encodeURIComponent(mediaId),
      { method: "DELETE" }
    );
  },

  qrUrl(slug) {
    return this.base + "/api/memorials/" + encodeURIComponent(slug) + "/qr";
  },

  async sendCode({ channel, target }) {
    return this.request("/api/auth/send-code", {
      method: "POST",
      body: JSON.stringify({ channel, target }),
    });
  },

  async register(payload) {
    return this.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async updateProfile(payload) {
    return this.request("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  async listMyMemorials() {
    return this.request("/api/memorials");
  },
};
