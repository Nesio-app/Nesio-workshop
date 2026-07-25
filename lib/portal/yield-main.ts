/**
 * yieldToMain —— 把主线程让出去一拍(让浏览器有机会 paint / 处理输入)。
 *
 * 为什么:记录级同步在**主线程**上对现在已经很大的本机数据(健康/财务/足迹 blob、上千封邮件全文、
 * 书籍、照片…)逐条同步 gzip 压缩。数据一大,整段循环会把主线程堵住数秒 = UI「卡死」
 * (真机:开 app 后进健身跟练,恰好撞上开机首次同步的压缩,整个界面冻住)。在压缩循环里每处理
 * 若干条就 yield 一次 → 单帧不再长时间阻塞,后台同步照做但界面始终可响应。
 *
 * 实现:setTimeout(0) 让出一个宏任务。测试/SSR 无 setTimeout 时立即 resolve(不改变行为,只是不 yield)。
 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setTimeout === 'function') setTimeout(resolve, 0);
    else resolve();
  });
}
