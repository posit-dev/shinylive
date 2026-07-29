import * as React from "react";
import { useLoadStatus } from "../hooks/useLoadStatus";
import type { EngineName } from "../load-status";
import { ENGINE_LABEL } from "../load-status";
import { LoadingAnimation } from "./LoadingAnimation";
import "./LoadingStatus.css";

// A warm load still takes a couple of seconds, because the cache saves the
// download but not the wasm compile and interpreter boot. This threshold sits
// above that and well below a cold load, so only slow loads show any text.
const STATUS_DELAY_MS = 3000;

export function LoadingStatus({ engine }: { engine: EngineName }) {
  const { stage } = useLoadStatus(engine);
  const [showStatus, setShowStatus] = React.useState(false);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setShowStatus(true), STATUS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const language = ENGINE_LABEL[engine];

  // Once the engine is ready, the remaining wait belongs to the app: packages
  // pulled in by its imports, then startup.
  let stageText: string;
  if (stage === "idle" || stage === "engine-download") {
    stageText = `Downloading ${language}…`;
  } else if (stage === "engine-start") {
    stageText = `Starting ${language}…`;
  } else if (stage === "ready") {
    stageText = "Loading packages and starting app…";
  } else {
    // "failed": Viewer shows an error instead of this component, so this is
    // only a fallback.
    stageText = "Loading…";
  }

  return (
    <div className="loading-status">
      <div className="loading-content">
        <LoadingAnimation />
        {showStatus ? (
          <p className="loading-stage" role="status" aria-live="polite">
            {stageText}
          </p>
        ) : null}
      </div>
    </div>
  );
}
