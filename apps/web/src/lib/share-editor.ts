export function editorKind(filename: string): "html" | "markdown" {
  if (
    /[\\/]/.test(filename) ||
    Array.from(filename).some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error("ファイル名が不正です。");
  if (/\.html?$/i.test(filename)) return "html";
  if (/\.(md|markdown)$/i.test(filename)) return "markdown";
  throw new Error(
    "ファイル名には .html または .md などの拡張子を付けてください。",
  );
}
export function validateEditorContent(content: string, maxBytes: number) {
  if (!content.length) throw new Error("本文を入力してください。");
  if (content.includes("\u0000"))
    throw new Error("UTF-8のテキストを指定してください。");
  if (new TextEncoder().encode(content).byteLength > maxBytes)
    throw new Error("ファイル容量が上限を超えています。");
}
export async function readReplacement(file: File, maxBytes: number) {
  editorKind(file.name);
  if (file.name.length > 200)
    throw new Error("ファイル名は200文字以内にしてください。");
  if (file.size > maxBytes)
    throw new Error("ファイル容量が上限を超えています。");
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(
      await file.arrayBuffer(),
    );
  } catch {
    throw new Error("UTF-8で保存されたHTMLまたはMarkdownを選択してください。");
  }
  validateEditorContent(content, maxBytes);
  return { filename: file.name, content };
}
