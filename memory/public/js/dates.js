/** 追思节律：头七、七七、周年、清明 */
window.MemorialDates = {
  parseDate(iso) {
    const d = new Date(iso + "T12:00:00");
    return Number.isNaN(d.getTime()) ? null : d;
  },

  formatZh(date) {
    if (!date) return "";
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const day = date.getDate();
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    return `${y}年${m}月${day}日（周${weekdays[date.getDay()]}）`;
  },

  addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  },

  nextQingming(from = new Date()) {
    const year = from.getFullYear();
    // 清明约 4月4–6日，简化为 4月5日
    let q = new Date(year, 3, 5, 9, 0, 0);
    if (q < from) q = new Date(year + 1, 3, 5, 9, 0, 0);
    return q;
  },

  /** @param {{ birthDate?: string, deathDate: string }} */
  buildSchedule({ birthDate, deathDate }) {
    const death = this.parseDate(deathDate);
    if (!death) return [];

    const items = [
      {
        id: "touqi",
        labelKey: "touqi",
        label: "头七",
        date: this.addDays(death, 6),
        note: "传统上为辞世后第七日，家人相聚追思。",
      },
      {
        id: "qiqi",
        labelKey: "qiqi",
        label: "七七",
        date: this.addDays(death, 48),
        note: "四十九日之期，悼念将转入日常的思念。",
      },
      {
        id: "anniversary",
        labelKey: "anniversary",
        label: "周年忌日",
        date: this.addDays(death, 365),
        note: "每年的这一天，门会为家人留着。",
      },
      {
        id: "qingming",
        labelKey: "qingming",
        label: "清明",
        date: this.nextQingming(this.addDays(death, 1)),
        note: "春清明，祭扫与追忆。",
      },
    ];

    const now = new Date();
    return items.map((it) => ({
      ...it,
      dateStr: this.formatZh(it.date),
      isPast: it.date < now,
      daysUntil: Math.ceil((it.date - now) / (86400000)),
    }));
  },
};
