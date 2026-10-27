import { describe, expect, test } from "bun:test";
import {
  editorKind,
  readReplacement,
  validateEditorContent,
} from "../apps/web/src/lib/share-editor";

describe("Browser share editor", () => {
  test("imports UTF-8 HTML and Markdown without changing the source", async () => {
    for (const filename of [
      "report.HTML",
      "report.htm",
      "report.md",
      "report.markdown",
    ]) {
      const content = "# 日本語\r\n<script>alert('preview')</script>";
      expect(
        await readReplacement(new File([content], filename), 1024),
      ).toEqual({ filename, content });
    }
    expect(editorKind("report.HTML")).toBe("html");
    expect(editorKind("report.MD")).toBe("markdown");
  });
  test("rejects wrong file types and paths before replacing the draft", async () => {
    for (const filename of [
      "bad.exe",
      "../report.html",
      "folder\\report.md",
      "bad\n.html",
      `${"a".repeat(200)}.html`,
    ])
      await expect(
        readReplacement(new File(["ok"], filename), 1024),
      ).rejects.toThrow();
  });
  test("rejects invalid UTF-8, empty files, NUL and excessive bytes", async () => {
    for (const file of [
      new File([new Uint8Array([0xff, 0xfe, 0x80])], "bad.md"),
      new File([], "empty.md"),
      new File(["a\0b"], "bad.html"),
      new File(["ああ"], "large.md"),
    ])
      await expect(readReplacement(file, 5)).rejects.toThrow();
    expect(() => validateEditorContent("ああ", 5)).toThrow();
    expect(() => validateEditorContent("あ", 3)).not.toThrow();
  });
});
