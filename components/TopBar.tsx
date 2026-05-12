import UserMenu from "../islands/UserMenu.tsx";
import NotifBell from "../islands/NotifBell.tsx";

interface Props {
  hasAlert?: boolean;
  /** Email do usuário (Google) — null pra admin local */
  userEmail?: string | null;
  /** Nome do dono (passado pelo handler) — usado no menu */
  userNome?: string | null;
  /** URL da foto de perfil do Google */
  userPicture?: string | null;
  /** Role da sessão */
  userRole?: "admin" | "user" | null;
}

export default function TopBar(
  {
    hasAlert: _hasAlert = false,
    userEmail = null,
    userNome = null,
    userPicture = null,
    userRole = null,
  }: Props,
) {
  return (
    <div class="bf-topbar">
      <UserMenu
        email={userEmail}
        nome={userNome}
        picture={userPicture}
        role={userRole}
      />
      <a href="/" class="bf-minlogo" aria-label="Brasileirão Fantasy">
        <img
          src="/logo_site.png"
          alt="Brasileirão Fantasy"
          class="bf-minlogo__img"
          width="120"
          height="38"
        />
      </a>
      {userRole === "user"
        ? <NotifBell />
        : <span class="bf-iconbtn" aria-hidden="true" />}
    </div>
  );
}
