import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import exampleItems from "../examples.json";
import ExampleSelector from "./ExampleSelector";

const desiredExample = exampleItems[1].apps[1];
test("Selecting an example will trigger the proper change", () => {
  const onFileChange = jest.fn();
  render(
    <ExampleSelector filesHaveChanged={false} setCurrentFiles={onFileChange} />
  );

  // Click on a desired example title
  userEvent.click(screen.getByText(desiredExample.title));

  // Should get the files content of that example back
  expect(onFileChange).toHaveBeenLastCalledWith(desiredExample.files);
});

test("Trying to switch examples after edits have been made will trigger a confirmation dialog", () => {
  const onFileChange = jest.fn();
  window.confirm = jest.fn();
  render(
    <ExampleSelector filesHaveChanged={true} setCurrentFiles={onFileChange} />
  );

  // Click on a desired example title
  userEvent.click(screen.getByText(desiredExample.title));

  // A confirm dialog should popup to let the user know they will throw away edits
  expect(window.confirm).toHaveBeenLastCalledWith(
    "Discard all changes to files?"
  );
});

test("Repeat selections of the same example won't trigger updates", () => {
  const onFileChange = jest.fn();
  render(
    <ExampleSelector filesHaveChanged={false} setCurrentFiles={onFileChange} />
  );

  // Click on a desired example title
  userEvent.click(screen.getByText(desiredExample.title));

  // Record how many times the file change mock function has been called by component
  const numOnFileChangeCalls = onFileChange.mock.calls.length;

  // Select the same example again
  userEvent.click(screen.getByText(desiredExample.title));

  // Number of times the fileChange callback has been called has not gone up
  expect(onFileChange).toHaveBeenCalledTimes(numOnFileChangeCalls);
});
