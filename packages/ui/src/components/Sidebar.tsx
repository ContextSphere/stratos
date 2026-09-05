import { useDesignVariant } from "../context/DesignContext";
import { Sidebar as Classic } from "./classic/Sidebar";
import { Sidebar as Refined, type Props } from "./refined/Sidebar";
export type { SidebarGrouping } from "./refined/Sidebar";
export function Sidebar(props: Props): React.ReactElement {
  return useDesignVariant() === "classic" ? <Classic {...props} /> : <Refined {...props} />;
}
