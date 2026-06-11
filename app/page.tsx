'use client';

import { useEffect, useState } from 'react';
import Portal from '@/components/portal/Portal';

export default function Home() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return <Portal />;
}
