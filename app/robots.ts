import type { MetadataRoute } from 'next';

/**
 * robots.txt(2026-07-31 用户:「谷歌可以搜到……可以搜不到么」)。
 *
 * ── 为什么这里是 allow 而不是 disallow ──────────────────────────────────────
 * 直觉上「不想被搜到」就该写 `Disallow: /`。**那样反而撤不掉已经被收录的条目。**
 *
 * robots.txt 管的是**能不能爬**,不是**能不能收录**。写了 Disallow 之后:
 *   · 爬虫不再访问页面 → 看不到响应头里的 `X-Robots-Tag: noindex`
 *   · 于是它没有理由把旧条目撤下来 → 那行搜索结果**留在原地**,
 *     只是从此没有摘要,变成一行光秃秃的网址(反而更显眼)
 *
 * 正确的顺序是反过来的:**先让它进得来、看到 noindex、把条目撤掉**。
 * 所以这里放行全站,真正说「别收录」的是 next.config.js 里的 X-Robots-Tag,
 * 以及 app/layout.tsx metadata 里的 robots 字段。三处口径一致。
 *
 * 哪天确认索引已经清空、想彻底省下爬虫流量,再改成 Disallow 也不迟 ——
 * 但顺序不能颠倒。
 *
 * sitemap 一个都不给:那是主动请人来收录用的,和这件事正好相反。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // 放行,好让爬虫读到 noindex 并把旧条目撤掉(理由见上)。
        allow: '/',
        // 这几条路径本来就不该被任何人当页面抓:API 是数据面、admin 是运维面。
        // 它们各自有鉴权,这里挡一道只是省流量、也少一层无意义的暴露面。
        disallow: ['/api/', '/admin'],
      },
    ],
  };
}
