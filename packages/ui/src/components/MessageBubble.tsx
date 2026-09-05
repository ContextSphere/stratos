import { useDesignVariant } from "../context/DesignContext";
import { MessageBubble as Classic } from "./classic/MessageBubble";
import { MessageBubble as Refined, type Props } from "./refined/MessageBubble";
export function MessageBubble(props: Props): React.ReactElement {
  return useDesignVariant() === "classic" ? <Classic {...props} /> : <Refined {...props} />;
}
export { parseContentSegments } from "./refined/MessageBubble";
