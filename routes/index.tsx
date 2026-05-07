import { Head } from "$fresh/runtime.ts";
import Ranking from "../islands/Ranking.tsx";

export default function Home() {
  return (
    <>
      <Head>
        <title>Brasileirão Fantasy</title>
      </Head>
      <div class="app">
        <header class="app-header">
          <img src="/logo_site.png" alt="Brasileirão Fantasy" class="app-header-logo-img" />
        </header>
        <main class="main">
          <Ranking />
        </main>
      </div>
    </>
  );
}
