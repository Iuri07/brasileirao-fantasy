import type { BancoPino } from "./Field.tsx";
import { statusInfo } from "./Field.tsx";

interface Props {
  jogadores: BancoPino[];
  /** Label da seção. Default "Reservas". Usado pra diferenciar
      "Banco" (pode entrar via auto-sub) de "Reservas" (resto do
      elenco, não-escalados). */
  label?: string;
  /** Mostra pontos abaixo do nome (/ao-vivo). Default false (escalação
      estática em /liga). */
  showPoints?: boolean;
  /** Esconde badges de status (provável/dúvida/etc). Default igual ao
      Field — /liga usa false pra limpar visual, /ao-vivo usa false
      implícito porque liveMode esconde status mesmo. */
  showStatus?: boolean;
  /** Durante o ao vivo: revela sub badges (↑↓) e bolinha "em campo".
      Fora do live, melhorTime ainda calcula substituido/descido como
      preview — mostrar os pips confunde, então gateamos atrás disso. */
  liveMode?: boolean;
}

const POS_TO_CLASS: Record<string, string> = {
  Goleiro: "gol",
  Lateral: "lat",
  Zagueiro: "zag",
  Meia: "mei",
  Atacante: "ata",
  Técnico: "ata",
};

/**
 * Row horizontal scrollável com os reservas do elenco — visual igual
 * ao pool do MeuTimeEditor mas read-only (sem buttons/seleção). Usado
 * em /liga (escalação estática) e /ao-vivo (com pontos live).
 */
export default function ReservasRow(
  {
    jogadores,
    label = "Reservas",
    showPoints = false,
    showStatus = false,
    liveMode = false,
  }: Props,
) {
  if (!jogadores.length) return null;

  return (
    <div class="bf-pool">
      <div class="bf-pool__label">
        {label} <span class="bf-pool__grupo-qtd">{jogadores.length}</span>
      </div>
      <div class="bf-pool__row">
        {jogadores.map((p, i) => {
          const posCls = POS_TO_CLASS[p.posicao ?? ""] ?? "mei";
          const hasCutout = !!p.foto &&
            (p.foto.includes("thesportsdb") || p.foto.includes("/atletas/"));
          const status = !showStatus ? null : statusInfo(p.statusId);
          const pts = showPoints && p.pts != null ? p.pts : null;
          return (
            <div
              class={`bf-pool__item bf-pool__item--${posCls}`}
              key={p.atletaId ?? i}
            >
              {p.escudo && (
                <img
                  class="bf-pool__badge bf-pool__badge--escudo"
                  src={p.escudo}
                  alt=""
                />
              )}
              {status && (
                <span
                  class="bf-pool__badge bf-pool__badge--status"
                  style={{ "--st-color": status.cor } as Record<string, string>}
                  title={status.title}
                  aria-label={status.title}
                >
                  {status.sym}
                </span>
              )}
              {
                /* Badges de auto-sub + em-campo: SÓ durante o ao vivo.
                  ↑ entrou no lugar de titular, ↓ era titular e foi
                  rebaixado, bolinha verde = em campo agora. Fora do
                  live, melhorTime ainda calcula substituido/descido
                  como preview, mas exibir confunde. */
              }
              {liveMode && p.subEntrou && (
                <span
                  class="bf-pool__badge bf-pool__badge--sub-in"
                  title="Entrou na auto-substituição"
                  aria-label="Entrou"
                >
                  ↑
                </span>
              )}
              {liveMode && p.subSaiu && (
                <span
                  class="bf-pool__badge bf-pool__badge--sub-out"
                  title="Saiu na auto-substituição"
                  aria-label="Saiu"
                >
                  ↓
                </span>
              )}
              {liveMode && (p.emCampo || p.entrouEmCampo) &&
                !p.subEntrou && !p.subSaiu && (
                <span
                  class="bf-pool__badge bf-pool__badge--em-campo"
                  title="Em campo"
                  aria-label="Em campo"
                />
              )}
              {hasCutout
                ? (
                  <img
                    class="bf-pool__face"
                    src={p.foto!}
                    alt=""
                    loading="lazy"
                  />
                )
                : (
                  <div class="bf-pool__face bf-pool__face--placeholder">
                    <span class="bf-pool__face-initial">
                      {(p.nome ?? "?").charAt(0)}
                    </span>
                  </div>
                )}
              <span class="bf-pool__pos">{p.pos ?? ""}</span>
              <span class="bf-pool__name">{p.nome ?? ""}</span>
              {pts != null && (
                <span
                  class={`bf-pool__pts ${pts < 0 ? "bf-pool__pts--neg" : ""}`}
                >
                  {pts > 0 ? "+" : ""}
                  {pts.toFixed(1).replace(".", ",")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
