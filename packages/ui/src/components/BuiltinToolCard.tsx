import { useDesignVariant } from "../context/DesignContext";
import { BuiltinToolCard as Classic } from "./classic/BuiltinToolCard";
import { BuiltinToolCard as Refined, type Props } from "./refined/BuiltinToolCard";
export function BuiltinToolCard(props: Props): React.ReactElement {
  return useDesignVariant() === "classic" ? <Classic {...props} /> : <Refined {...props} />;
}
