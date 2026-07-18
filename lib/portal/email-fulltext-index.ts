/**
 * 邮件全文本机索引(邮件全链路 里程碑 B)—— 让 IndexedDB 里的邮件全文可被搜索命中,
 * 全部本机、零云。
 *
 * 背景:邮件全文只存本机 IndexedDB(nesio-email-bodies,隐私红线不上云),而全平台的
 * 搜索(smartSearch / searchLifeGraphFuzzy)是**同步**线性扫内存图谱,拿不到需要 await 的
 * IndexedDB 全文 —— 所以邮件正文只有 ≤1500 的 article 预览能被搜到,预览之外的内容搜不到。
 *
 * 方案:把邮件全文水合进一个**内存索引**(emailId → 规整后的全文),搜索打分时对邮件节点
 * 叠加「全文命中分」。索引惰性水合(首次搜索触发后台水合,水合完成后续搜索即生效);
 * gmail 同步落全文时增量并入,刚同步的邮件立即可搜。受控容量,防内存膨胀。
 */

const MAX_EMAILS = 1500;      // 索引最多容纳的邮件数(容量护栏)
const MAX_BODY_CHARS = 6000;  // 单封入索引的字符上限(足够覆盖正文主体,防超长邮件吃内存)

let index: Map<string, string> | null = null; // emailId → 规整小写全文
let hydrated = false;
let hydrating = false;

function norm(body: string): string {
  return body.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX_BODY_CHARS);
}

/** 增量并入邮件全文(gmail 同步后调用,让刚同步的邮件立即可搜)。 */
export function indexEmailBodies(map: Record<string, string> | undefined | null): void {
  if (!map) return;
  if (!index) index = new Map();
  for (const [id, body] of Object.entries(map)) {
    if (!id || typeof body !== 'string' || !body) continue;
    // 超容后只更新已存在项,不再新增(容量护栏)
    if (index.size >= MAX_EMAILS && !index.has(id)) continue;
    index.set(id, norm(body));
  }
}

/** 从本机 IndexedDB 一次性水合全文索引(幂等:已水合/正在水合直接返回)。 */
export async function ensureEmailFulltextIndex(): Promise<void> {
  if (hydrated || hydrating) return;
  hydrating = true;
  try {
    const { getAllEmailBodies } = await import('./local-email-body');
    const all = await getAllEmailBodies();
    indexEmailBodies(all);
    hydrated = true;
  } catch {
    /* 索引失败:检索退回预览层,不炸 */
  } finally {
    hydrating = false;
  }
}

export function emailFulltextReady(): boolean {
  return hydrated;
}

/**
 * 同步:邮件全文命中的附加分。索引未就绪则**后台惰性水合**并返回 0(下次搜索生效)。
 * tokens/phrase 均已小写。附加分封顶(整句 +6,每 token +2、最多 6 个)——够把「正文命中但
 * 预览没命中」的邮件顶上来,又不至于盖过标题命中(+14),排序仍合理。
 */
export function emailFulltextScore(emailId: string, tokens: string[], phrase: string): number {
  if (!emailId) return 0;
  // 未全量水合则后台补全其余(不阻塞);但已增量并入的邮件(刚同步的)立即可评分。
  if (!hydrated && !hydrating) void ensureEmailFulltextIndex();
  const body = index?.get(emailId);
  if (!body) return 0;
  let score = 0;
  if (phrase && phrase.length >= 2 && body.includes(phrase)) score += 6;
  let hits = 0;
  for (const t of tokens) {
    if (t.length < 2) continue;
    if (body.includes(t)) { hits++; if (hits <= 6) score += 2; }
  }
  return score;
}
