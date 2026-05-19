type NavId = "home" | "mercado" | "liga" | "live";

interface Props {
  active?: NavId;
  /** Quando true, "Ao Vivo" vira span não-clicável (mercado aberto = nada
   *  ao vivo pra mostrar). */
  liveDisabled?: boolean;
}

const ITEMS: Array<{ id: NavId; label: string; href: string; d: string }> = [
  { id: "home", label: "Início", href: "/", d: "M3 11l9-8 9 8M5 10v10h14V10" },
  {
    id: "mercado",
    label: "Mercado",
    href: "/mercado",
    d: "M3 7h18l-2 12H5L3 7zM8 7V5a4 4 0 0 1 8 0v2",
  },
  {
    id: "liga",
    label: "Liga",
    href: "/liga",
    d: "M6 9a6 6 0 0 0 12 0V3H6v6zM8 21h8M12 15v6",
  },
  {
    id: "live",
    label: "Ao Vivo",
    href: "/ao-vivo",
    d: "M12 2v4M4.93 4.93l2.83 2.83M2 12h4M4.93 19.07l2.83-2.83M12 18v4M19.07 19.07l-2.83-2.83M22 12h-4M19.07 4.93l-2.83 2.83",
  },
];

export default function BottomNav(
  { active = "home", liveDisabled = false }: Props,
) {
  return (
    <nav class="bf-bottom-nav" aria-label="Navegação principal">
      {ITEMS.map((it) => {
        const disabled = liveDisabled && it.id === "live";
        const cls = `bf-bottom-nav__item ${
          it.id === active ? "bf-bottom-nav__item--active" : ""
        } ${disabled ? "bf-bottom-nav__item--disabled" : ""}`;
        const icon = (
          <svg
            class="bf-bottom-nav__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d={it.d} />
          </svg>
        );
        if (disabled) {
          return (
            <span
              key={it.id}
              data-nav={it.id}
              class={cls}
              aria-disabled="true"
              title="Disponível só durante a rodada ao vivo"
            >
              {icon}
              {it.label}
            </span>
          );
        }
        return (
          <a key={it.id} href={it.href} data-nav={it.id} class={cls}>
            {icon}
            {it.label}
          </a>
        );
      })}
    </nav>
  );
}
