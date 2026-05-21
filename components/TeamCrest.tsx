import { timeLigaInfo } from "../lib/times-liga.ts";
import { cdn } from "../lib/cdn.ts";
import Crest from "./Crest.tsx";

interface Props {
  chave: string;
  size?: number;
  /** Sobrescreve o alt da imagem (default: nome do time) */
  alt?: string;
  /** URL explícita do logo — usar quando o pai já resolveu via
   *  timeLigaInfo() no servidor e o componente vai rodar dentro de
   *  uma island (cliente não tem OVERRIDES carregado). */
  logoUrl?: string | null;
}

/**
 * Renderiza o logo oficial do time da Liga da Sexta. Se o logo não
 * existe (ou chave inválida), cai pro Crest splatter+sigla.
 */
export default function TeamCrest(
  { chave, size = 48, alt, logoUrl }: Props,
) {
  const info = timeLigaInfo(chave);
  // Prioridade: prop explícita > info.logo (server-side override map)
  const finalLogo = logoUrl !== undefined ? logoUrl : info?.logo;
  if (finalLogo) {
    return (
      <img
        src={cdn(finalLogo) ?? finalLogo}
        alt={alt ?? info?.displayName ?? chave}
        width={size}
        height={size}
        class="bf-team-crest"
        style={{ width: `${size}px`, height: `${size}px` }}
      />
    );
  }
  return (
    <Crest
      color={info?.color ?? "magenta"}
      sigla={info?.sigla ?? "??"}
      size={size}
    />
  );
}
