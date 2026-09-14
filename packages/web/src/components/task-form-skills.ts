export function mergeTaskSkillNames(
  selectedSkills: ReadonlySet<string>,
  studentMasterSkillName: string | null,
): string[] | undefined {
  const skillNames = new Set<string>()

  if (studentMasterSkillName) {
    skillNames.add(studentMasterSkillName)
  }

  for (const skillName of selectedSkills) {
    skillNames.add(skillName)
  }

  return skillNames.size > 0 ? Array.from(skillNames) : undefined
}
