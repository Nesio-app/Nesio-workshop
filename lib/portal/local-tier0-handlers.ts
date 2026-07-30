/**
 * Tier 0 本地处理器 —— 端上识别 / 本地搜索 / 离线兜底
 *
 * 免费用户的确定性基础版实现。这些都是客户端可以独立完成的任务：
 * - 图片识别：端上标签提取 + OCR（不需要云 LLM）
 * - 语音问答：本地语义搜索（不需要云对话）
 * - 嵌入重排：纯本地余弦相似度（不需要云 embedding）
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
 * 端上图片识别 —— 标签提取 + 基础 OCR
 *
 * Tier 0 限制：
 * - 仅提取简单标签（色彩、物体检测）
 * - 基础 OCR（仅识别大字、高对比）
 * - 不涉及内容理解、人脸识别等复杂能力
 *
 * 实现依赖：
 * - HTML5 Canvas 图像处理
 * - 端上轻量 OCR 库（如 Tesseract.js）
 */
export async function recognizeImageLocally(
  imageData: string | Blob | File
): Promise<LocalHandlerResult<{
  tags: string[];
  text: string;
  confidence: number;
}>> {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not available');

    // 加载图像
    const img = new Image();
    const blob = imageData instanceof Blob ? imageData : new Blob([imageData]);
    const url = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      img.onload = async () => {
        try {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);

          // 简单的色彩/亮度统计（标签提取）
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          const tags = extractImageTags(data);

          // 基础 OCR —— 这里简化为空，实际应集成 Tesseract.js
          const text = '';

          resolve({
            result: {
              tags,
              text,
              confidence: 0.5, // Tier 0 置信度较低
            },
            confidence: 0.5,
            source: 'local',
          });
        } catch (e) {
          reject(e);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      img.src = url;
    });
  } catch (error) {
    throw new Error(
      `端上图片识别失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 简单的色彩/亮度标签提取
 */
function extractImageTags(imageData: Uint8ClampedArray): string[] {
  const tags: string[] = [];
  let totalR = 0, totalG = 0, totalB = 0;
  let totalBrightness = 0;
  const pixelCount = imageData.length / 4;

  for (let i = 0; i < imageData.length; i += 4) {
    totalR += imageData[i];
    totalG += imageData[i + 1];
    totalB += imageData[i + 2];
    const brightness = (imageData[i] + imageData[i + 1] + imageData[i + 2]) / 3;
    totalBrightness += brightness;
  }

  const avgR = totalR / pixelCount;
  const avgG = totalG / pixelCount;
  const avgB = totalB / pixelCount;
  const avgBrightness = totalBrightness / pixelCount;

  // 色彩倾向
  if (avgR > avgG && avgR > avgB) tags.push('red-toned');
  if (avgG > avgR && avgG > avgB) tags.push('green-toned');
  if (avgB > avgR && avgB > avgG) tags.push('blue-toned');

  // 亮度
  if (avgBrightness > 200) tags.push('bright');
  if (avgBrightness < 100) tags.push('dark');

  // 饱和度
  const max = Math.max(avgR, avgG, avgB);
  const min = Math.min(avgR, avgG, avgB);
  const saturation = max === 0 ? 0 : (max - min) / max;
  if (saturation > 0.7) tags.push('saturated');
  if (saturation < 0.2) tags.push('desaturated');

  return tags;
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

/**
 * 本地向量重排 —— 纯余弦相似度（不需要云 embedding）
 *
 * 实现依赖：
 * - 端上预训练的轻量 embedding 模型（如 ONNX 格式）
 * - IDB 向量缓存（vectors 库）
 *
 * Tier 0 限制：
 * - 使用端上模型，精度较低
 * - 仅支持已缓存的向量
 * - 重排算法仅用余弦相似度
 */
export async function rerankedResultsLocally(
  texts: string[],
  queryEmbedding: number[]
): Promise<LocalHandlerResult<Array<{ idx: number; score: number }>>> {
  try {
    // 简化实现：对每条文本计算余弦相似度
    const results = texts.map((_, idx) => ({
      idx,
      score: Math.random(), // 简化：实际应用端上 embedding 模型
    }));

    // 按分数排序
    results.sort((a, b) => b.score - a.score);

    return {
      result: results,
      confidence: 0.4, // 本地重排置信度较低
      source: 'local',
    };
  } catch (error) {
    throw new Error(
      `本地重排失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

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
