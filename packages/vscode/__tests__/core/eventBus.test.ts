import { ExtensionEventBus } from '../../src/core/eventBus';
import { EVENTS } from '../../src/constants/events';

describe('ExtensionEventBus', () => {
  let eventBus: ExtensionEventBus;

  beforeEach(() => {
    eventBus = new ExtensionEventBus();
  });

  describe('on / emit', () => {
    it('delivers payload to a registered listener', () => {
      const listener = jest.fn();
      eventBus.on(EVENTS.PAPER_ADDED, listener);
      eventBus.emit(EVENTS.PAPER_ADDED, { id: 'p1' });
      expect(listener).toHaveBeenCalledWith({ id: 'p1' });
    });

    it('calls all listeners registered for the same event', () => {
      const l1 = jest.fn();
      const l2 = jest.fn();
      eventBus.on(EVENTS.PAPER_ADDED, l1);
      eventBus.on(EVENTS.PAPER_ADDED, l2);
      eventBus.emit(EVENTS.PAPER_ADDED, {});
      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });

    it('does not call listeners registered for a different event', () => {
      const listener = jest.fn();
      eventBus.on(EVENTS.PAPER_ADDED, listener);
      eventBus.emit(EVENTS.PAPER_DELETED, {});
      expect(listener).not.toHaveBeenCalled();
    });

    it('passes the exact payload object to the listener', () => {
      const listener = jest.fn();
      const payload = { id: 'p2', title: 'Test' };
      eventBus.on(EVENTS.PAPER_UPDATED, listener);
      eventBus.emit(EVENTS.PAPER_UPDATED, payload);
      expect(listener).toHaveBeenCalledWith(payload);
    });
  });
});
