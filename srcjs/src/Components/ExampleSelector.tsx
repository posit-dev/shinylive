import * as React from "react";
import {
  getExampleCategories,
  ExamplePosition,
  findExampleByTitle,
  ExampleCategory,
  sanitizeTitleForUrl,
  ExampleItem,
} from "../examples";
import "./ExampleSelector.css";
import { FileContent } from "./types";

function ExampleSelector({
  setCurrentFiles,
  filesHaveChanged,
}: {
  setCurrentFiles: React.Dispatch<React.SetStateAction<FileContent[]>>;
  filesHaveChanged: boolean;
}) {
  const { linkedExample, setLinkedExample } = useExampleLinks();

  const [currentSelection, setCurrentSelection] =
    React.useState<ExamplePosition>({ categoryIndex: 0, index: 0 });

  // This starts null; will be set by a useEffect which calls an async function.
  const [exampleCategories, setExampleCategories] = React.useState<
    ExampleCategory[] | null
  >(null);

  React.useEffect(() => {
    (async () => {
      setExampleCategories(await getExampleCategories());
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      if (!exampleCategories) return;

      let position = findExampleByTitle(linkedExample, exampleCategories);
      if (!position) {
        position = { categoryIndex: 0, index: 0 };
      }
      console.log("position", position);
      setCurrentSelection(position);
    })();
  }, [linkedExample, exampleCategories]);

  const setFilesForApp = React.useCallback(
    ({ categoryIndex, index }: ExamplePosition) => {
      if (!exampleCategories) return;
      setCurrentFiles(exampleCategories[categoryIndex].apps[index].files);
    },
    [exampleCategories, setCurrentFiles]
  );

  const chooseExample = React.useCallback(
    ({ categoryIndex, index }: ExamplePosition) => {
      if (!exampleCategories) return;
      if (filesHaveChanged) {
        if (!confirm("Discard all changes to files?")) return;
      }
      const example = exampleCategories[categoryIndex].apps[index];

      setCurrentSelection({ categoryIndex, index });
      setLinkedExample(example.title);
    },
    [filesHaveChanged, exampleCategories, setCurrentSelection, setLinkedExample]
  );

  // Keep app up-to-date with current selection
  React.useEffect(() => {
    if (!currentSelection) return;
    console.log("currentSelection", currentSelection);
    setFilesForApp(currentSelection);
  }, [currentSelection, setFilesForApp]);

  function renderExampleItem({
    item,
    index,
    categoryIndex,
  }: {
    item: ExampleItem;
    index: number;
    categoryIndex: number;
  }) {
    if (!currentSelection) return null;

    const isSelected =
      currentSelection.categoryIndex === categoryIndex &&
      currentSelection.index === index;

    // Use the React. Fragment component instead of <></> so we can use the key prop
    return (
      <React.Fragment key={item.title}>
        <div className={"example" + (isSelected ? " selected" : "")}>
          <a
            href={buildUrlForExample(item.title)}
            onClick={(e) => {
              // Holding down the command key and clicking will open example in
              // a new browser. If this happens we don't want to update the
              // current app as well so we will exit early
              const newTabClick = e.metaKey;
              if (newTabClick) return;

              // Given this is a normal click we want to override the defaults
              // of the link so we don't trigger a page refresh
              e.preventDefault();

              // Clicking on a selected example wont do anything so don't even
              // mess with the state
              if (isSelected) return;
              chooseExample({ categoryIndex, index });
            }}
          >
            <h4 className="title">{item.title}</h4>
            <p className="about">{item.about}</p>
          </a>
        </div>
        <div className="divider" />
      </React.Fragment>
    );
  }

  return (
    <div className="ExampleSelector">
      <div className="categories">
        <h2>Examples</h2>
        {exampleCategories?.map(({ category, apps }, categoryIndex) => (
          <section key={category}>
            <h3 className="category-title">{category}</h3>
            {apps.map((item, index) =>
              renderExampleItem({ item, index, categoryIndex })
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

export default ExampleSelector;

// Uses url hash to find and load a given example from a link
function useExampleLinks() {
  const hashParams = window.location.hash.replace(/^#/, "");

  const setLinkedExample = React.useCallback((title: string) => {
    window.location.hash = "#" + sanitizeTitleForUrl(title);
  }, []);

  return {
    linkedExample: hashParams,
    setLinkedExample,
  };
}

function buildUrlForExample(title: string) {
  return (
    window.location.origin +
    window.location.pathname +
    "#" +
    sanitizeTitleForUrl(title)
  );
}
