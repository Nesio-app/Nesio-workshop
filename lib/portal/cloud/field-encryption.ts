/**
 * 云端敏感字段的「静态加密」(数据审计 #2)。
 *
 * 定位:**应用层字段加密**,不是端到端(E2E)。密钥服务端托管
 * (NESIO_FIELD_ENCRYPTION_KEY,缺省回退 SUPABASE_SERVICE_ROLE_KEY 派生)。
 * 服务端仍能解密 —— 因此语义检索/重排等服务端操作不受影响(与真 E2E 的核心
 * 区别)。它防的是 **数据库转储/快照泄露**:拖库者拿到的是密文,没有应用密钥
 * 就读不出敏感原文(defense-in-depth)。它 **不防** 服务端自身被攻陷。
 *
 * 默认休眠:未设 NESIO_FIELD_ENCRYPTION=1 时,encryptField 原样返回明文
 * (passthrough)—— 现网行为零变化。部署侧置 1 + 配好密钥后,新写入即加密。
 *
 * 混合模式:decryptField 逐值探测信封前缀,旧明文行原样返回,新密文行解密。
 * 因此「开启加密」不需要回填历史行 —— 老数据继续可读,新数据落密文。
 *
 * 失败即关(fail-closed):开启但无密钥 → 加密抛错(绝不静默落明文);
 * 解密遇篡改/错密钥 → GCM 校验抛错(绝不返回错数据)。
 *
 * 仅服务端(node:crypto)。禁止在客户端组件里 import。
 */
import crypto from 'node:crypto';

const VERSION = 'v1';
const PREFIX = `enc:${VERSION}:`;
const GCM_TAG_BYTES = 16;
const GCM_IV_BYTES = 12;

function resolveSecret(): string | null {
  return process.env.NESIO_FIELD_ENCRYPTION_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || null;
}

/** 加密是否开启。休眠时 encryptField 走 passthrough。 */
export function isFieldEncryptionEnabled(): boolean {
  return process.env.NESIO_FIELD_ENCRYPTION === '1';
}

/** 32 字节 AES-256 密钥。label 绑定用途;换 secret 即换 key(轮换须重加密)。 */
function deriveKey(): Buffer {
  const secret = resolveSecret();
  if (!secret) throw new Error('field_encryption_key_missing');
  return crypto.createHash('sha256').update(`nesio-field-enc:${secret}`).digest();
}

/** 是否为本模块产出的密文信封。 */
export function isEncryptedField(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * 加密一个字段值。休眠时原样返回(passthrough)。字符串与 JSON 值都支持,
 * 信封记录原类型以便解密时还原。null/undefined 不加密(保持列语义,如
 * deleted_at)。已是信封的值不重复加密。
 */
export function encryptField<T>(value: T): T | string {
  if (!isFieldEncryptionEnabled()) return value;
  if (value === null || value === undefined) return value;
  if (isEncryptedField(value)) return value;

  const key = deriveKey();
  const isString = typeof value === 'string';
  const plain = isString ? (value as unknown as string) : JSON.stringify(value);
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const body = Buffer.concat([ct, tag]).toString('base64url');
  return `${PREFIX}${isString ? 's' : 'j'}:${iv.toString('base64url')}:${body}`;
}

/**
 * 解密一个字段值。非信封值原样返回(明文/混合模式)。信封值用 GCM 解密并按
 * 原类型还原;篡改或错密钥 → 抛错(fail-closed)。
 */
export function decryptField<T = unknown>(value: unknown): T {
  if (!isEncryptedField(value)) return value as T;

  const rest = value.slice(PREFIX.length);
  const typeSep = rest.indexOf(':');
  const type = rest.slice(0, typeSep);
  const afterType = rest.slice(typeSep + 1);
  const ivSep = afterType.indexOf(':');
  if (typeSep < 0 || ivSep < 0) throw new Error('field_encryption_malformed_envelope');

  const iv = Buffer.from(afterType.slice(0, ivSep), 'base64url');
  const buf = Buffer.from(afterType.slice(ivSep + 1), 'base64url');
  if (buf.length <= GCM_TAG_BYTES) throw new Error('field_encryption_malformed_envelope');
  const tag = buf.subarray(buf.length - GCM_TAG_BYTES);
  const ct = buf.subarray(0, buf.length - GCM_TAG_BYTES);

  const key = deriveKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  return (type === 's' ? plain : JSON.parse(plain)) as T;
}

// ── 云端 signals 表:加密敏感内容列(保留元数据列可查询)──────────────────
//  加密的是「原文/内容」列:title/payload/entities/evidence/embedding_text。
//  不动的是「元数据/检索」列:source/type/*_at/sensitivity/confidence/
//  embedding_vector —— 向量是不可逆的数值投影,是服务端检索的必需项,且不还原
//  出原文,保留它不违背本加密的威胁模型。
const SIGNAL_ENCRYPTED_COLUMNS = ['title', 'payload', 'entities', 'evidence', 'embedding_text'] as const;

/** 写入前加密 signals 行的敏感列。休眠时原样返回。 */
export function encryptSignalRowColumns<R extends Record<string, unknown>>(row: R): R {
  if (!isFieldEncryptionEnabled()) return row;
  const out: Record<string, unknown> = { ...row };
  for (const col of SIGNAL_ENCRYPTED_COLUMNS) {
    if (out[col] !== null && out[col] !== undefined) out[col] = encryptField(out[col]);
  }
  return out as R;
}

/** 读回后解密 signals 行的敏感列。逐列探测,旧明文行原样透传(混合模式)。 */
export function decryptSignalRowColumns<R extends Record<string, unknown>>(row: R): R {
  const out: Record<string, unknown> = { ...row };
  for (const col of SIGNAL_ENCRYPTED_COLUMNS) {
    if (isEncryptedField(out[col])) out[col] = decryptField(out[col]);
  }
  return out as R;
}
