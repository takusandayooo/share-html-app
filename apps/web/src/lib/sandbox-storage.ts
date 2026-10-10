export const STORAGE_LIMIT = 262144; // JSON UTF-16 code units per viewer and share.
export const STORAGE_CHANNEL = "sharepages:storage:v1";
export type StorageEntries = Record<string, string>;

export function storageNamespace(shareId: string, viewerId: string | null) {
  return `sharepages:html-storage:v1:${JSON.stringify([viewerId, shareId])}`;
}

export function parseEntries(value: unknown): StorageEntries {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid storage data");
  const entries: StorageEntries = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") throw new Error("Invalid storage value");
    entries[key] = item;
  }
  if (JSON.stringify(entries).length > STORAGE_LIMIT)
    throw new Error("Storage quota exceeded");
  return entries;
}

export function readEntries(
  storage: Pick<Storage, "getItem">,
  namespace: string,
) {
  const raw = storage.getItem(namespace);
  return raw === null
    ? (Object.create(null) as StorageEntries)
    : parseEntries(JSON.parse(raw));
}

export function saveStorageMessage(
  event: Pick<MessageEvent, "source" | "origin" | "data">,
  frame: Window | null,
  token: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  namespace: string,
) {
  if (!frame || event.source !== frame || event.origin !== "null") return false;
  const data = event.data;
  if (!data || data.channel !== STORAGE_CHANNEL || data.token !== token)
    return false;
  if (!["set", "remove", "clear"].includes(data.op)) return false;
  if (data.op !== "clear" && typeof data.key !== "string") return false;
  if (data.op === "set" && typeof data.value !== "string") return false;
  const entries = readEntries(storage, namespace);
  if (data.op === "set") entries[data.key] = data.value;
  else if (data.op === "remove") delete entries[data.key];
  else {
    storage.removeItem(namespace);
    return true;
  }
  parseEntries(entries);
  storage.setItem(namespace, JSON.stringify(entries));
  return true;
}

// Self-contained: this function is serialized into srcDoc before uploaded scripts.
function installStorage(
  channel: string,
  token: string,
  initial: StorageEntries,
  parentOrigin: string,
  limit: number,
  available: boolean,
) {
  let entries: StorageEntries = Object.assign(Object.create(null), initial);
  const notify = (op: string, key?: string, value?: string) => {
    window.parent.postMessage({ channel, token, op, key, value }, parentOrigin);
  };
  const assertAvailable = () => {
    if (!available)
      throw new DOMException("Browser storage is unavailable", "SecurityError");
  };
  const setItem = (key: string, value: string) => {
    assertAvailable();
    key = String(key);
    value = String(value);
    const next = Object.assign(Object.create(null), entries, { [key]: value });
    if (JSON.stringify(next).length > limit)
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    entries = next;
    notify("set", key, value);
  };
  const removeItem = (key: string) => {
    assertAvailable();
    key = String(key);
    delete entries[key];
    notify("remove", key);
  };
  const methods = Object.create(null);
  Object.defineProperties(methods, {
    length: { configurable: true, get: () => Object.keys(entries).length },
    key: {
      configurable: true,
      value: (index: number) =>
        Object.keys(entries)[Number(index) >>> 0] ?? null,
    },
    getItem: {
      configurable: true,
      value: (key: string) => entries[String(key)] ?? null,
    },
    setItem: { configurable: true, value: setItem },
    removeItem: { configurable: true, value: removeItem },
    clear: {
      configurable: true,
      value: () => {
        assertAvailable();
        entries = Object.create(null);
        notify("clear");
      },
    },
    [Symbol.toStringTag]: { configurable: true, value: "Storage" },
  });
  const proxy = new Proxy(methods, {
    get: (target, key) =>
      Object.hasOwn(target, key)
        ? Reflect.get(target, key)
        : typeof key === "string"
          ? entries[key]
          : undefined,
    set: (_target, key, value) => {
      if (typeof key !== "string") return false;
      setItem(key, value);
      return true;
    },
    deleteProperty: (_target, key) => {
      if (typeof key !== "string") return false;
      removeItem(key);
      return true;
    },
    has: (target, key) =>
      Object.hasOwn(target, key) || Object.hasOwn(entries, key),
    ownKeys: (target) => [
      ...Reflect.ownKeys(target),
      ...Object.keys(entries).filter((key) => !Object.hasOwn(target, key)),
    ],
    getOwnPropertyDescriptor: (target, key) =>
      Object.hasOwn(target, key)
        ? Reflect.getOwnPropertyDescriptor(target, key)
        : typeof key === "string" && Object.hasOwn(entries, key)
          ? {
              configurable: true,
              enumerable: true,
              writable: true,
              value: entries[key],
            }
          : undefined,
    defineProperty: (_target, key, descriptor) => {
      if (typeof key !== "string" || !("value" in descriptor)) return false;
      setItem(key, descriptor.value);
      return true;
    },
  });
  Object.defineProperty(window, "localStorage", {
    configurable: false,
    get: () => {
      assertAvailable();
      return proxy;
    },
  });
  window.addEventListener("message", (event) => {
    if (
      event.source !== window.parent ||
      event.origin !== parentOrigin ||
      event.data?.channel !== channel ||
      event.data.token !== token
    )
      return;
    if (event.data.op === "error") {
      available = false;
      return;
    }
    if (
      event.data.op !== "sync" ||
      !event.data.entries ||
      typeof event.data.entries !== "object"
    )
      return;
    const next: StorageEntries = Object.assign(
      Object.create(null),
      event.data.entries,
    );
    const old = entries;
    entries = next;
    for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (old[key] === next[key]) continue;
      // A native StorageEvent rejects a proxy in storageArea; define its fields on an Event.
      const change = new Event("storage");
      Object.defineProperties(change, {
        key: { value: key },
        oldValue: { value: old[key] ?? null },
        newValue: { value: next[key] ?? null },
        storageArea: { value: proxy },
        url: { value: window.location.href },
      });
      window.dispatchEvent(change);
    }
  });
}

export function storageBootstrap(
  token: string,
  entries: StorageEntries,
  parentOrigin: string,
  available: boolean,
) {
  const args = JSON.stringify([
    STORAGE_CHANNEL,
    token,
    entries,
    parentOrigin,
    STORAGE_LIMIT,
    available,
  ])
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `(${installStorage.toString()})(...${args});`;
}
