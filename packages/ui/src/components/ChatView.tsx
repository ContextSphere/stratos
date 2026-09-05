import { forwardRef, useImperativeHandle, useRef } from "react";
import { useDesignVariant } from "../context/DesignContext";
import { ChatView as Classic, type ChatViewHandle } from "./classic/ChatView";
import { ChatView as Refined, type Props } from "./refined/ChatView";
export type { ChatViewHandle } from "./classic/ChatView";
export const ChatView = forwardRef<ChatViewHandle, Props>(
  function ChatView(props, ref) {
    const classicRef = useRef<ChatViewHandle>(null);
    const refinedRef = useRef<ChatViewHandle>(null);
    const classic = useDesignVariant() === "classic";
    useImperativeHandle(
      ref,
      () => ({
        scrollToMessage: (id) =>
          (classic ? classicRef : refinedRef).current?.scrollToMessage(id),
        scrollToBottom: () =>
          (classic ? classicRef : refinedRef).current?.scrollToBottom(),
      }),
      [classic],
    );
    return classic ? (
      <Classic ref={classicRef} {...props} />
    ) : (
      <Refined ref={refinedRef} {...props} />
    );
  },
);
