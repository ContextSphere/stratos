import { useDesignVariant } from "../context/DesignContext";
import Classic from "./classic/WorktreeToggle";
import Refined, { type WorktreeToggleProps } from "./refined/WorktreeToggle";
export default function WorktreeToggle(props: WorktreeToggleProps): React.ReactElement | null {
  return useDesignVariant() === "classic" ? <Classic {...props} /> : <Refined {...props} />;
}
