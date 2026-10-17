/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes, SyntheticEvent } from 'react'

/** Electron <webview> 标签的 JSX 类型补充 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        allowpopups?: boolean | string
        preload?: string
        onIpcMessage?: (e: { channel: string; args: unknown[] } & SyntheticEvent<HTMLElement>) => void
        onDOMReady?: (e: SyntheticEvent<HTMLElement>) => void
        onDidNavigate?: (e: { url: string } & SyntheticEvent<HTMLElement>) => void
      }
    }
  }
}
