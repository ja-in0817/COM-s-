import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
export function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(new URL("../../drizzle/", import.meta.url))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    sqlite.exec(
      readFileSync(new URL("../../drizzle/" + name, import.meta.url), "utf8"),
    );
  const wrap = (sql, args = []) => ({
    sql,
    args,
    bind(...a) {
      return wrap(sql, a);
    },
    async first() {
      return sqlite.prepare(sql).get(...args) ?? null;
    },
    async all() {
      return { results: sqlite.prepare(sql).all(...args) };
    },
    async run() {
      const r = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare: wrap,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (const s of statements) {
          const r = sqlite.prepare(s.sql).run(...s.args);
          result.push({ meta: { changes: Number(r.changes) } });
        }
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    close() {
      sqlite.close();
    },
    raw: sqlite,
  };
}
