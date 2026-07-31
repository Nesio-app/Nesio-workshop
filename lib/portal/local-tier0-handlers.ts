/**
 * Tier 0 本地处理器 —— 端上识别 / 本地搜索 / 离线兜底
 *
 * 免费用户的确定性基础版实现。这些都是客户端可以独立完成的任务：
 * - 图片识别：端上 OCR(Vision 插件真认字)+ 从认出的字里取标签
 * - 语音问答：本地语义搜索（不需要云对话）
 * - 邮件富化：元数据 + 正则（不需要云 LLM）
 *
 * 所有函数返回 { result, confidence, source: 'local' } 格式。
 */

import { LifeNode, searchLifeGraphFuzzy } from './life-graph';

export interface LocalHandlerResult<T = any> {
  result: T;
  confidence: number; // 0-1，Tier 0 结果的置信度
  source: 'local';
}

/**
 * 端上图片识别 —— **真的在这台设备上认字**(2026-07-31 重写)。
 *
 * ## 之前这里是假的
 *
 * 原实现把图画进 canvas,统计平均 RGB 和亮度,产出 `red-toned` / `bright` /
 * `desaturated` 这类标签;OCR 那一行写着「这里简化为空,实际应集成 Tesseract.js」,
 * 于是 `text` 恒为 `''`。
 *
 * 后果比「没有识别」更糟:聊天那几处把这些标签当**节点名**显示 ——
 * 用户看到的是「识别到:blue-toned、bright」,还会被当成记忆存下来。
 * 一条走不通的路,伪装成走通了。
 *
 * ## 现在
 *
 * 走 `understandImage`(端上 Vision 插件,VNRecognizeTextRequest)——
 * 真认字、免费、离线、图一个字节不出手机。认不了就如实说认不了,
 * 不再拿色调糊弄。标签从**认出来的字**里取,不从像素平均值里编。
 */
export async function recognizeImageLocally(
  imageData: string | Blob | File
): Promise<LocalHandlerResult<{
  tags: string[];
  text: string;
  confidence: number;
  /** 这台设备认不了字时的那句人话。有它就说明 text 一定是空的。 */
  unavailable?: string;
}>> {
  const { understandImage, tagsFromText } = await import('./image-understand');
  const seen = await understandImage(imageData);
  // 认出字了才谈得上置信度;认不出就是 0,别给一个「0.5」让上游以为半信半疑。
  const confidence = seen.text.trim() ? (seen.fields ? 0.95 : 0.7) : 0;
  return {
    result: {
      tags: tagsFromText(seen.text, 6),
      text: seen.text,
      confidence,
      ...(seen.visionMessage ? { unavailable: seen.visionMessage } : {}),
    },
    confidence,
    source: 'local',
  };
}


/**
 * 本地语义搜索 —— 基于关键词和 fuzzy 匹配
 *
 * Tier 0 限制：
 * - 纯关键词 + 模糊匹配（不需要语义理解）
 * - 返回 Top-K 候选（不排序得分）
 * - 仅搜索已缓存的本地数据
 */
export async function searchMemoriesLocally(
  query: string,
  limit: number = 6
): Promise<LocalHandlerResult<LifeNode[]>> {
  try {
    // 使用已有的本地 fuzzy 搜索（life-graph.ts）
    const hits = searchLifeGraphFuzzy(query, limit);

    return {
      result: hits,
      confidence: 0.6, // 本地搜索置信度
      source: 'local',
    };
  } catch (error) {
    throw new Error(
      `本地搜索失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/*
 * 【删掉了 rerankedResultsLocally】(2026-07-31)
 *
 * 它的「相关度」是 `score: Math.random()` —— 排出来的顺序和查询无关,
 * 纯随机。注释里写着「简化:实际应用端上 embedding 模型」,而那个模型不存在。
 * 全仓零调用点,所以今天没人被它坑到;但它顶着 Tier 0 处理器的名字躺在这里,
 * 下一个人接线时会以为它能用 —— 那时候的表现是「搜索结果每次都不一样」,
 * 而代码看着挺对。没实现的东西不留占位。
 *
 * 真要做端上重排,走 lib/portal/semantic-rerank.ts 那条(已有纯本地分支)。
 */

/**
 * 本地邮件富化 —— 元数据提取 + 正则
 *
 * Tier 0 限制：
 * - 仅提取基础元数据（发件人、主题、日期）
 * - 用正则识别常见模式（电话、地址、日期）
 * - 不进行内容理解或 NLP
 *
 * @param email 原始邮件对象
 */
export async function enrichEmailLocally(email: {
  from?: string;
  subject?: string;
  body?: string;
  date?: string;
}): Promise<LocalHandlerResult<{
  metadata: Record<string, any>;
  entities: {
    phones: string[];
    emails: string[];
    dates: string[];
  };
}>> {
  try {
    const metadata: Record<string, any> = {};
    const entities = {
      phones: [] as string[],
      emails: [] as string[],
      dates: [] as string[],
    };

    // 基础元数据
    if (email.from) metadata.from = email.from;
    if (email.subject) metadata.subject = email.subject;
    if (email.date) metadata.date = email.date;

    // 正则提取实体
    const phoneRegex = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const dateRegex =
      /\b(?:\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/g;

    if (email.body) {
      entities.phones = [...(email.body.match(phoneRegex) || [])].slice(0, 5);
      entities.emails = [...(email.body.match(emailRegex) || [])].slice(0, 5);
      entities.dates = [...(email.body.match(dateRegex) || [])].slice(0, 5);
    }

    return {
      result: { metadata, entities },
      confidence: 0.7, // 元数据提取置信度较高
      source: 'local',
    };
  } catch (error) {
    throw new Error(
      `本地邮件富化失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 余弦相似度计算 —— 供本地重排使用
 */
export function cosineSimilarity(
  a: ArrayLike<number>,
  b: ArrayLike<number>
): number {
  let dot = 0,
    na = 0,
    nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}
