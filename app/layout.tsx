import type { Metadata } from 'next';
import './globals.css';
import './cards-redesign.css';
import './flow-redesign.css';
import './base-redesign.css';
import './editor-redesign.css';
export const metadata: Metadata={title:'个人工作台',description:'九条工作流，一处看清。'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN" ><head><link rel="icon" href="/favicon.svg"/><link rel="manifest" href="/manifest.webmanifest"/><link rel="apple-touch-icon" href="/icon-192.png"/><meta name="theme-color" content="#f5f2ea"/><meta name="apple-mobile-web-app-capable" content="yes"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/></head><body>{children}</body></html>}

