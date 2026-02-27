import type { ReactNode } from 'react';

interface MainLayoutProps {
  header: ReactNode;
  children: ReactNode;
}

export function MainLayout({ header, children }: MainLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-950">
      {header}
      <main className="p-6 max-w-[1600px] mx-auto">
        {children}
      </main>
    </div>
  );
}
