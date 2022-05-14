import React from "react";

export function useOnEscOrClickOutside(
  ref: React.RefObject<HTMLElement>,
  handler: (event: MouseEvent | TouchEvent | KeyboardEvent) => void
) {
  React.useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          handler(event);
        }
      } else if (event instanceof MouseEvent || event instanceof TouchEvent) {
        // Do nothing if clicking ref's element or descendent elements
        if (!ref.current || ref.current.contains(event.target as Node)) {
          return;
        }
        handler(event);
      }
    };

    document.addEventListener("keydown", listener);
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);

    return () => {
      document.removeEventListener("keydown", listener);
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
}
