// Error objects which need to be sent via postMessage() are turned into one of
// these objects. This is because on Safari, `structuredClone(e)` throws an
// error, even for a bare Error object, as in `structuredClone(new Error())`. I
// think this is bug in Safari because Errors should be cloneable.
// https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
// To work around this, instead of sending the Error object directly, we'll
// convert it to this plain object and send that.
//
// If Safari fixes this issue, we'll be able to remove all of this stuff, and
// simply post the Error object directly.
export type PostableErrorObject = {
  message: string;
  name: string;
  stack?: string;
};

export function errorToPostableErrorObject(
  e: Error | any
): PostableErrorObject {
  const errObj: PostableErrorObject = {
    message: "An unknown error occured",
    name: e.name,
  };

  if (!(e instanceof Error)) {
    return errObj;
  }

  errObj.message = e.message;

  if (e.stack) {
    errObj.stack = e.stack;
  }

  return errObj;
}

export function postableErrorObjectToError(
  errObj: PostableErrorObject | any
): Error {
  // In the future, it's probably better to use `Object.hasOwn()` instead of
  // `in`, but at the time of this writing (2022-07), it is very new and we
  // can't expect all browsers to support it yet.
  if ("message" in errObj && "name" in errObj) {
    // This is a PostableErrorObject.
    const err = new Error(errObj.message);
    err.name = errObj.name;
    if (errObj.stack !== undefined) {
      err.stack = errObj.stack;
    }
    return err;
  } else {
    return new Error("An unknown error occured");
  }
}
