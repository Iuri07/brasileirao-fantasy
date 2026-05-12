import { timeLigaInfo } from "../lib/times-liga.ts";
import Crest from "./Crest.tsx";

interface Props {
  chave: string;
  size?: number;
  /** Sobrescreve o alt da imagem (default: nome do time) */
  alt?: string;
}

/**
 * Renderiza o logo oficial do time da Liga da Sexta. Se o logo não
 * existe (ou chave inválida), cai pro Crest splatter+sigla.
 */
export default function TeamCrest({ chave, size = 48, alt }: Props) {
  const info = timeLigaInfo(chave);
  if (info?.logo) {
    return (
      <img
        src={info.logo}
        alt={alt ?? info.displayName ?? chave}
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
