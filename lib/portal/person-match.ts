/**
 * person-match — 把 AI 提取到的人名匹配到已有联系人(拍一拍入档 1c 的跨人归档)。
 * 纯函数、可单测。精确(名字/邮箱归一相等)优先于包含匹配;都不中返回空串。
 */
export interface Matchable { key: string; name: string }

export function matchPerson(personName: string, contacts: Matchable[]): string {
  const n = personName.trim().toLowerCase();
  if (!n) return '';
  const exact = contacts.find((c) => c.name.trim().toLowerCase() === n || c.key === n);
  if (exact) return exact.key;
  const partial = contacts.find((c) => {
    const cn = c.name.trim().toLowerCase();
    return cn.length >= 2 && (cn.includes(n) || n.includes(cn));
  });
  return partial?.key || '';
}
