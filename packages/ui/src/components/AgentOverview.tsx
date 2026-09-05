import { useDesignVariant } from "../context/DesignContext";
import { AgentOverview as Classic } from "./classic/AgentOverview";
import { AgentOverview as Refined, type Props } from "./refined/AgentOverview";
export type { AgentFidelityInfo } from "./refined/AgentOverview";
export function AgentOverview(props: Props): React.ReactElement {
  return useDesignVariant() === "classic" ? (
    <Classic {...props} />
  ) : (
    <Refined {...props} />
  );
}
