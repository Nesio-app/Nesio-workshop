/**
 * 把备份文件交到用户手里。
 * iOS WKWebView 里 `<a download>` 经常「点了没下文」或落到找不到的临时目录;
 * 优先走系统分享面板(可存到「文件」/隔空投送),不行再回退 download。
 *
 * 红线:iOS 的 Web Share 若带上 `text`/`title`,系统常把分享落成 .txt —— 只 share files。
 */
export type SaveBackupOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';

export async function saveBackupBlob(blob: Blob, filename: string): Promise<SaveBackupOutcome> {
  const mime = filename.endsWith('.zip')
    ? 'application/zip'
    : filename.endsWith('.gz')
      ? 'application/gzip'
      : (blob.type || 'application/octet-stream');
  const file = new File([blob], filename, { type: mime });
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: ShareData & { files?: File[] }) => Promise<void>;
  };

  if (typeof nav.share === 'function') {
    const can = typeof nav.canShare !== 'function' || nav.canShare({ files: [file] });
    if (can) {
      try {
        // 不要传 text/title —— Safari/WKWebView 会据此生成 .txt
        await nav.share({ files: [file] });
        return 'shared';
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        if (name === 'AbortError') return 'cancelled';
        // share 失败再试 download
      }
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
