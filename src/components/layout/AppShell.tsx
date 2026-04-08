import { PropsWithChildren } from "react";

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <div className="app-shell__veil app-shell__veil--top" />
      <div className="app-shell__veil app-shell__veil--bottom" />
      <div className="app-shell__grain" />
      <div className="app-shell__content">{children}</div>
    </div>
  );
}
