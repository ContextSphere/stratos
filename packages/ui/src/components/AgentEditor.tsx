import { useDesignVariant } from "../context/DesignContext";
import { AgentEditor as Classic } from "./classic/AgentEditor";
import { AgentEditor as Refined, type Props } from "./refined/AgentEditor";

export function AgentEditor(props: Props): React.ReactElement {
  return useDesignVariant() === "classic" ? (
    <Classic {...props} />
  ) : (
    <Refined {...props} />
  );
}
