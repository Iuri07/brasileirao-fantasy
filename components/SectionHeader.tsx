import { ComponentChildren } from "preact";

interface Props {
  children: ComponentChildren;
  right?: ComponentChildren;
}

export default function SectionHeader({ children, right }: Props) {
  return (
    <div class="bf-section-header">
      <div class="bf-section-header__title">{children}</div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}
