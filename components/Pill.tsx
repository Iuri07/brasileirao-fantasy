import { ComponentChildren } from "preact";

interface Props {
  variant?: "default" | "lime" | "magenta";
  live?: boolean;
  children: ComponentChildren;
}

export default function Pill(
  { variant = "default", live = false, children }: Props,
) {
  const cls = ["bf-pill"];
  if (variant === "lime") cls.push("bf-pill--lime");
  if (variant === "magenta") cls.push("bf-pill--magenta");
  return (
    <span class={cls.join(" ")}>
      {live && <span class="bf-pill__dot"></span>}
      {children}
    </span>
  );
}
