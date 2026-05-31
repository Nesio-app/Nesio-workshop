export const COPY = {
  anniversaryEmail: {
    subject: (name: string) => `有一个日子，家人或许会想再来看看 — ${name}`,
    body: (name: string, event: string, date: string, url: string) =>
      `${date}，是${name}的${event}。\n\n若您方便，纪念馆的门一直开着：\n${url}\n\n不必回复这封邮件。`,
  },
};
