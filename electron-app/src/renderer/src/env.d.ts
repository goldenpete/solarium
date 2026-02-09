/// <reference types="vite/client" />

interface WebViewProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> {
  src?: string;
  autosize?: string;
  plugins?: boolean;
  preload?: string;
  httpreferrer?: string;
  useragent?: string;
  disablewebsecurity?: boolean;
  partition?: string;
  allowpopups?: boolean;
  webpreferences?: string;
  blinkfeatures?: string;
  disableblinkfeatures?: string;
  guestinstance?: string;
  disableguestresize?: boolean;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebViewProps;
    }
  }
}
