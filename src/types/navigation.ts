export type PrimaryRoute = "chat" | "apps" | "tasks" | "radar" | "settings";

export interface NavigationItem {
  id: PrimaryRoute;
  label: string;
}
