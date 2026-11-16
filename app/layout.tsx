import type { Metadata, Viewport } from 'next';
import '../theme/fonts.css';
import '../theme/theme.css';
import './app.css';

export const metadata: Metadata = {
  title: 'Static',
  description: "Wyatt's picker, live guide, football board and daily paper.",
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Static', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

// Applies the saved theme before the page paints, so there is no flash of the wrong look.
const themeBoot = `try{var t=localStorage.getItem('static-theme'),m=localStorage.getItem('static-mode'),c=localStorage.getItem('static-clean'),d=document.documentElement;if(t&&m){d.dataset.theme=t;d.dataset.mode=m}if(c)d.dataset.clean=c}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="mocha" data-mode="dark" data-glass="off" data-size="auto" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
