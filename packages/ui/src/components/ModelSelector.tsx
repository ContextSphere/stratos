import { useDesignVariant } from "../context/DesignContext";
import Classic from "./classic/ModelSelector";
import Refined, { type ModelSelectorProps } from "./refined/ModelSelector";
export default function ModelSelector(
  props: ModelSelectorProps,
): React.ReactElement {
  const {
    provider: _p,
    onProviderChange: _pc,
    enabledProviders: _ep,
    providerDisabled: _pd,
    ...classicProps
  } = props;
  return useDesignVariant() === "classic" ? (
    <Classic {...classicProps} />
  ) : (
    <Refined {...props} />
  );
}
