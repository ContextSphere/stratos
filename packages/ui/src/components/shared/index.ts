/**
 * Shared component library following the design system.
 *
 * All components use design tokens and consistent patterns.
 * See docs/DESIGN.md for the full design system documentation.
 */

export { Button } from "./Button";
export type { ButtonProps } from "./Button";

export { Input } from "./Input";
export type { InputProps } from "./Input";

export { Dialog, DialogBody, DialogSection } from "./Dialog";
export type { DialogProps } from "./Dialog";

export { Card } from "./Card";
export type { CardProps } from "./Card";

export {
  StatusIndicator,
  LoadingSpinner,
  TypingIndicator,
} from "./StatusIndicator";
export type { StatusIndicatorProps } from "./StatusIndicator";

export { DiagnosticToast, DiagnosticToastContainer } from "./DiagnosticToast";

export { default as DropdownPicker } from "./DropdownPicker";
export type { DropdownItem } from "./DropdownPicker";
