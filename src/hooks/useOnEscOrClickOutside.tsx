import React from "react";

export function useOnEscOrClickOutside(
  ref: React.RefObject<HTMLElement>,
  handler: (event: KeyboardEvent | PointerEvent) => void
) {
  React.useEffect(() => {
    const listener = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          handler(event);
        }
      } else if (event instanceof PointerEvent) {
        // Do nothing if clicking ref's element or descendent elements
        if (!ref.current || ref.current.contains(event.target as Node)) {
          return;
        }
        handler(event);
      }
    };

    document.addEventListener("keydown", listener);
    document.addEventListener("pointerdown", listener);

    return () => {
      document.removeEventListener("keydown", listener);
      document.removeEventListener("pointerdown", listener);
    };
  }, [ref, handler]);
}
