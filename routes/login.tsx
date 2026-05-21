import { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";

interface Data {
  next: string;
  erro: string | null;
}

export const handler: Handlers<Data> = {
  GET(req, ctx) {
    const url = new URL(req.url);
    return ctx.render({
      next: url.searchParams.get("next") ?? "/",
      erro: url.searchParams.get("erro"),
    });
  },
};

export default function LoginPage({ data }: PageProps<Data>) {
  return (
    <>
      <Head>
        <title>Login · Brasileirão Fantasy</title>
        <link rel="stylesheet" href="/bf-styles.css?v=163" />
      </Head>
      <div class="bf-login">
        <div class="bf-login__card">
          <img
            class="bf-login__logo"
            src="/logo_site.png"
            alt="Brasileirão Fantasy"
          />
          <h1 class="bf-login__title">Entrar</h1>
          {data.erro && <p class="bf-login__erro">{data.erro}</p>}
          <form
            class="bf-login__form"
            method="POST"
            action="/api/auth/login"
          >
            <input type="hidden" name="next" value={data.next} />
            <label class="bf-login__field">
              <span class="bf-login__label">Usuário</span>
              <input
                type="text"
                name="user"
                autocomplete="username"
                required
                class="bf-login__input"
              />
            </label>
            <label class="bf-login__field">
              <span class="bf-login__label">Senha</span>
              <input
                type="password"
                name="pass"
                autocomplete="current-password"
                required
                class="bf-login__input"
              />
            </label>
            <button type="submit" class="bf-login__btn">Entrar</button>
          </form>

          <div class="bf-login__sep">
            <span>ou</span>
          </div>

          <a
            class="bf-login__google"
            href={`/api/auth/google/start?next=${
              encodeURIComponent(data.next)
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path
                fill="#FFC107"
                d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"
              />
              <path
                fill="#FF3D00"
                d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.6 29.3 4.5 24 4.5c-7.4 0-13.7 4.1-17.7 10.2z"
              />
              <path
                fill="#4CAF50"
                d="M24 44c5.2 0 10-2 13.6-5.3l-6.3-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.4-11.3-8l-6.5 5c3.6 6.1 10.1 11 17.8 11z"
              />
              <path
                fill="#1976D2"
                d="M43.6 20.5H42V20H24v8h11.3c-.7 2-2 3.7-3.7 5l6.3 5.2c-.4.4 6.4-4.7 6.4-14.2 0-1.3-.1-2.3-.4-3.5z"
              />
            </svg>
            Entrar com Google
          </a>
        </div>
      </div>
    </>
  );
}
