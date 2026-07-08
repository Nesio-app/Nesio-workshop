/**
 * 节点事实 sink 注册 —— 把 life-graph 的 add/update/delete 统一接进 Signal 事实库。
 * (环依赖使 life-graph 不能直接 import 转换器;本模块被加载即注册。)
 * upsert:同 id 幂等覆盖(appendSignalIdb 用 put)= 更新即最新事实;
 * remove:对称删除,防 rebuild 时已删节点复活。
 * 失败静默(事实库是增强不是依赖,与 ingest-node 同哲学)。
 */
import { registerNodeFactSink } from '../portal/life-graph';
import { lifeNodeToSignal } from './signal';
import { appendSignalIdb, deleteSignalIdb } from './signal-store-idb';

registerNodeFactSink({
  upsert(node) {
    try { void appendSignalIdb(lifeNodeToSignal(node)); } catch { /* 转换失败不阻塞写 */ }
  },
  remove(node) {
    try { void deleteSignalIdb(lifeNodeToSignal(node).id); } catch { /* 同上 */ }
  },
});

export {}; // 纯副作用模块
