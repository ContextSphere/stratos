import { useDesignVariant } from "../context/DesignContext";
import { AgentGroupList as Classic } from "./classic/AgentGroupList";
import { AgentGroupList as Refined, type Props } from "./refined/AgentGroupList";
export function AgentGroupList(props: Props): React.ReactElement {
  return useDesignVariant() === "classic" ? <Classic {...props} /> : <Refined {...props} />;
}
