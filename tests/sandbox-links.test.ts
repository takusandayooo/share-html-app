import { expect, test } from "bun:test";
import {
  linkDestination,
  linksBootstrap,
} from "../apps/web/src/lib/sandbox-links";

const page = "https://share.example/p/one";

test("fragments remain inside the displayed HTML, including copied page URLs", () => {
  for (const href of ["#section", `${page}#section`, "about:srcdoc#section"])
    expect(linkDestination(href, page)).toEqual({
      kind: "fragment",
      hash: "#section",
    });
  expect(linkDestination("", page)).toEqual({ kind: "fragment", hash: "#" });
  expect(linkDestination("#%E6%97%A5%E6%9C%AC%E8%AA%9E", page).kind).toBe(
    "fragment",
  );
});

test("web links are resolved without changing the parent page", () => {
  expect(linkDestination("https://example.com/path#section", page)).toEqual({
    kind: "external",
    url: "https://example.com/path#section",
  });
  expect(linkDestination("/shares", page)).toEqual({
    kind: "external",
    url: "https://share.example/shares",
  });
  expect(linkDestination("//example.org/", page)).toEqual({
    kind: "external",
    url: "https://example.org/",
  });
  expect(linkDestination("mailto:hello@example.com", page).kind).toBe(
    "external",
  );
  expect(linkDestination("tel:+81312345678", page).kind).toBe("external");
});

test("inline JavaScript actions stay sandboxed and other schemes cannot escape", () => {
  expect(linkDestination("javascript:void(0)", page)).toEqual({
    kind: "script",
  });
  for (const href of [
    "data:text/html,<script>alert(1)</script>",
    "file:///tmp/test",
    "blob:https://example.com/test",
    "about:blank",
    "https://[invalid",
  ])
    expect(linkDestination(href, page)).toEqual({ kind: "blocked" });
  expect(linksBootstrap(`${page}?q=</script>`)).not.toContain("</script>");
});
