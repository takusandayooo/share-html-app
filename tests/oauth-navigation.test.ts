import { describe, expect, test } from "bun:test";
import { oauthRedirectTarget } from "../apps/web/src/lib/oauth-navigation";

const origin = "https://share.example";
const query = new URLSearchParams({
  redirect_uri: "https://chatgpt.com/connector/oauth/callback",
  state: "request-state",
}).toString();

describe("OAuth response navigation", () => {
  test("follows the validated callback while retaining code and state", () => {
    const url =
      "https://chatgpt.com/connector/oauth/callback?code=one-time&state=request-state";
    expect(oauthRedirectTarget({ redirect: true, url }, query, origin)).toBe(
      url,
    );
  });
  test("can resume same-origin login/consent", () => {
    expect(
      oauthRedirectTarget(
        { redirect: true, url: "/oauth/consent?sig=signed" },
        query,
        origin,
      ),
    ).toBe(`${origin}/oauth/consent?sig=signed`);
  });
  test("rejects other domains, paths, protocols, and unvalidated responses", () => {
    for (const url of [
      "https://attacker.example/connector/oauth/callback",
      "https://chatgpt.com/other",
      "javascript:alert(1)",
      "http://chatgpt.com/connector/oauth/callback",
      "https://share.example/redirect?to=attacker",
    ])
      expect(() =>
        oauthRedirectTarget({ redirect: true, url }, query, origin),
      ).toThrow();
    expect(() =>
      oauthRedirectTarget(
        { redirect: false, url: "/oauth/consent" },
        query,
        origin,
      ),
    ).toThrow();
  });
});
