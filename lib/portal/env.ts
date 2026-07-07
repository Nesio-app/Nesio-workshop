/** 读一个环境变量并 trim(空/未设 → ''),全仓统一入口(取代各文件本地 envValue 定义)。 */
export function envValue(key: string): string {
  return (process.env[key] ?? '').trim();
}
