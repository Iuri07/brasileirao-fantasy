/**
 * Ícone do scout do Cartola via Font Awesome 6 (free, solid).
 * CSS carregado em routes/_app.tsx — aqui só renderiza o <i> com a
 * classe certa. Cor vem do parent (.bf-event-chip-* ou override
 * específico por código pra cartões/etc).
 */

interface Props {
  codigo: string;
  size?: number;
}

/** Mapeamento código Cartola → classe do Font Awesome free. */
const FA_CLASS: Record<string, string> = {
  // Positivos
  G: "fa-futbol", // Gol — bola
  A: "fa-handshake", // Assistência — passe ajudou colega
  FT: "fa-bullseye", // Na trave — bola atingiu alvo (quase gol)
  FS: "fa-shield-halved", // Falta sofrida — proteção
  DS: "fa-shield", // Desarme — bloqueou
  PS: "fa-hand-back-fist", // Pênalti sofrido — foi tocado
  DD: "fa-mitten", // Defesa difícil — luva goleiro (não tá em free, fallback)
  DP: "fa-hand", // Defesa de pênalti — mão aberta
  SG: "fa-lock", // Sem gols sofrer — gol "trancado"

  // Negativos
  FC: "fa-shoe-prints", // Falta cometida — chuteira
  PP: "fa-circle-xmark", // Pênalti perdido — errou
  PC: "fa-hand-point-down", // Pênalti cometido — sinalizou
  CA: "fa-square", // Cartão amarelo — quadrado (cor via CSS)
  CV: "fa-square", // Cartão vermelho — quadrado (cor via CSS)
  GC: "fa-rotate-left", // Gol contra — fez ao contrário
  GS: "fa-bullseye", // Gol sofrido — foi acertado
  I: "fa-flag", // Impedimento — bandeira
  PI: "fa-arrow-right-long", // Passe incompleto — seta solo
  PE: "fa-ban", // Passe errado — proibido

  // Neutros
  FD: "fa-bullseye-pointer", // Finalização defendida (fallback se não existir)
  FF: "fa-up-right-from-square", // Finalização fora — saiu
};

/** Fallback genérico — círculo pequeno. */
const FALLBACK = "fa-circle";

export default function ScoutIcon({ codigo, size = 12 }: Props) {
  const fa = FA_CLASS[codigo] ?? FALLBACK;
  return (
    <i
      class={`fa-solid ${fa} bf-scout-icon bf-scout-icon--${codigo}`}
      style={{ fontSize: `${size}px` }}
      aria-hidden="true"
    />
  );
}
