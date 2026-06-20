import { Html, Head, Main, NextScript } from 'next/document';

export default function Document(): JSX.Element {
  return (
    <Html lang="pt-BR">
      <Head>
        <meta charSet="utf-8" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
