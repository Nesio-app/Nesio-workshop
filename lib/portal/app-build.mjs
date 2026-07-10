/**
 * 构建期开关(App Store 合规核心)。
 *
 * 一套 web 代码,两个构建 —— 不 fork repo:
 *  - 提审构建:打包时设 NEXT_PUBLIC_APPSTORE_BUILD=1 → Lab **不可达** + v1 隐藏功能
 *    (财务/健康/地图/实验室/people)在这个二进制里真进不去。审核按能力判(Guideline
 *    2.3.1 + 隐私),"藏 UI"不够,必须真不可达 + 不带其权限。
 *  - 开发/内部构建:不设 → Lab + 全部功能都在(nesio.app web / TestFlight 内部构建)。
 *
 * 关键合规:此开关**打包时烘死**(env inlined at build),**不可远程翻** —— 远程翻是
 * 2.3.1 明确打击的。build-baked env 天然翻不了,安全。
 */

export function isAppStoreBuild() {
  return process.env.NEXT_PUBLIC_APPSTORE_BUILD === '1';
}

// v1 提审构建里**必须不可达**的功能 id(模块 + 子功能)。Lab 关掉后本不该露,但用户可能
// 靠 ?baohePersonal=1 / 强制开关触达 —— 提审构建把这些盖死,连激活路径一起断。
export const APPSTORE_HIDDEN_IDS = Object.freeze([
  'finance', 'health', 'places', 'experiment', 'people',
  // 健身(训练计划/动作库/跟练)与健康同批隐藏 —— QA 实证它藏在 Health tab 里没被盖到。
  'fitness',
]);

/** 提审构建 + 命中 v1 隐藏集 → 该功能在这个二进制里不可达(盖过 Lab / 用户强制开)。 */
export function isAppStoreBlocked(id) {
  return isAppStoreBuild() && APPSTORE_HIDDEN_IDS.includes(id);
}
