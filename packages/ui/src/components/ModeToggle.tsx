import { useDesignVariant } from "../context/DesignContext";
import Classic from "./classic/ModeToggle";
import Refined, { type ModeToggleProps } from "./refined/ModeToggle";
export default function ModeToggle(props: ModeToggleProps): React.ReactElement {
  return useDesignVariant() === "classic" ? <Classic {...props} /> : <Refined {...props} />;
}
