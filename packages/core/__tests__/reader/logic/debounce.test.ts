import { createDebouncer, type Timers } from '../../../src/reader/logic/debounce';

/** In-memory Timers implementation so tests do not depend on real wall-clock time. */
function fakeTimers(): Timers & { run(handle: unknown): void; pendingHandles(): unknown[] } {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  return {
    set(fn) {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
    run(handle) {
      const fn = pending.get(handle as number);
      if (fn) { fn(); }
    },
    pendingHandles() {
      return [...pending.keys()];
    },
  };
}

describe('createDebouncer', () => {
  it('fires the trailing call with the latest arguments once the timer runs', () => {
    const timers = fakeTimers();
    const fn = jest.fn();
    const debouncer = createDebouncer(fn, 800, timers);

    debouncer.call('first');
    debouncer.call('second');
    debouncer.call('third');
    expect(fn).not.toHaveBeenCalled();

    const [handle] = timers.pendingHandles();
    timers.run(handle);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('third');
  });

  it('flush runs a pending call immediately, exactly once', () => {
    const timers = fakeTimers();
    const fn = jest.fn();
    const debouncer = createDebouncer(fn, 800, timers);

    debouncer.call('value');
    debouncer.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('value');

    // The pending call was consumed; the timer firing later must not call fn again.
    expect(debouncer.pending).toBe(false);
  });

  it('flush with nothing pending is a no-op', () => {
    const timers = fakeTimers();
    const fn = jest.fn();
    const debouncer = createDebouncer(fn, 800, timers);

    debouncer.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel drops the pending call without invoking fn', () => {
    const timers = fakeTimers();
    const fn = jest.fn();
    const debouncer = createDebouncer(fn, 800, timers);

    debouncer.call('value');
    debouncer.cancel();
    expect(debouncer.pending).toBe(false);

    debouncer.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('exposes a pending getter that reflects whether a call is scheduled', () => {
    const timers = fakeTimers();
    const debouncer = createDebouncer(jest.fn(), 800, timers);

    expect(debouncer.pending).toBe(false);
    debouncer.call('x');
    expect(debouncer.pending).toBe(true);
    debouncer.flush();
    expect(debouncer.pending).toBe(false);
  });
});

describe('createDebouncer with real (fake) jest timers', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces trailing calls using the default setTimeout-based timers', () => {
    const fn = jest.fn();
    const debouncer = createDebouncer(fn, 800);

    debouncer.call('a');
    jest.advanceTimersByTime(400);
    debouncer.call('b');
    jest.advanceTimersByTime(400);
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');
  });
});
