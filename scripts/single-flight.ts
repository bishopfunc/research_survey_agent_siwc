/** Share an in-flight fetch only. A completed or failed fetch never prevents a later refresh/retry. */
export function singleFlight<K, V>() {
  const pending = new Map<K, Promise<V>>();
  return (key: K, start: () => Promise<V>): Promise<V> => {
    const existing = pending.get(key); if (existing) return existing;
    const promise = Promise.resolve().then(start).finally(() => { if (pending.get(key) === promise) pending.delete(key); });
    pending.set(key, promise); return promise;
  };
}
