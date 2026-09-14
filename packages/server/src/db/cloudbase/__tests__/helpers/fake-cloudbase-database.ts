/**
 * 非事务路径的 CloudBase 假数据库。
 *
 * 只实现仓储在 `getCollection()`（根集合，**无事务**）路径上真正用到的操作：
 * `createCollection`、`collection().where().limit().skip().get()/count()/add()/update()/remove()`。
 *
 * 小宝账本的假数据库另有一套（它强制走事务、并带提交冲突与回滚模拟），两者刻意不合并：
 * 它们覆盖的是两条不同的访问路径，混在一起会让两个测试都变得难读。
 */

export type FakeDocument = Record<string, unknown>

type Matcher = { op: 'eq' | 'neq' | 'gte' | 'lte' | 'in'; value?: unknown; values?: unknown[] }

/** 对应 CloudBase 的 `db.command`：测试只需覆盖仓储实际用到的比较器。 */
export class FakeCommand {
  eq(value: unknown): Matcher {
    return { op: 'eq', value }
  }

  neq(value: unknown): Matcher {
    return { op: 'neq', value }
  }

  gte(value: unknown): Matcher {
    return { op: 'gte', value }
  }

  lte(value: unknown): Matcher {
    return { op: 'lte', value }
  }

  in(values: unknown[]): Matcher {
    return { op: 'in', values }
  }
}

function isMatcher(value: unknown): value is Matcher {
  return typeof value === 'object' && value !== null && 'op' in (value as Record<string, unknown>)
}

/**
 * 按 CloudBase 的语义匹配一条文档：普通值按相等比较，命令对象按 `db.command` 的算子比较。
 *
 * 导出给账本那套（强制走事务的）假数据库复用，避免两套假实现各自理解 `command` 而漂移。
 */
export function matchesCriteria(document: FakeDocument, criteria: FakeDocument): boolean {
  return Object.entries(criteria).every(([key, expected]) => {
    const actual = document[key]

    if (!isMatcher(expected)) return actual === expected

    if (expected.op === 'eq') return actual === expected.value
    if (expected.op === 'neq') return actual !== expected.value
    if (expected.op === 'in') return (expected.values ?? []).includes(actual)
    if (typeof actual !== 'number' || typeof expected.value !== 'number') return false
    return expected.op === 'gte' ? actual >= expected.value : actual <= expected.value
  })
}

class FakeQuery {
  protected criteria: FakeDocument = {}
  private maximum: number | undefined
  private offset: number | undefined

  constructor(
    protected readonly database: FakeCloudBaseDatabase,
    protected readonly name: string,
  ) {}

  where(criteria: FakeDocument): this {
    this.criteria = criteria
    return this
  }

  limit(maximum: number): this {
    this.maximum = maximum
    return this
  }

  skip(offset: number): this {
    this.offset = offset
    return this
  }

  async get(): Promise<{ data: FakeDocument[] }> {
    const rows = this.selected()
    const from = this.offset ?? 0
    const window = this.maximum === undefined ? rows.slice(from) : rows.slice(from, from + this.maximum)
    return { data: structuredClone(window) }
  }

  async count(): Promise<{ total: number }> {
    return { total: this.selected().length }
  }

  async update(data: FakeDocument): Promise<{ updated: number }> {
    let updated = 0
    for (const document of this.selected()) {
      Object.assign(document, structuredClone(data))
      updated += 1
    }
    return { updated }
  }

  async remove(): Promise<{ deleted: number }> {
    const all = this.database.documents(this.name)
    const kept = all.filter((document) => !matchesCriteria(document, this.criteria))
    const deleted = all.length - kept.length
    this.database.replace(this.name, kept)
    return { deleted }
  }

  private selected(): FakeDocument[] {
    return this.database.documents(this.name).filter((document) => matchesCriteria(document, this.criteria))
  }
}

class FakeCollection extends FakeQuery {
  async add(data: FakeDocument): Promise<{ id: string }> {
    const documents = this.database.documents(this.name)
    const candidate = structuredClone(data)
    const id = String(candidate._id ?? candidate.id ?? `fake-${documents.length + 1}`)

    // 与真实 CloudBase 一致：同一 _id 重复写入返回 DATABASE_DUPLICATE_WRITE。
    if (documents.some((document) => document._id === id)) {
      throw Object.assign(new Error('duplicate write'), { code: 'DATABASE_DUPLICATE_WRITE' })
    }

    documents.push({ _id: id, ...candidate })
    return { id }
  }
}

export class FakeCloudBaseDatabase {
  command = new FakeCommand()
  private readonly collections = new Map<string, FakeDocument[]>()

  async createCollection(name: string): Promise<void> {
    if (!this.collections.has(name)) this.collections.set(name, [])
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this, name)
  }

  documents(name: string): FakeDocument[] {
    let documents = this.collections.get(name)
    if (!documents) {
      documents = []
      this.collections.set(name, documents)
    }
    return documents
  }

  replace(name: string, documents: FakeDocument[]): void {
    this.collections.set(name, documents)
  }

  /** 测试断言用：读回集合内容（去掉 CloudBase 的 `_id`）。 */
  rows(name: string): FakeDocument[] {
    return this.documents(name).map(({ _id, ...document }) => structuredClone(document))
  }

  /** 测试预置用。 */
  seed(name: string, document: FakeDocument): void {
    const documents = this.documents(name)
    const id = String(document._id ?? document.id ?? `seed-${documents.length + 1}`)
    documents.push({ _id: id, ...structuredClone(document) })
  }
}
