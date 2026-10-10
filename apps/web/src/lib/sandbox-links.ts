export type LinkDestination =
  | { kind: "fragment"; hash: string }
  | { kind: "external"; url: string }
  | { kind: "script" }
  | { kind: "blocked" };

export function linkDestination(
  href: string,
  parentUrl: string,
): LinkDestination {
  const raw = href.trim();
  if (raw === "" || raw.startsWith("#"))
    return { kind: "fragment", hash: raw || "#" };
  try {
    const url = new URL(raw, parentUrl);
    const parent = new URL(parentUrl);
    if (
      (url.origin === parent.origin &&
        url.pathname === parent.pathname &&
        url.search === parent.search &&
        url.hash) ||
      (url.protocol === "about:" && url.pathname === "srcdoc" && url.hash)
    )
      return { kind: "fragment", hash: url.hash };
    // Existing inline JavaScript links remain inside the sandbox.
    if (url.protocol === "javascript:") return { kind: "script" };
    if (["http:", "https:", "mailto:", "tel:"].includes(url.protocol))
      return { kind: "external", url: url.href };
  } catch {
    /* Invalid destinations are not navigated. */
  }
  return { kind: "blocked" };
}

// Serialized into srcDoc: keep all dependencies explicit.
function installLinks(classify: typeof linkDestination, parentUrl: string) {
  const follow = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      (event.type === "click" ? event.button !== 0 : event.button !== 1)
    )
      return;
    const target = event.target;
    const element =
      target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;
    const anchor = element?.closest("a[href],area[href]");
    if (!anchor) return;
    const destination = classify(anchor.getAttribute("href") ?? "", parentUrl);
    if (destination.kind === "script") return;
    event.preventDefault();
    if (destination.kind === "fragment") {
      // location.hash resolves against about:srcdoc, unlike a relative href.
      window.location.hash = destination.hash;
      let name = destination.hash.slice(1);
      try {
        name = decodeURIComponent(name);
      } catch {
        /* Use the literal ID. */
      }
      const section =
        document.getElementById(name) ??
        Array.from(document.getElementsByName(name)).find(
          (item) => item.tagName === "A",
        );
      if (section) section.scrollIntoView();
      else if (!name || name.toLowerCase() === "top") window.scrollTo(0, 0);
      return;
    }
    if (destination.kind === "external" && event.isTrusted) {
      // A fresh tab avoids frame-embedding restrictions on destination sites.
      window.open(destination.url, "_blank", "noopener,noreferrer");
    }
  };
  // Bubble so uploaded handlers can preventDefault for tabs, menus, and dialogs.
  document.addEventListener("click", follow);
  document.addEventListener("auxclick", follow);
}

export function linksBootstrap(parentUrl: string) {
  const argument = JSON.stringify(parentUrl).replace(/</g, "\\u003c");
  return `(${installLinks.toString()})(${linkDestination.toString()},${argument});`;
}
