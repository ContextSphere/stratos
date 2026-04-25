import { createContext, useContext } from "react";
import type {
  ChatBridge,
  ThreadBridge,
  SettingsBridge,
  PreviewBridge,
  FilesBridge,
  WhatsAppBridge,
} from "./types";

export interface StratosContextValue {
  chat: ChatBridge;
  threads: ThreadBridge;
  settings: SettingsBridge;
  preview?: PreviewBridge;
  files?: FilesBridge;
  whatsapp?: WhatsAppBridge;
}

const StratosContext = createContext<StratosContextValue | null>(null);

export function StratosProvider({
  value,
  children,
}: {
  value: StratosContextValue;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <StratosContext.Provider value={value}>{children}</StratosContext.Provider>
  );
}

export function useStratos(): StratosContextValue {
  const ctx = useContext(StratosContext);
  if (!ctx) {
    throw new Error("useStratos must be used within an StratosProvider");
  }
  return ctx;
}

export function useChatBridge(): ChatBridge {
  return useStratos().chat;
}

export function useThreadBridge(): ThreadBridge {
  return useStratos().threads;
}

export function useSettingsBridge(): SettingsBridge {
  return useStratos().settings;
}

export function usePreviewBridge(): PreviewBridge | undefined {
  return useStratos().preview;
}

export function useFilesBridge(): FilesBridge | undefined {
  return useStratos().files;
}

export function useWhatsAppBridge(): WhatsAppBridge | undefined {
  return useStratos().whatsapp;
}
