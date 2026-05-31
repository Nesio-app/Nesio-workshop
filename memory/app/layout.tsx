export const metadata = {
  title: "念归处 · 数字纪念堂",
  description: "在云端，为挚爱留一处不必匆忙的地方",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
