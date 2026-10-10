import { expect, test } from "bun:test";
import {
  parseEntries,
  STORAGE_CHANNEL,
  STORAGE_LIMIT,
  saveStorageMessage,
  storageBootstrap,
  storageNamespace,
} from "../apps/web/src/lib/sandbox-storage";

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const frame = {} as Window;
  const namespace = storageNamespace("one", "alice");
  const send = (
    data: Record<string, unknown>,
    source = frame,
    origin = "null",
  ) =>
    saveStorageMessage(
      {
        source,
        origin,
        data: { channel: STORAGE_CHANNEL, token: "valid", ...data },
      },
      frame,
      "valid",
      storage,
      namespace,
    );
  return { values, storage, frame, namespace, send };
}

test("only the current sandboxed frame can write its fixed namespace", () => {
  const f = fixture();
  expect(f.send({ op: "set", key: "secret", value: "bad" }, {} as Window)).toBe(
    false,
  );
  expect(
    f.send(
      { op: "set", key: "secret", value: "bad" },
      f.frame,
      "https://example.com",
    ),
  ).toBe(false);
  expect(f.send({ op: "set", token: "old", key: "secret", value: "bad" })).toBe(
    false,
  );
  expect(f.send({ op: "read", key: "auth" })).toBe(false);
  expect(f.values.size).toBe(0);
  expect(
    f.send({ op: "set", key: "draft", value: "saved", namespace: "auth" }),
  ).toBe(true);
  expect(f.values.has("auth")).toBe(false);
  expect(JSON.parse(f.values.get(f.namespace) ?? "{}")).toEqual({
    draft: "saved",
  });
});

test("clear and remove affect only this share and viewer", () => {
  const f = fixture();
  const other = storageNamespace("two", "alice");
  f.storage.setItem(other, JSON.stringify({ other: "keep" }));
  f.send({ op: "set", key: "draft", value: "save" });
  f.send({ op: "set", key: "other", value: "save" });
  f.send({ op: "remove", key: "draft" });
  expect(JSON.parse(f.values.get(f.namespace) ?? "{}")).toEqual({
    other: "save",
  });
  f.send({ op: "clear" });
  expect(f.values.has(f.namespace)).toBe(false);
  expect(f.values.get(other)).toBe(JSON.stringify({ other: "keep" }));
  expect(storageNamespace("one", "bob")).not.toBe(f.namespace);
  expect(storageNamespace("one", null)).not.toBe(
    storageNamespace("one", "null"),
  );
});

test("malformed operations and oversized values are rejected without overwriting", () => {
  const f = fixture();
  f.send({ op: "set", key: "draft", value: "keep" });
  expect(f.send({ op: "set", key: "draft", value: { fake: true } })).toBe(
    false,
  );
  expect(() =>
    f.send({ op: "set", key: "draft", value: "x".repeat(STORAGE_LIMIT) }),
  ).toThrow();
  expect(JSON.parse(f.values.get(f.namespace) ?? "{}")).toEqual({
    draft: "keep",
  });
  expect(() => parseEntries([])).toThrow();
  expect(() => parseEntries({ key: 3 })).toThrow();
});

test("stored text cannot break out of bootstrap and prototype-named keys remain data", () => {
  const entries = parseEntries(
    JSON.parse(
      '{"__proto__":"text","draft":"</script><script>alert(1)</script>"}',
    ),
  );
  expect(Object.getPrototypeOf(entries)).toBe(null);
  expect(Reflect.get(entries, "__proto__")).toBe("text");
  const script = storageBootstrap("test", entries, "https://example.com", true);
  expect(script).not.toContain("</script>");
  expect(script).toContain("\\u003c/script>");
});
