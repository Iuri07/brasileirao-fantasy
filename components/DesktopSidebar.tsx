// Sidebar de desktop — só aparece em ≥1024px (via CSS display: none).
// No mobile o BottomNav segue como sempre, no desktop os dois coexistem
// no DOM mas só um é visível.

import TeamCrest from "./TeamCrest.tsx";

type NavId = "home" | "mercado" | "liga" | "live" | "admin";

interface RankingItem {
  chave: string;
  nome: string;
  total: number;
  /** Cor accent do time (hex/css). Aplicada no nome no ranking. */
  accent?: string;
}

interface Props {
  /** Página ativa — destaca no nav. */
  active: NavId;
  /** Desabilita o item Ao Vivo (mercado aberto). */
  liveDisabled?: boolean;
  /** Time do usuário (pra mostrar identidade no topo da sidebar). */
  meuChave: string | null;
  meuNomeTime: string | null;
  meuDono: string | null;
  totalTimes: number;
  /** Top N do ranking pra mostrar como mini-leaderboard. */
  ranking: RankingItem[];
  /** Texto "2d 3h 4min" ou similar pra contagem do fechamento. */
  fechamentoTexto: string | null;
  /** Mensagem opcional de aviso ("Cauly virou dúvida"). */
  aviso?: string | null;
  /** True quando o mercado está aberto (entre rodadas). Mostra pip
   *  pulsante lime no item Mercado da nav. */
  mercadoAberto?: boolean;
  /** True pra mostrar o item Admin na nav (visível só pra role=admin). */
  isAdmin?: boolean;
}

const NAV_ITEMS: Array<
  { id: NavId; label: string; href: string; iconPath: string }
> = [
  {
    id: "home",
    label: "Início",
    href: "/",
    iconPath: "M3 11l9-8 9 8M5 10v10h14V10",
  },
  {
    id: "mercado",
    label: "Mercado",
    href: "/mercado",
    iconPath: "M3 7h18l-2 12H5L3 7zM8 7V5a4 4 0 0 1 8 0v2",
  },
  {
    id: "liga",
    label: "Liga",
    href: "/liga",
    iconPath: "M6 9a6 6 0 0 0 12 0V3H6v6zM8 21h8M12 15v6",
  },
  {
    id: "live",
    label: "Ao Vivo",
    href: "/ao-vivo",
    iconPath:
      "M12 2v4M4.93 4.93l2.83 2.83M2 12h4M4.93 19.07l2.83-2.83M12 18v4M19.07 19.07l-2.83-2.83M22 12h-4M19.07 4.93l-2.83 2.83",
  },
];

const ADMIN_NAV_ITEM: { id: NavId; label: string; href: string; iconPath: string } = {
  id: "admin",
  label: "Admin",
  href: "/admin",
  // Gear/cog ícone
  iconPath:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
};

export default function DesktopSidebar(props: Props) {
  const {
    active,
    liveDisabled = false,
    meuChave,
    meuNomeTime,
    meuDono,
    totalTimes,
    ranking,
    fechamentoTexto,
    aviso = null,
    mercadoAberto = false,
    isAdmin = false,
  } = props;
  const navItems = isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
  const top5 = ranking.slice(0, 5);

  return (
    <aside class="bf-sidebar" aria-label="Navegação desktop">
      {/* Logo */}
      <div class="bf-sidebar__logo">
        <img src="/logo_site.png" alt="Brasileirão Fantasy" />
      </div>

      {/* Card de identidade do meu time */}
      {meuChave && (
        <div class="bf-sidebar__team-card">
          <TeamCrest chave={meuChave} size={40} />
          <div class="bf-sidebar__team-meta">
            <div class="bf-sidebar__team-name">{meuNomeTime ?? meuChave}</div>
            <div class="bf-sidebar__team-sub">
              Liga Pro Clubs · {totalTimes} times
            </div>
          </div>
        </div>
      )}

      {/* Nav principal */}
      <nav class="bf-sidebar__nav">
        <div class="bf-sidebar__nav-label">Navegação</div>
        {navItems.map((it) => {
          const disabled = liveDisabled && it.id === "live";
          const isActive = it.id === active;
          // Pip lime no item Mercado quando mercado aberto — mesmo padrão
          // visual do pulsante "Ao Vivo" na bottom-nav antiga.
          const aberto = mercadoAberto && it.id === "mercado";
          const cls = ["bf-sidebar__nav-item"];
          if (isActive) cls.push("bf-sidebar__nav-item--active");
          if (disabled) cls.push("bf-sidebar__nav-item--disabled");
          if (aberto) cls.push("bf-sidebar__nav-item--mkt-aberto");
          const icon = (
            <svg
              class="bf-sidebar__nav-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d={it.iconPath} />
            </svg>
          );
          if (disabled) {
            return (
              <span
                key={it.id}
                class={cls.join(" ")}
                aria-disabled="true"
                title="Disponível só durante a rodada"
              >
                {icon}
                <span>{it.label}</span>
              </span>
            );
          }
          return (
            <a
              key={it.id}
              href={it.href}
              data-nav={it.id}
              class={cls.join(" ")}
            >
              {icon}
              <span>{it.label}</span>
            </a>
          );
        })}
      </nav>

      {/* Mini ranking — só se tiver pelo menos 2 times */}
      {top5.length >= 2 && (
        <div class="bf-sidebar__ranking">
          <div class="bf-sidebar__nav-label">Liga Pro Clubs</div>
          <ol class="bf-sidebar__ranking-list">
            {top5.map((t, idx) => {
              const isMe = t.chave === meuChave;
              return (
                <li
                  key={t.chave}
                  class={`bf-sidebar__ranking-row ${
                    isMe ? "bf-sidebar__ranking-row--mine" : ""
                  }`}
                  style={t.accent
                    ? { "--row-accent": t.accent } as Record<string, string>
                    : undefined}
                >
                  <span class="bf-sidebar__ranking-pos">{idx + 1}</span>
                  <span class="bf-sidebar__ranking-crest">
                    <TeamCrest chave={t.chave} size={22} />
                  </span>
                  <span class="bf-sidebar__ranking-name">{t.nome}</span>
                  <span class="bf-sidebar__ranking-pts">
                    {t.total.toFixed(1).replace(".", ",")}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Card de mercado: contagem + aviso + call-to-action */}
      {fechamentoTexto && (
        <a class="bf-sidebar__mercado-card" href="/mercado">
          <div class="bf-sidebar__mercado-lbl">
            ⚠ Mercado fecha em
          </div>
          <div class="bf-sidebar__mercado-tempo">{fechamentoTexto}</div>
          {aviso && (
            <div class="bf-sidebar__mercado-aviso">{aviso}</div>
          )}
          <div class="bf-sidebar__mercado-cta">
            Ir pro mercado →
          </div>
        </a>
      )}
    </aside>
  );
}
