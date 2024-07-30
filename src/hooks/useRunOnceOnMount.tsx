import React from "react";

/**
 * Executes a callback function only once when the component mounts.
 *
 * @param {Function} callback - The callback function to be executed on mount.
 */
export function useRunOnceOnMount(callback: () => void) {
  // This is needed to prevent the callback from being run twice -- in React
  // strict mode, a useEffect will run twice.
  const hasRun = React.useRef(false);

  React.useEffect(() => {
    if (!hasRun.current) {
      callback();
      hasRun.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
