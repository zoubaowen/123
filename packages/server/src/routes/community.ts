import { Hono } from 'hono'
import { getDb } from '../db/index.js'
import { requireAuth, type AppEnv } from '../middleware/auth'
import { nanoid } from 'nanoid'

const app = new Hono<AppEnv>()

app.get('/works', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1', 10)
    const pageSize = parseInt(c.req.query('pageSize') || '20', 10)
    const tag = c.req.query('tag')
    const sort = c.req.query('sort') || 'newest'

    const db = getDb()
    const allWorks = await db.communityWorks.findAll(10000, 0)

    let filtered = allWorks
    if (tag) {
      filtered = allWorks.filter((w) => {
        try {
          const tags: string[] = JSON.parse(w.tags || '[]')
          return tags.some((t) => t.toLowerCase() === tag.toLowerCase())
        } catch {
          return false
        }
      })
    }

    if (sort === 'likes') {
      filtered.sort((a, b) => b.likeCount - a.likeCount)
    } else if (sort === 'hot') {
      filtered.sort((a, b) => b.likeCount - a.likeCount)
    } else {
      filtered.sort((a, b) => b.createdAt - a.createdAt)
    }

    const total = filtered.length
    const offset = (page - 1) * pageSize
    const works = filtered.slice(offset, offset + pageSize)

    return c.json({
      success: true,
      works,
      total,
      page,
      pageSize,
    })
  } catch (error) {
    console.error('[Community] Error fetching works:')
    return c.json({ error: 'Failed to fetch works' }, 500)
  }
})

app.get('/works/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const db = getDb()
    const work = await db.communityWorks.findById(id)
    if (!work) {
      return c.json({ error: 'Work not found' }, 404)
    }
    return c.json({ success: true, work })
  } catch (error) {
    console.error('[Community] Error fetching work:')
    return c.json({ error: 'Failed to fetch work' }, 500)
  }
})

app.post('/works', async (c) => {
  try {
    const authErr = requireAuth(c)
    if (authErr) return authErr
    const session = c.get('session')!
    const user = session.user

    const body = await c.req.json()
    const { title, description, previewUrl, tags, fileUrls } = body as {
      title: string
      description: string
      previewUrl?: string
      tags?: string[]
      fileUrls?: string[]
    }

    if (!title || !title.trim()) {
      return c.json({ error: 'Title is required' }, 400)
    }

    const db = getDb()
    const work = await db.communityWorks.create({
      id: nanoid(),
      userId: user.id,
      userName: user.name || user.username || '匿名用户',
      title: title.trim(),
      description: (description || '').trim(),
      previewUrl: previewUrl || null,
      tags: JSON.stringify(tags || []),
      fileUrls: JSON.stringify(fileUrls || []),
      likeCount: 0,
      likedBy: JSON.stringify([]),
    })

    return c.json({ success: true, work })
  } catch (error) {
    console.error('[Community] Error creating work:')
    return c.json({ error: 'Failed to create work' }, 500)
  }
})

app.patch('/works/:id', async (c) => {
  try {
    const authErr = requireAuth(c)
    if (authErr) return authErr
    const session = c.get('session')!
    const user = session.user
    const id = c.req.param('id')

    const body = await c.req.json()
    const updateData: Record<string, unknown> = {}

    if (body.title !== undefined) updateData.title = body.title
    if (body.description !== undefined) updateData.description = body.description
    if (body.previewUrl !== undefined) updateData.previewUrl = body.previewUrl
    if (body.tags !== undefined) updateData.tags = JSON.stringify(body.tags)
    if (body.fileUrls !== undefined) updateData.fileUrls = JSON.stringify(body.fileUrls)

    const db = getDb()
    const work = await db.communityWorks.update(id, user.id, updateData)
    if (!work) {
      return c.json({ error: 'Work not found' }, 404)
    }
    return c.json({ success: true, work })
  } catch (error) {
    console.error('[Community] Error updating work:')
    return c.json({ error: 'Failed to update work' }, 500)
  }
})

app.delete('/works/:id', async (c) => {
  try {
    const authErr = requireAuth(c)
    if (authErr) return authErr
    const session = c.get('session')!
    const user = session.user
    const id = c.req.param('id')

    const db = getDb()
    await db.communityWorks.delete(id, user.id)
    return c.json({ success: true })
  } catch (error) {
    console.error('[Community] Error deleting work:')
    return c.json({ error: 'Failed to delete work' }, 500)
  }
})

app.post('/works/:id/like', async (c) => {
  try {
    const authErr = requireAuth(c)
    if (authErr) return authErr
    const session = c.get('session')!
    const user = session.user
    const id = c.req.param('id')

    const db = getDb()
    const work = await db.communityWorks.findById(id)
    if (!work) {
      return c.json({ error: 'Work not found' }, 404)
    }

    let likedBy: string[]
    try {
      likedBy = JSON.parse(work.likedBy || '[]')
    } catch {
      likedBy = []
    }

    const alreadyLiked = likedBy.includes(user.id)
    if (alreadyLiked) {
      likedBy = likedBy.filter((uid) => uid !== user.id)
    } else {
      likedBy.push(user.id)
    }

    await db.communityWorks.update(id, work.userId, {
      likeCount: Math.max(0, work.likeCount + (alreadyLiked ? -1 : 1)),
      likedBy: JSON.stringify(likedBy),
    })

    return c.json({
      success: true,
      liked: !alreadyLiked,
      likeCount: Math.max(0, work.likeCount + (alreadyLiked ? -1 : 1)),
      likedBy: JSON.stringify(likedBy),
    })
  } catch (error) {
    console.error('[Community] Error liking work:')
    return c.json({ error: 'Failed to toggle like' }, 500)
  }
})

export default app
