export function compareText(a, b) {
  return String(a || '').localeCompare(String(b || ''), undefined, {sensitivity: 'base'})
}

export function assignmentDepartment(item) {
  return item?.department || 'Unassigned department'
}

export function assignmentMonth(item) {
  return item?.month || item?.cycle || ''
}

export function sortAssignments(items = []) {
  return [...(items || [])].sort((a, b) =>
    compareText(assignmentDepartment(a), assignmentDepartment(b)) ||
    compareText(assignmentMonth(b), assignmentMonth(a)) ||
    compareText(a?.employee, b?.employee) ||
    compareText(a?.template?.name, b?.template?.name) ||
    Number(a?.id || 0) - Number(b?.id || 0)
  )
}

export function sortUsers(items = []) {
  return [...(items || [])].sort((a, b) =>
    compareText(a?.department, b?.department) ||
    compareText(a?.name, b?.name) ||
    compareText(a?.designation, b?.designation)
  )
}

