export type CrestColor =
  | "magenta"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "lime";

interface Props {
  color?: CrestColor;
  sigla: string;
  size?: number;
}

export default function Crest({ color = "magenta", sigla, size = 48 }: Props) {
  return (
    <div
      class={`bf-crest bf-crest--${color}`}
      style={{ "--crest-size": `${size}px` } as Record<string, string>}
    >
      <div class="bf-crest__splat"></div>
      <div class="bf-crest__core">
        <span>{sigla}</span>
      </div>
    </div>
  );
}
