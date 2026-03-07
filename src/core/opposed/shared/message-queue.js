/**
 * src/core/opposed/shared/message-queue.js
 *
 * Factory for a per-message async write mutex used by all opposed workflow
 * card updaters (combat, magic, skills).
 *
 * The mutex ensures at most one updateCard call per messageId is in-flight.
 * The second caller waits until the first completes, then reads the
 * freshly-updated flags and merges correctly — preventing lost-update races.
 */

/**
 * Create a per-message async mutex.
 *
 * Returns an `enqueue(messageId, fn)` function that chains `fn` behind any
 * pending call for the same `messageId`.
 *
 * @returns {(messageId: string, fn: () => Promise<void>) => Promise<void>}
 */
export function createMessageQueue() {
  /** @type {Map<string, Promise<void>>} */
  const _queues = new Map();

  return function enqueue(messageId, fn) {
    const prev = _queues.get(messageId) ?? Promise.resolve();
    // Chain: wait for previous write, then run ours.
    // Swallow errors from earlier writes so they don't block subsequent ones.
    const next = prev.catch(() => {}).then(fn);
    _queues.set(messageId, next);
    // Clean up once the full chain for this id settles (avoid memory leak).
    next.finally(() => {
      if (_queues.get(messageId) === next) _queues.delete(messageId);
    });
    return next;
  };
}
