/**
 * Curated Unsplash visuals (no API key; hotlink for demo/production UI).
 */
window.MemorialVisuals = {
  products: {
    "white-chrysanthemum":
      "https://images.unsplash.com/photo-1490750967868-88ea4486c22f?auto=format&fit=crop&w=800&q=80",
    "white-wreath":
      "https://images.unsplash.com/photo-1519378058454-4c312d16e65c?auto=format&fit=crop&w=800&q=80",
    "incense-gift-box":
      "https://images.unsplash.com/photo-1602874801371-152e07e84524?auto=format&fit=crop&w=800&q=80",
    "memorial-album":
      "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=800&q=80",
    "memorial-tree":
      "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=800&q=80",
    "qr-plaque":
      "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80",
    "brass-plaque":
      "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=800&q=80",
    "stainless-plaque":
      "https://images.unsplash.com/photo-1600607686527-6fb886b2f6bb?auto=format&fit=crop&w=800&q=80",
    "plan-premium-year":
      "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=800&q=80",
    "plan-lifetime":
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80",
  },

  articles: {
    grief: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80",
    ritual: "https://images.unsplash.com/photo-1519682577862-22b492b7b0a5?auto=format&fit=crop&w=800&q=80",
    memory: "https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=800&q=80",
    healing: "https://images.unsplash.com/photo-1499203537929-0ceca55f6352?auto=format&fit=crop&w=800&q=80",
    "funeral-checklist":
      "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=800&q=80",
    "condolence-etiquette":
      "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=800&q=80",
    "inheritance-basics":
      "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=800&q=80",
    "qingming-guide":
      "https://images.unsplash.com/photo-1528164344705-47542687000d?auto=format&fit=crop&w=800&q=80",
  },

  gallery: [
    "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1564890369478-c89ca2ed55e5?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=900&q=80",
  ],

  productImage(slug) {
    return this.products[slug] || null;
  },

  articleImage(id) {
    return this.articles[id] || null;
  },

  galleryImage(index) {
    const list = this.gallery;
    return list[index % list.length] || null;
  },
};
