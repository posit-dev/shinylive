import React from "react";
import {
  DragState,
  initDragState,
  updateDragState,
} from "./DragToResizeHelpers";

export function useDragToResizeGrid({
  containerRef,
  onDragEnd,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
  onDragEnd?: (newSizes: { dir: "rows" | "columns"; sizes: string[] }) => void;
}) {
  const dragStateRef = React.useRef<DragState | null>(null);

  const startDrag = React.useCallback(
    ({
      e,
      dir,
      index,
    }: {
      e: React.MouseEvent;
      dir: "rows" | "columns";
      index: number;
    }) => {
      if (!containerRef.current) {
        console.error(
          "How are you dragging on an element without a container?"
        );
        return;
      }

      // If we're already dragging, don't try to start another drag.
      if (dragStateRef.current) {
        return;
      }

      // This prevents the mouse down from triggering un-desired things like text-selection etc.
      e.preventDefault();

      dragStateRef.current = initDragState({
        mousePosition: e,
        dir,
        index,
        container: containerRef.current,
      });

      startListeningForMouseMove();
    },
    [containerRef]
  );

  const onMouseMove = React.useCallback(
    (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) {
        console.error(
          "How are you dragging on an element without a container?"
        );
        return;
      }

      if (!dragStateRef.current) {
        console.error("Mouse move detected without any current drag state.");
        return;
      }

      updateDragState({
        mousePosition: e,
        drag: dragStateRef.current,
        container,
      });
    },
    [containerRef, dragStateRef]
  );

  const finishDrag = React.useCallback(() => {
    if (!dragStateRef.current) {
      console.error("Mouse up detected without any current drag state.");
      return;
    }
    const container = containerRef.current;
    if (!container) {
      console.error("How are you dragging on an element without a container?");
      return;
    }

    // TODO: Update the javascript arrays containing the sizes to remove
    // reliance on node state for sizing
    stopListeningForMouseMove();

    // Get the final sizes after dragging
    if (onDragEnd) {
      const { dir } = dragStateRef.current;
      const finalSizes =
        dir === "columns"
          ? container.style.gridTemplateColumns
          : container.style.gridTemplateRows;

      onDragEnd({ dir, sizes: finalSizes.split(" ") });
    }
    dragStateRef.current = null;
  }, []);

  const dragWatcherDivRef = React.useRef<HTMLDivElement | null>(null);

  const startListeningForMouseMove = React.useCallback(() => {
    const container = containerRef.current;

    if (!container) {
      console.error("How are you dragging on an element without a container?");
      return;
    }
    // Make a big div that covers the screen to listen for the rest of the mouse commands
    const dragWatcherDiv = document.createElement("div");
    dragWatcherDiv.style.position = "fixed";
    dragWatcherDiv.style.inset = "0px";
    dragWatcherDiv.style.opacity = "0";
    // Keep the cursor consistant with the appropriate direction resizer to let
    // the user know they're in "drag mode"
    dragWatcherDiv.style.cursor =
      dragStateRef.current?.dir === "rows" ? "ns-resize" : "ew-resize";

    dragWatcherDivRef.current = dragWatcherDiv;
    container.appendChild(dragWatcherDiv);
    dragWatcherDiv.addEventListener("mousemove", onMouseMove);

    // Lifting mouse click up or dragging off the window will finish the resize
    // event
    dragWatcherDiv.addEventListener("mouseup", finishDrag);
    dragWatcherDiv.addEventListener("mouseleave", finishDrag);
  }, [onMouseMove]);

  const stopListeningForMouseMove = React.useCallback(() => {
    const container = containerRef.current;

    if (!container) {
      console.error("How are you dragging on an element without a container?");
      return;
    }
    const dragWatcherDiv = dragWatcherDivRef.current;
    if (!dragWatcherDiv) {
      throw new Error("Can't find div used to watch for drag...");
    }
    dragWatcherDiv.removeEventListener("mousemove", onMouseMove);
    dragWatcherDiv.removeEventListener("mouseup", finishDrag);
    dragWatcherDiv.removeEventListener("mouseleave", finishDrag);
    dragWatcherDiv.remove();
    dragWatcherDivRef.current = null;
  }, [onMouseMove]);

  return {
    startDrag,
  };
}
