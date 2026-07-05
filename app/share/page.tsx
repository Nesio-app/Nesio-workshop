import { Suspense } from 'react';
import SharePageClient from './SharePageClient';

/**
 * /share — 系统分享接收页(批次 18)。
 * manifest share_target 指向这里:Android PWA 现在就能从系统分享菜单进来;
 * iOS 的 PWA 收不到系统分享(平台限制),等原生壳上架后由壳的分享扩展
 * 转发到同一 URL,前端零改动。
 * 参数:?title=&text=&url=(GET,不收文件)。
 */

export const dynamic = 'force-dynamic';

export default function SharePage() {
  // 参数在客户端读 location.search(服务端 searchParams 在本项目的
  // 运行时配置下拿不到,客户端读取对分享场景足够且更稳)
  return (
    <Suspense fallback={null}>
      <SharePageClient />
    </Suspense>
  );
}
