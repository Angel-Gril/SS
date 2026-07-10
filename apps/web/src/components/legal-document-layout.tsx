import Link from 'next/link';
import type { ReactNode } from 'react';
import type { LegalProfile } from 'shared';

export function LegalDocumentLayout({
  profile,
  title,
  version,
  children,
}: {
  profile: LegalProfile;
  title: string;
  version: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#fffaf6] text-slate-900">
      <header className="border-b border-orange-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4 sm:px-8">
          <a href="/login" className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground shadow-sm">SS</span>
            <span>
              <span className="block font-semibold leading-tight">{profile.platformName}</span>
              <span className="block text-xs text-slate-500">{profile.operatorDisplayName}</span>
            </span>
          </a>
          <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
            {profile.deploymentLabel}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <article className="overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-[0_18px_60px_-35px_rgba(124,45,18,0.35)]">
          <div className="border-b border-slate-100 px-6 py-8 sm:px-10">
            <p className="mb-2 text-sm font-medium text-primary">{profile.platformName}</p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <dl className="mt-6 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
              <div><dt className="inline font-medium text-slate-900">运营主体：</dt><dd className="inline">{profile.operatorLegalName}</dd></div>
              <div><dt className="inline font-medium text-slate-900">生效日期：</dt><dd className="inline">{profile.effectiveDate}</dd></div>
              <div><dt className="inline font-medium text-slate-900">适用版本：</dt><dd className="inline">{profile.deploymentLabel}</dd></div>
              <div><dt className="inline font-medium text-slate-900">文档版本：</dt><dd className="inline">{version}</dd></div>
            </dl>
          </div>
          <div className="legal-document space-y-9 px-6 py-8 text-[15px] leading-7 text-slate-700 sm:px-10 sm:py-10">
            {children}
          </div>
        </article>

        <nav aria-label="法律文件" className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-slate-600">
          <Link href="/terms" className="hover:text-primary hover:underline">用户协议</Link>
          <Link href="/privacy" className="hover:text-primary hover:underline">隐私政策</Link>
          <a href="/login" className="hover:text-primary hover:underline">返回登录</a>
        </nav>
      </main>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-slate-950">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
