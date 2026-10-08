/**
 * Trailing debouncer with an explicit flush, used for reading-state saves that must not be lost when the panel hides.
 */

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface Debouncer<A extends unknown[]> {
  call(...args: A): void;
  /** Runs the pending call now, if any. */
  flush(): void;
  cancel(): void;
  readonly pending: boolean;
}

/**
 * @returns a debouncer that invokes `fn` with the latest arguments after `ms` of quiet.
 */
export function createDebouncer<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  timers: Timers = defaultTimers,
): Debouncer<A> {
  let handle: unknown = null;
  let lastArgs: A | null = null;

  const run = (): void => {
    const args = lastArgs;
    handle = null;
    lastArgs = null;
    if (args) { fn(...args); }
  };

  return {
    call(...args: A): void {
      lastArgs = args;
      if (handle !== null) { timers.clear(handle); }
      handle = timers.set(run, ms);
    },
    flush(): void {
      if (handle === null) { return; }
      timers.clear(handle);
      run();
    },
    cancel(): void {
      if (handle !== null) { timers.clear(handle); }
      handle = null;
      lastArgs = null;
    },
    get pending(): boolean { return handle !== null; },
  };
}
