/**
 * node-display — App 生成的节点名的显示层语言转换(批次 14)。
 *
 * 背景:批次 12 起「此刻」等 App 生成的节点名按保存时的界面语言产出,
 * 但更早保存的旧数据永远是中文——英文界面下标题冒中文(用户截图)。
 * 存储不动(数据是历史事实),只在显示层把「可识别的生成模式」按当前
 * 语言转换;用户自己输入的名字永远原样。
 */

const MOMENT_EMOTIONS: Array<[zh: string, en: string]> = [
  ['开心', 'Joyful'], ['兴奋', 'Excited'], ['感动', 'Moved'], ['平静', 'Calm'],
  ['满足', 'Content'], ['感激', 'Grateful'], ['疲惫', 'Tired'], ['空洞', 'Empty'],
  ['难过', 'Sad'], ['焦虑', 'Anxious'], ['烦躁', 'Restless'], ['生气', 'Angry'],
];

/** 显示层节点名:此刻 · X ↔ This moment · X(双向,仅精确匹配生成模式)。 */
export function displayNodeName(name: string, dict: string): string {
  for (const [zh, en] of MOMENT_EMOTIONS) {
    if (name === `此刻 · ${zh}`) return dict === 'en' ? `This moment · ${en}` : name;
    if (name === `This moment · ${en}`) return dict === 'zh' ? `此刻 · ${zh}` : name;
  }
  return name;
}
