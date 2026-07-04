import type { Metadata } from 'next';

// 管理面板不进搜索索引
export const metadata: Metadata = {
  title: 'Nesio 数据面板',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
