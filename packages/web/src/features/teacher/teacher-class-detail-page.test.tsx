import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherClassDetailPage } from './teacher-class-detail-page'

describe('TeacherClassDetailPage', () => {
  it('展示班级详情和下一课节入口', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/teacher/classes/creative-2a']}>
        <Routes>
          <Route path="/teacher/classes/:classId" element={<TeacherClassDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(markup).toContain('二年级创作 A 班')
    expect(markup).toContain('学生名单')
    expect(markup).toContain('课程进度')
    expect(markup).toContain('准备上课')
    expect(markup).toContain('让太空校园海报动起来')
    // 机构管理员要能在界面上设置班级共享额度（后端接口早就有，界面此前没有）
    expect(markup).toContain('班级共享额度')
    expect(markup).toContain('设置额度')
    // 任课老师同理：没有这个入口，"老师只能管自己负责的班级"在界面上落不了地
    expect(markup).toContain('任课老师')
    expect(markup).toContain('分配老师')
  })

  it('无效班级编号不渲染错误详情', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/teacher/classes/not-found']}>
        <Routes>
          <Route path="/teacher/classes/:classId" element={<TeacherClassDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(markup).toBe('')
    expect(markup).not.toContain('学生名单')
  })
})
