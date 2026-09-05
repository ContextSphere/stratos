import { useDesignVariant } from "../context/DesignContext";
import { ToolCallCard as Classic } from "./classic/ToolCallCard";
import { ToolCallCard as Refined, type Props } from "./refined/ToolCallCard";
export function ToolCallCard(props: Props): React.ReactElement {
  return useDesignVariant() === "classic" ? <Classic {...props} /> : <Refined {...props} />;
}
