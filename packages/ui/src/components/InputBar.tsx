import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { useDesignVariant } from "../context/DesignContext";
import { InputBar as Classic } from "./classic/InputBar";
import {
  InputBar as Refined,
  type InputBarRef,
  type Props,
} from "./refined/InputBar";
import type { FileAttachment, ImageAttachment } from "../types";
export type {
  InteractiveMode,
  SendDelivery,
  InputBarRef,
} from "./refined/InputBar";
interface Draft {
  text: string;
  images: ImageAttachment[];
  files: FileAttachment[];
}
export const InputBar = forwardRef<InputBarRef, Props>(
  function InputBar(props, ref) {
    const innerRef = useRef<InputBarRef>(null);
    const draftRef = useRef<Draft | null>(null);
    const classic = useDesignVariant() === "classic";
    const renderedVariantRef = useRef(classic);
    if (renderedVariantRef.current !== classic) {
      const current = innerRef.current;
      if (current)
        draftRef.current = {
          text: current.getText(),
          images: current.getImages(),
          files: current.getFileAttachments(),
        };
      renderedVariantRef.current = classic;
    }
    useLayoutEffect(() => {
      const saved = draftRef.current;
      if (saved) {
        innerRef.current?.prefillDraft(saved.text, saved.images, saved.files);
        draftRef.current = null;
      }
    }, [classic]);
    useImperativeHandle(
      ref,
      () => ({
        focus: () => innerRef.current?.focus(),
        prefill: (text) => innerRef.current?.prefill(text),
        getText: () => innerRef.current?.getText() ?? "",
        getImages: () => innerRef.current?.getImages() ?? [],
        getFileAttachments: () => innerRef.current?.getFileAttachments() ?? [],
        prefillDraft: (text, images, files) =>
          innerRef.current?.prefillDraft(text, images, files),
      }),
      [],
    );
    const { toolbar: _toolbar, ...classicProps } = props;
    return classic ? (
      <Classic ref={innerRef} {...classicProps} />
    ) : (
      <Refined ref={innerRef} {...props} />
    );
  },
);
