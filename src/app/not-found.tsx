import { NotFoundView } from "@/components/shell/NotFoundView";

/**
 * Unknown address (NAV-6). With UI_UNIFIED on for the user: our translated page inside the shell,
 * with a way back to the apps; otherwise the same plain page as before.
 */
export default function NotFound() {
  return <NotFoundView />;
}
