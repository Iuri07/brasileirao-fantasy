import { useEffect, useRef, useState } from "preact/hooks";

interface Props {
  /** Email do usuário (Google OAuth) — null se admin/local */
  email?: string | null;
  /** Label curta no avatar (inicial). Default: derivado do email ou "A" pra admin */
  label?: string | null;
  /** Role pra colorir/diferenciar */
  role?: "admin" | "user" | null;
  /** Texto exibido no menu (display name) */
  nome?: string | null;
  /** URL da foto de perfil (Google) — se presente, substitui a inicial */
  picture?: string | null;
}

export default function UserMenu(
  { email, label, role, nome, picture }: Props,
) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha quando clica fora
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const initial = (
    label ??
      nome?.charAt(0) ??
      email?.charAt(0) ??
      (role === "admin" ? "A" : "?")
  ).toUpperCase();
  const display = nome ?? email ?? (role === "admin" ? "Admin" : "Visitante");

  return (
    <div class="bf-usermenu" ref={ref}>
      <button
        type="button"
        class={`bf-usermenu__avatar ${
          role === "admin" ? "bf-usermenu__avatar--admin" : ""
        } ${picture ? "bf-usermenu__avatar--photo" : ""}`}
        aria-label="Menu do usuário"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {picture
          ? (
            <img
              class="bf-usermenu__photo"
              src={picture}
              alt=""
              referrerpolicy="no-referrer"
            />
          )
          : initial}
      </button>
      {open && (
        <div class="bf-usermenu__pop" role="menu">
          <div class="bf-usermenu__head">
            <div class="bf-usermenu__name">{display}</div>
            {role === "admin" && (
              <div class="bf-usermenu__role">Administrador</div>
            )}
          </div>
          {role === "admin" && (
            <a class="bf-usermenu__item" href="/admin">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Configurações
            </a>
          )}
          <form method="POST" action="/api/auth/logout">
            <button
              type="submit"
              class="bf-usermenu__item bf-usermenu__item--logout"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Sair
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
