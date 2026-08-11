// A typed publish/subscribe bus, and the only cross-system coupling the
// architecture allows (§8.1.5).
//
// The rule it enforces is worth more than the twenty lines it costs: combat
// does not import the quest log, the quest log does not import the HUD, and
// nothing imports the renderer. They all speak through named events, which
// means a system can be switched off with `?off=` and the rest still runs —
// which is how you bisect a bug in a world this big.

const handlers = new Map();

export function on(type, fn) {
  let list = handlers.get(type);
  if (!list) handlers.set(type, (list = []));
  list.push(fn);
  return () => off(type, fn);
}

export function off(type, fn) {
  const list = handlers.get(type);
  if (!list) return;
  const i = list.indexOf(fn);
  if (i >= 0) list.splice(i, 1);
}

export function emit(type, payload) {
  const list = handlers.get(type);
  if (!list) return;
  // Iterated over a copy: a handler that unsubscribes itself mid-dispatch is
  // ordinary (a one-shot quest trigger does exactly that) and must not make the
  // loop skip its neighbour.
  for (const fn of list.slice()) fn(payload);
}

/** For tests and for the dev overlay's "what is listening" line. */
export const listenerCount = (type) => (handlers.get(type) || []).length;
export function clearAll() { handlers.clear(); }
