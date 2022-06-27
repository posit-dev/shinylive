/**
 * (c) 2022, Micro:bit Educational Foundation and contributors
 *
 * SPDX-License-Identifier: MIT
 */
const defaultWaiter = (waitTime: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, waitTime));

export const retryAsyncLoad = async <T>(
  load: () => Promise<T>,
  waiter: (waitTime: number) => Promise<void> = defaultWaiter
): Promise<T> => {
  let waitTime = 250;
  let attempts = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // Must await here!
      return await load();
    } catch (e) {
      if (attempts === 4) {
        throw e;
      }
      await waiter(waitTime);
      attempts++;
      waitTime *= 3;
    }
  }
};
