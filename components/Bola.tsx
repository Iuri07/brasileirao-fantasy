interface Props {
  size?: number;
  class?: string;
  color?: string;
}

// Bola de futebol flat/minimalista: círculo + pentágono central + 5 costuras
export function Bola(
  { size = 24, class: className, color = "currentColor" }: Props,
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke={color}
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={className}
    >
      <circle cx="16" cy="16" r="14" />
      {/* Pentágono central */}
      <polygon points="16,9 22.7,13.8 20.1,21.7 11.9,21.7 9.3,13.8" />
      {/* Costuras do pentágono até a borda */}
      <line x1="16" y1="9" x2="16" y2="2" />
      <line x1="22.7" y1="13.8" x2="29.3" y2="11.7" />
      <line x1="20.1" y1="21.7" x2="24.2" y2="27.3" />
      <line x1="11.9" y1="21.7" x2="7.8" y2="27.3" />
      <line x1="9.3" y1="13.8" x2="2.7" y2="11.7" />
    </svg>
  );
}
