import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Isolate every server test from any real `data/app.db` left in the working tree.
// The Drizzle client opens its database file at module load (side effect), so the
// path must be redirected before any test module imports the db layer.
if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'xiaobao-server-tests-')), 'test.db')
}
