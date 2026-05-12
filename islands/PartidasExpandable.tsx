import { useState } from "preact/hooks";
import Partidas from "../components/Partidas.tsx";
import type { CartolaClube, CartolaPartida } from "../lib/cartola.ts";

interface Props {
  partidas: CartolaPartida[];
  clubes: Record<string, CartolaClube>;
  /** Quantos jogos exibir colapsado. Default 5. */
  limit?: number;
}

export default function PartidasExpandable(
  { partidas, clubes, limit = 5 }: Props,
) {
  const [expandido, setExpandido] = useState(false);
  const total = partidas.length;
  const podeExpandir = total > limit;
  // Sempre renderizamos os jogos "acima do limit" (sempre visíveis) e os
  // "abaixo do limit" dentro de um container que anima a expansão via
  // grid-template-rows (0fr → 1fr).
  const sempreVisiveis = podeExpandir ? partidas.slice(0, limit) : partidas;
  const extras = podeExpandir ? partidas.slice(limit) : [];
  return (
    <>
      <Partidas partidas={sempreVisiveis} clubes={clubes} />
      {extras.length > 0 && (
        <div
          class={`bf-partidas-expand ${
            expandido ? "bf-partidas-expand--open" : ""
          }`}
          aria-hidden={!expandido}
        >
          <div class="bf-partidas-expand__inner">
            <Partidas partidas={extras} clubes={clubes} />
          </div>
        </div>
      )}
      {podeExpandir && (
        <div class="bf-section-footer">
          <button
            type="button"
            class="bf-section-footer__chev"
            onClick={() => setExpandido(!expandido)}
            aria-label={expandido ? "Ver menos" : `Ver todos (${total})`}
            title={expandido ? "Ver menos" : `Ver todos (${total})`}
            aria-expanded={expandido}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              class={`bf-section-footer__chev-icon ${
                expandido ? "bf-section-footer__chev-icon--up" : ""
              }`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}
