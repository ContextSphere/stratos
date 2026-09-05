import { createContext, useContext, type ReactNode } from "react";

export type DesignVariant = "classic" | "refined";

export const DesignContext = createContext<DesignVariant>("refined");

export function DesignProvider({
  variant,
  children,
}: {
  variant: DesignVariant;
  children: ReactNode;
}): React.ReactElement {
  return (
    <DesignContext.Provider value={variant}>{children}</DesignContext.Provider>
  );
}

export function useDesignVariant(): DesignVariant {
  return useContext(DesignContext);
}
