import { useCallback, useEffect, useState } from 'react'
import { Building2, Plus, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '../../lib/api'

/** 与后端 `parseInstitutionName` 同口径：去空白后 1–80 个字符。 */
const INSTITUTION_NAME_MAX_LENGTH = 80

export const INSTITUTION_LOAD_FAILED = '机构列表读取失败，请稍后重试'
export const INSTITUTION_NAME_REQUIRED = '请填写机构名称'
export const INSTITUTION_NAME_TOO_LONG = '机构名称不能超过 80 个字'
export const INSTITUTION_SAVE_FAILED = '保存失败，请稍后重试'
export const MEMBER_ACCOUNT_NOT_FOUND = '没有找到这个账号'
export const MEMBER_LOOKUP_FAILED = '按账号查找失败，请稍后再试'
export const MEMBER_ALREADY_JOINED = '该用户已经是这个机构的成员'

type InstitutionRole = 'owner' | 'admin' | 'teacher'

interface Institution {
  id: string
  name: string
  status: string
}

interface InstitutionMember {
  id: string
  institutionId: string
  userId: string
  role: InstitutionRole
  status: string
}

const roleLabels: Record<InstitutionRole, string> = {
  owner: '机构负责人',
  admin: '机构管理员',
  teacher: '机构老师',
}

export function validateInstitutionName(value: string): string | null {
  const name = value.trim()
  if (name === '') return INSTITUTION_NAME_REQUIRED
  if (name.length > INSTITUTION_NAME_MAX_LENGTH) return INSTITUTION_NAME_TOO_LONG
  return null
}

export function AdminInstitutionsPage() {
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [membersFor, setMembersFor] = useState<Institution | null>(null)
  const [members, setMembers] = useState<InstitutionMember[]>([])
  const [account, setAccount] = useState('')
  const [role, setRole] = useState<InstitutionRole>('teacher')
  const [memberError, setMemberError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const payload = (await api.get('/api/admin/institutions')) as { institutions?: Institution[] }
      setInstitutions(payload?.institutions ?? [])
      setLoadFailed(false)
    } catch {
      // 读不出来就说读不出来：显示空列表会被读成"平台里没有机构"
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function submitCreate() {
    const invalid = validateInstitutionName(name)
    if (invalid !== null) {
      setNameError(invalid)
      return
    }

    setNameError(null)
    setSaving(true)
    try {
      await api.post('/api/admin/institutions', { name: name.trim() })
      setCreateOpen(false)
      setName('')
      toast.success('机构已创建')
      await load()
    } catch {
      toast.error(INSTITUTION_SAVE_FAILED)
    } finally {
      setSaving(false)
    }
  }

  async function openMembers(institution: Institution) {
    setMembersFor(institution)
    setMembers([])
    setAccount('')
    setRole('teacher')
    setMemberError(null)
    await loadMembers(institution)
  }

  /** 只重新拉名单，**不动错误提示**：失败后要重新拉取（避免停在"看起来改好了"的状态），
   *  但刚写下的错误文案必须留着，否则用户看不到失败原因。 */
  async function loadMembers(institution: Institution) {
    try {
      const payload = (await api.get(`/api/admin/institutions/${institution.id}/members`)) as {
        members?: InstitutionMember[]
      }
      setMembers(payload?.members ?? [])
    } catch {
      setMemberError(INSTITUTION_LOAD_FAILED)
    }
  }

  async function changeMemberRole(member: InstitutionMember, role: InstitutionRole) {
    if (!membersFor) return
    setMemberError(null)
    try {
      await api.patch(`/api/admin/institutions/${membersFor.id}/members/${member.userId}`, { role })
      toast.success('角色已更新')
      await loadMembers(membersFor)
    } catch {
      setMemberError(INSTITUTION_SAVE_FAILED)
      await loadMembers(membersFor)
    }
  }

  async function removeMember(member: InstitutionMember) {
    if (!membersFor) return
    setMemberError(null)
    try {
      await api.delete(`/api/admin/institutions/${membersFor.id}/members/${member.userId}`)
      toast.success('成员已移出机构')
      await loadMembers(membersFor)
    } catch {
      setMemberError(INSTITUTION_SAVE_FAILED)
      await loadMembers(membersFor)
    }
  }

  async function addMember() {
    if (!membersFor) return
    const username = account.trim()
    if (username === '') {
      setMemberError(MEMBER_ACCOUNT_NOT_FOUND)
      return
    }

    setMemberError(null)
    let userId: string
    try {
      const payload = (await api.get(`/api/admin/users/lookup?username=${encodeURIComponent(username)}`)) as {
        user?: { id: string }
      }
      if (!payload?.user?.id) {
        setMemberError(MEMBER_ACCOUNT_NOT_FOUND)
        return
      }
      userId = payload.user.id
    } catch (error) {
      // 查不到账号与查不动是两回事：前者让管理员核对账号，后者让他稍后再试
      const status = (error as { status?: number } | undefined)?.status
      setMemberError(status === 404 ? MEMBER_ACCOUNT_NOT_FOUND : MEMBER_LOOKUP_FAILED)
      return
    }

    try {
      await api.post(`/api/admin/institutions/${membersFor.id}/members`, { userId, role })
      toast.success('成员已加入机构')
      setAccount('')
      await openMembers(membersFor)
    } catch (error) {
      const status = (error as { status?: number } | undefined)?.status
      setMemberError(status === 409 ? MEMBER_ALREADY_JOINED : INSTITUTION_SAVE_FAILED)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">机构管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            机构由平台运维创建；老师与学生由机构管理员在教师端维护，这里负责把账号加入机构。
          </p>
        </div>
        <Button className="h-10 rounded-xl" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          新建机构
        </Button>
      </div>

      {loadFailed ? (
        <p className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">
          {INSTITUTION_LOAD_FAILED}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black text-slate-500">
              <tr>
                <th className="px-5 py-3">机构</th>
                <th className="px-5 py-3">状态</th>
                <th className="px-5 py-3 text-right">成员</th>
              </tr>
            </thead>
            <tbody>
              {institutions.map((institution) => (
                <tr key={institution.id} className="border-t border-slate-100">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2 font-bold text-slate-800">
                      <Building2 className="h-4 w-4 text-slate-400" />
                      {institution.name}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-xs font-black text-slate-500">
                    {institution.status === 'archived' ? '已归档' : '在用'}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-xl"
                      aria-label={`成员 ${institution.name}`}
                      onClick={() => void openMembers(institution)}
                    >
                      <Users className="mr-1.5 h-3.5 w-3.5" />
                      成员
                    </Button>
                  </td>
                </tr>
              ))}
              {institutions.length === 0 && (
                <tr>
                  <td className="px-5 py-6 text-center text-xs text-slate-500" colSpan={3}>
                    平台里还没有机构，点右上角"新建机构"开始。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          if (!next) {
            setName('')
            setNameError(null)
          }
          setCreateOpen(next)
        }}
      >
        <DialogContent className="rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900">新建机构</DialogTitle>
            <DialogDescription>机构是老师、班级与课包的归属单位；建好后可以把账号加入机构。</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="institution-name" className="text-xs font-black text-slate-700">
              机构名称
            </Label>
            <Input
              id="institution-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：示例校区"
              className="mt-2"
            />
            {nameError && <p className="mt-2 text-xs font-bold text-red-600">{nameError}</p>}
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <Button variant="outline" disabled={saving} onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button disabled={saving} onClick={() => void submitCreate()}>
              创建机构
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={membersFor !== null} onOpenChange={(next) => !next && setMembersFor(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900">{membersFor?.name ?? ''} 的成员</DialogTitle>
            <DialogDescription>按账号把用户加入机构，并指定机构角色。</DialogDescription>
          </DialogHeader>

          <ul className="space-y-2">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 px-3 py-2"
              >
                <span className="text-sm font-bold text-slate-800">{member.userId}</span>
                <div className="flex items-center gap-2">
                  <select
                    aria-label={`成员角色 ${member.userId}`}
                    value={member.role}
                    onChange={(event) => void changeMemberRole(member, event.target.value as InstitutionRole)}
                    className="h-9 rounded-xl border border-slate-200 px-2 text-xs font-bold"
                  >
                    {(['teacher', 'admin', 'owner'] as const).map((option) => (
                      <option key={option} value={option}>
                        {roleLabels[option]}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-500 hover:text-red-600"
                    aria-label={`移除 ${member.userId}`}
                    onClick={() => void removeMember(member)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
            {members.length === 0 && (
              <li className="rounded-2xl bg-slate-50 px-3 py-4 text-xs text-slate-500">这个机构还没有成员。</li>
            )}
          </ul>

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div>
              <Label htmlFor="member-account" className="text-xs font-black text-slate-700">
                账号
              </Label>
              <Input
                id="member-account"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="老师或学生的登录账号"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="member-role" className="text-xs font-black text-slate-700">
                机构角色
              </Label>
              <select
                id="member-role"
                value={role}
                onChange={(event) => setRole(event.target.value as InstitutionRole)}
                className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
              >
                {(['teacher', 'admin', 'owner'] as const).map((option) => (
                  <option key={option} value={option}>
                    {roleLabels[option]}
                  </option>
                ))}
              </select>
            </div>
            {memberError && <p className="text-xs font-bold text-red-600">{memberError}</p>}
            <div className="flex justify-end">
              <Button onClick={() => void addMember()}>加入机构</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
