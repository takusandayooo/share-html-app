import { mkdirSync, writeFileSync } from "node:fs";
import { oauthProvider } from "@better-auth/oauth-provider";
import { getSchema } from "better-auth/db";

const tables = getSchema({
  plugins: [
    oauthProvider({
      loginPage: "/oauth/login",
      consentPage: "/oauth/consent",
      disableJwtPlugin: true,
    }),
  ],
});
const oauthOnly = process.argv.includes("--oauth");
let source =
  '// Generated from Better Auth. Regenerate when upgrading Better Auth.\nimport { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";\n';
let migration =
  "-- Better Auth schema. Date fields use epoch milliseconds.\nPRAGMA foreign_keys = ON;\n";
for (const [name, table] of Object.entries(tables)) {
  const columns = ['"id" TEXT PRIMARY KEY NOT NULL'];
  source += `export const ${name} = sqliteTable("${name}", { id: text("id").primaryKey(),\n`;
  for (const [field, attr] of Object.entries(table.fields)) {
    const mode =
      attr.type === "date"
        ? ', { mode: "timestamp_ms" }'
        : attr.type === "boolean"
          ? ', { mode: "boolean" }'
          : "";
    const numeric = ["date", "boolean", "number"].includes(String(attr.type));
    source += `${field}: ${numeric ? "integer" : "text"}("${field}"${mode})${attr.required ? ".notNull()" : ""}${attr.unique ? ".unique()" : ""},\n`;
    columns.push(
      `"${field}" ${numeric ? "INTEGER" : "TEXT"}${attr.required ? " NOT NULL" : ""}${attr.unique ? " UNIQUE" : ""}${attr.references ? ` REFERENCES "${attr.references.model}"("${attr.references.field}") ON DELETE CASCADE` : ""}`,
    );
  }
  source += "});\n";
  if (
    oauthOnly &&
    ["user", "session", "account", "verification"].includes(name)
  )
    continue;
  migration += `CREATE TABLE "${name}" (\n${columns.join(",\n")}\n);\n`;
  for (const [field, attr] of Object.entries(table.fields))
    if (attr.index)
      migration += `CREATE INDEX "${name}_${field}_idx" ON "${name}"("${field}");\n`;
}
mkdirSync("migrations", { recursive: true });
writeFileSync("src/auth-schema.ts", source);
writeFileSync(
  oauthOnly ? "migrations/0007_oauth.sql" : "migrations/0001_auth.sql",
  migration,
);
