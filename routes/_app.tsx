import { AppProps } from "$fresh/server.ts";

export default function App({ Component }: AppProps) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#0a3d20" />
        <title>Fantasy Cartola - Ranking</title>
        <link rel="stylesheet" href="/styles.css?v=46" />
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
}
