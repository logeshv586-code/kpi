import {useEffect, useMemo, useState} from 'react'
import {ArrowDown, ArrowUp, ArrowUpDown, Download, FileUp, KeyRound, Pencil, ShieldAlert, Trash2, UserPlus} from 'lucide-react'
import {Link} from 'react-router-dom'
import {api, downloadApiFile, getError} from '../lib/api'
import {canAccessTab, useAuth} from '../lib/auth'
import {Card, ErrorBox, Loader, Modal, PageHeader, Status} from '../components/UI'

const columns = [
  ['employee_no', 'Employee ID'],
  ['name', 'Name'],
  ['email', 'Email'],
  ['role', 'Role'],
  ['department', 'Department'],
  ['designation', 'Designation'],
  ['kpi_template', 'Assigned KPI Template'],
  ['manager', 'Reports to'],
  ['active', 'Status']
]
const text = v => v == null ? '' : typeof v === 'boolean' ? (v ? 'active' : 'inactive') : String(v).trim().toLowerCase()

const DEFAULT_SYSTEM_ROLES = [
  {id: 'employee', name: 'Employee'},
  {id: 'manager', name: 'Manager'},
  {id: 'hr', name: 'HR'},
  {id: 'superadmin', name: 'Super Admin'}
]

export default function EmployeesV2() {
  const {user} = useAuth()
  const isAdmin = canAccessTab(user, 'employees', true)
  const isSuperAdmin = user?.role === 'superadmin'

  const [users, setUsers] = useState(null)
  const [masters, setMasters] = useState([])
  const [templates, setTemplates] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [autoEmail, setAutoEmail] = useState(true)
  const [sort, setSort] = useState({key: 'department', direction: 'asc'})

  // Custom system roles stored in localStorage
  const [customRoles, setCustomRoles] = useState(() => {
    try {
      const saved = localStorage.getItem('kpi_custom_system_roles')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  // Quick Add Modal States: null | 'system_role' | 'department' | 'designation' | 'manager'
  const [quickModal, setQuickModal] = useState(null)
  const [quickForm, setQuickForm] = useState({name: '', email: '', department_id: '', role: 'manager'})

  const [form, setForm] = useState({
    employee_no: '',
    name: '',
    email: '',
    password: 'Admin@123',
    role: 'employee',
    manager_id: '',
    department_id: '',
    designation_id: '',
    kpi_template_id: '',
    access_permissions: {tabs: [], editable_tabs: []}
  })

  const loadUsers = () => api.get('/admin/users').then(r => setUsers(r.data)).catch(e => setError(getError(e)))
  const loadMasters = () => api.get('/admin/masters').then(r => setMasters(r.data)).catch(e => setError(getError(e)))
  const loadTemplates = () => api.get('/kpi/templates').then(r => setTemplates(r.data)).catch(e => setError(getError(e)))

  useEffect(() => {
    loadUsers()
    if (isAdmin) {
      loadMasters()
      loadTemplates()
    }
  }, [])

  const allSystemRoles = useMemo(() => {
    const combined = [...DEFAULT_SYSTEM_ROLES]
    customRoles.forEach(cr => {
      if (!combined.some(r => r.id === cr.id)) {
        combined.push(cr)
      }
    })
    return combined
  }, [customRoles])

  const departments = useMemo(
    () => masters.flatMap(parent => parent.departments.map(dep => ({...dep, parent_id: parent.id}))).sort((a, b) => a.name.localeCompare(b.name)),
    [masters]
  )
  const selectedDepartment = departments.find(d => String(d.id) === String(form.department_id))
  const designations = selectedDepartment ? (selectedDepartment.designations || []) : masters.flatMap(p => p.departments.flatMap(d => d.designations || []))
  const assignableTemplates = useMemo(() => templates.filter(t => t.status === 'active' && t.validation?.publishable), [templates])

  const sortedUsers = useMemo(() => {
    if (!users) return []
    const mult = sort.direction === 'asc' ? 1 : -1
    return [...users].sort((a, b) => {
      const val = u => sort.key === 'employee_no' ? (u.employee_no || u.employee_id || `EMP-${String(u.id).padStart(4, '0')}`) : u[sort.key]
      const c = text(val(a)).localeCompare(text(val(b)), undefined, {numeric: true, sensitivity: 'base'})
      return c ? c * mult : text(a.name).localeCompare(text(b.name)) * mult
    })
  }, [users, sort])

  function toggleSort(key) {
    setSort(s => s.key === key ? {key, direction: s.direction === 'asc' ? 'desc' : 'asc'} : {key, direction: 'asc'})
  }

  function SortIcon({column}) {
    if (sort.key !== column) return <ArrowUpDown size={12} style={{opacity: 0.5}} />
    return sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
  }

  function openAdd() {
    const next = users ? `EMP-${String(users.length + 1).padStart(4, '0')}` : 'EMP-0001'
    setEditing(null)
    setForm({
      employee_no: next,
      name: '',
      email: '',
      password: 'Admin@123',
      role: 'employee',
      manager_id: '',
      department_id: '',
      designation_id: '',
      kpi_template_id: '',
      access_permissions: {tabs: [], editable_tabs: []}
    })
    setAutoEmail(true)
    setShowModal(true)
  }

  function openEdit(u) {
    const dep = departments.find(d => d.designations?.some(x => String(x.id) === String(u.designation_id)))
    setEditing(u)
    setForm({
      employee_no: u.employee_no || u.employee_id || '',
      name: u.name || '',
      email: u.email || '',
      password: '',
      role: u.role || 'employee',
      manager_id: u.manager_id ? String(u.manager_id) : '',
      department_id: dep ? String(dep.id) : '',
      designation_id: u.designation_id ? String(u.designation_id) : '',
      kpi_template_id: u.kpi_template_id ? String(u.kpi_template_id) : '',
      access_permissions: {
        tabs: u.access_permissions?.tabs || [],
        editable_tabs: u.access_permissions?.editable_tabs || []
      }
    })
    setAutoEmail(false)
    setShowModal(true)
  }

  function nameChange(name) {
    let email = form.email
    if (autoEmail && name.trim()) email = `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.')}@eaglesoftware.in`
    setForm({...form, name, email})
  }

  function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#'
    let pass = ''
    for (let i = 0; i < 10; i++) pass += chars[Math.floor(Math.random() * chars.length)]
    setForm({...form, password: pass})
  }

  async function saveEmployee() {
    try {
      setError('')
      setMessage('')
      if (!form.name.trim() || !form.email.trim()) throw new Error('Name and email are required.')
      if (form.department_id && !form.designation_id) {
        throw new Error('Choose a designation for the selected department so the employee can be mapped correctly.')
      }
      const payload = {
        employee_no: form.employee_no.trim() || null,
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        manager_id: form.manager_id ? Number(form.manager_id) : null,
        designation_id: form.designation_id ? Number(form.designation_id) : null,
        kpi_template_id: form.kpi_template_id ? Number(form.kpi_template_id) : null
      }
      if (isSuperAdmin) payload.access_permissions = form.access_permissions
      if (form.password) payload.password = form.password
      if (editing) {
        await api.patch(`/admin/users/${editing.id}`, payload)
        setMessage(`Employee '${form.name}' updated.`)
      } else {
        await api.post('/admin/users', payload)
        setMessage(`Employee '${form.name}' created.`)
      }
      setShowModal(false)
      setEditing(null)
      loadUsers()
    } catch (e) {
      setError(getError(e))
    }
  }

  async function toggle(u) {
    try {
      await api.patch(`/admin/users/${u.id}`, {active: !u.active})
      loadUsers()
    } catch (e) {
      setError(getError(e))
    }
  }

  function togglePermission(tab, edit = false) {
    setForm(current => {
      const key = edit ? 'editable_tabs' : 'tabs'
      const existing = new Set(current.access_permissions?.[key] || [])
      existing.has(tab) ? existing.delete(tab) : existing.add(tab)
      const next = {...current.access_permissions, [key]: [...existing]}
      if (edit && !next.tabs?.includes(tab)) next.tabs = [...(next.tabs || []), tab]
      return {...current, access_permissions: next}
    })
  }

  async function remove(u) {
    if (!window.confirm(`Delete '${u.name}'?`)) return
    try {
      await api.delete(`/admin/users/${u.id}`)
      loadUsers()
    } catch (e) {
      setError(getError(e))
    }
  }

  // Quick Add Handlers for Dropdown Sections
  function openQuickModal(type) {
    setQuickForm({
      name: '',
      email: '',
      department_id: form.department_id || (departments[0]?.id ? String(departments[0].id) : ''),
      role: 'manager'
    })
    setQuickModal(type)
  }

  async function saveQuickAdd() {
    try {
      setError('')
      if (quickModal === 'system_role') {
        const title = quickForm.name.trim()
        if (!title) return
        const roleId = title.toLowerCase().replace(/[^a-z0-9]+/g, '_')
        const newRole = {id: roleId, name: title}
        const updated = [...customRoles, newRole]
        setCustomRoles(updated)
        try {
          localStorage.setItem('kpi_custom_system_roles', JSON.stringify(updated))
        } catch (e) {
          console.warn('LocalStorage error:', e)
        }
        setForm(f => ({...f, role: roleId}))
        setMessage(`Added new System Role '${title}'`)
      } else if (quickModal === 'department') {
        const depName = quickForm.name.trim()
        if (!depName) return
        const parentId = masters[0]?.id || null
        const {data} = await api.post('/admin/departments', {name: depName, parent_id: parentId})
        await loadMasters()
        setForm(f => ({...f, department_id: String(data.id), designation_id: ''}))
        setMessage(`Added new Department '${depName}'`)
      } else if (quickModal === 'designation') {
        const desigName = quickForm.name.trim()
        if (!desigName) return
        const targetDepId = quickForm.department_id || form.department_id || (departments[0]?.id ? String(departments[0].id) : null)
        const {data} = await api.post('/admin/designations', {name: desigName, parent_id: targetDepId ? Number(targetDepId) : null})
        await loadMasters()
        setForm(f => ({...f, department_id: targetDepId ? String(targetDepId) : f.department_id, designation_id: String(data.id)}))
        setMessage(`Added new Designation/Role '${desigName}'`)
      } else if (quickModal === 'manager') {
        const mgrName = quickForm.name.trim()
        const mgrEmail = quickForm.email.trim() || `${mgrName.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@eaglesoftware.in`
        if (!mgrName) return
        const nextEmpNo = users ? `EMP-${String(users.length + 100).padStart(4, '0')}` : 'EMP-0100'
        const {data} = await api.post('/admin/users', {
          employee_no: nextEmpNo,
          name: mgrName,
          email: mgrEmail,
          password: 'Admin@123',
          role: quickForm.role || 'manager',
          designation_id: form.designation_id ? Number(form.designation_id) : null
        })
        await loadUsers()
        setForm(f => ({...f, manager_id: String(data.id)}))
        setMessage(`Added new Manager '${mgrName}'`)
      }
      setQuickModal(null)
    } catch (e) {
      setError(getError(e))
    }
  }

  async function downloadEmployeeSample() {
    try {
      await downloadApiFile('/admin/samples/employees', 'Employee_Import_Sample.xlsx')
    } catch (e) {
      setError(getError(e))
    }
  }

  async function importEmployees() {
    if (!importFile) {
      setError('Choose an Excel or CSV file first.')
      return
    }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', importFile)
      fd.append('preview', 'false')
      const {data} = await api.post('/admin/import-employees-excel-v2', fd, {headers: {'Content-Type': 'multipart/form-data'}})
      setMessage(`Imported ${data.created} employee(s); ${data.skipped} skipped.`)
      setImportOpen(false)
      setImportFile(null)
      loadUsers()
    } catch (e) {
      setError(getError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Employees Directory"
        subtitle="Department-based employee directory. Click any column heading to sort."
        actions={
          isAdmin ? (
            <div className="row-actions">
              <button className="secondary" onClick={() => setImportOpen(true)}>
                <FileUp size={16} />
                Import Excel/CSV
              </button>
              <button className="primary" onClick={openAdd}>
                <UserPlus size={16} />
                Add Employee
              </button>
            </div>
          ) : null
        }
      />
      {!isAdmin ? (
        <div className="helper-strip" style={{marginBottom: '12px'}}>
          <ShieldAlert size={16} /> You have view-only access to the employee directory.
        </div>
      ) : null}
      <ErrorBox error={error} />
      {message ? <div className="success-box">{message}</div> : null}
      {!users ? (
        <Loader />
      ) : (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {columns.map(([key, label]) => (
                    <th key={key}>
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        style={{
                          border: 0,
                          background: 'transparent',
                          padding: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          font: 'inherit',
                          color: 'inherit',
                          textTransform: 'inherit'
                        }}
                      >
                        {label}
                        <SortIcon column={key} />
                      </button>
                    </th>
                  ))}
                  {isAdmin ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map(u => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.employee_no || u.employee_id || `EMP-${String(u.id).padStart(4, '0')}`}</strong>
                    </td>
                    <td>
                      <strong>{u.name}</strong>
                    </td>
                    <td>{u.email}</td>
                    <td style={{textTransform: 'capitalize'}}>{u.role}</td>
                    <td>{u.department || '—'}</td>
                    <td>{u.designation || '—'}</td>
                    <td>
                      {u.role === 'superadmin' ? (
                        <span className="muted">Not required</span>
                      ) : (
                        <Link to="/templates">
                          <span style={{background: '#eff6ff', color: '#1d4ed8', padding: '3px 9px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600}}>
                            {u.kpi_template || 'Automatic template'}
                          </span>
                        </Link>
                      )}
                    </td>
                    <td>{u.manager || '—'}</td>
                    <td>
                      <Status value={u.active ? 'active' : 'inactive'} />
                    </td>
                    {isAdmin ? (
                      <td>
                        <div className="row-actions">
                          <button className="secondary small" onClick={() => openEdit(u)}>
                            <Pencil size={13} />
                            Edit
                          </button>
                          {u.role !== 'superadmin' ? (
                            <button className="secondary small" onClick={() => toggle(u)}>
                              {u.active ? 'Deactivate' : 'Activate'}
                            </button>
                          ) : null}
                          {!u.active && u.role !== 'superadmin' ? (
                            <button className="secondary small" style={{color: '#dc2626'}} onClick={() => remove(u)}>
                              <Trash2 size={13} />
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showModal ? (
        <Modal
          title={editing ? `Edit Employee: ${editing.name}` : 'Add Employee'}
          onClose={() => setShowModal(false)}
          className="wide-modal"
          actions={
            <>
              <button className="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button className="primary" onClick={saveEmployee}>
                {editing ? 'Update Employee' : 'Create Employee'}
              </button>
            </>
          }
        >
          <div className="form-grid">
            <label className="span-2">
              Employee No / Unique ID
              <input value={form.employee_no} onChange={e => setForm({...form, employee_no: e.target.value})} />
            </label>
            <label className="span-2">
              Full Name *
              <input value={form.name} onChange={e => nameChange(e.target.value)} />
            </label>
            <label className="span-2">
              Email *
              <input
                value={form.email}
                onChange={e => {
                  setAutoEmail(false)
                  setForm({...form, email: e.target.value})
                }}
              />
            </label>
            <label>
              {editing ? 'New Password (optional)' : 'Temporary Password'}
              <div style={{display: 'flex', gap: '6px'}}>
                <input value={form.password} onChange={e => setForm({...form, password: e.target.value})} />
                <button type="button" className="secondary icon-button" onClick={generatePassword}>
                  <KeyRound size={14} />
                </button>
              </div>
            </label>

            {/* Dropdown 1: System Role */}
            <label>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <span>System Role</span>
                {isSuperAdmin ? <button type="button" className="text-action" style={{padding: 0, fontSize: '0.8rem'}} onClick={() => openQuickModal('system_role')}>
                  + Add System Role
                </button> : null}
              </div>
              <select value={form.role} disabled={!isSuperAdmin} onChange={e => setForm({...form, role: e.target.value})}>
                {allSystemRoles.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Dropdown 2: Department */}
            <label className="span-2">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <span>Department</span>
                <button type="button" className="text-action" style={{padding: 0, fontSize: '0.8rem'}} onClick={() => openQuickModal('department')}>
                  + Add Department
                </button>
              </div>
              <select
                value={form.department_id}
                onChange={e => setForm({...form, department_id: e.target.value, designation_id: ''})}
              >
                <option value="">Select department</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Dropdown 3: Designation / Role */}
            <label className="span-2">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <span>Designation / Role</span>
                <button type="button" className="text-action" style={{padding: 0, fontSize: '0.8rem'}} onClick={() => openQuickModal('designation')}>
                  + Add Designation / Role
                </button>
              </div>
              <select
                value={form.designation_id}
                onChange={e => setForm({...form, designation_id: e.target.value})}
              >
                <option value="">Select designation</option>
                {designations.map(x => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>

            {form.role !== 'superadmin' ? (
              <label className="span-2">
                KPI Template
                <select
                  value={form.kpi_template_id}
                  onChange={e => setForm({...form, kpi_template_id: e.target.value})}
                >
                  <option value="">Use automatic department/designation template</option>
                  {assignableTemplates.map(template => (
                    <option key={template.id} value={template.id}>
                      {template.name}{template.department ? ` · ${template.department}` : ''}{template.designation ? ` · ${template.designation}` : ''}
                    </option>
                  ))}
                </select>
                <span className="cell-help">Assign an active template directly to this employee. It is immediately added to each open KPI cycle for the employee to complete.</span>
              </label>
            ) : null}

            {isSuperAdmin && form.role !== 'superadmin' ? (
              <div className="span-2" style={{border: '1px solid #dbe4f0', borderRadius: '8px', padding: '14px'}}>
                <strong style={{display: 'block', marginBottom: '4px'}}>Sidebar & edit permissions</strong>
                <span className="cell-help" style={{display: 'block', marginBottom: '10px'}}>All users already have KPI Input, Reports, and permission to fill their own KPI form. Choose additional sidebar tabs and editing rights for this user.</span>
                {[
                  ['employees', 'Employees Directory'],
                  ['templates', 'KPI Templates']
                ].map(([tab, label]) => {
                  const visible = form.access_permissions?.tabs?.includes(tab)
                  const editable = form.access_permissions?.editable_tabs?.includes(tab)
                  return <div key={tab} style={{display: 'flex', alignItems: 'center', gap: '18px', padding: '6px 0'}}>
                    <label style={{display: 'flex', alignItems: 'center', gap: '7px', margin: 0, fontWeight: 600}}><input type="checkbox" checked={visible} onChange={() => togglePermission(tab)}/>{label}</label>
                    <label style={{display: 'flex', alignItems: 'center', gap: '7px', margin: 0}}><input type="checkbox" checked={editable} onChange={() => togglePermission(tab, true)}/>Allow editing</label>
                  </div>
                })}
              </div>
            ) : null}

            {/* Dropdown 4: Reporting Manager */}
            <label className="span-2">
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <span>Reporting Manager</span>
                {isSuperAdmin ? <button type="button" className="text-action" style={{padding: 0, fontSize: '0.8rem'}} onClick={() => openQuickModal('manager')}>
                  + Add Manager
                </button> : null}
              </div>
              <select value={form.manager_id} onChange={e => setForm({...form, manager_id: e.target.value})}>
                <option value="">None</option>
                {(users || [])
                  .filter(u => !editing || u.id !== editing.id)
                  .map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.department || u.role})
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </Modal>
      ) : null}

      {/* Quick Add Modals for all Dropdown sections */}
      {quickModal ? (
        <Modal
          title={
            quickModal === 'system_role'
              ? 'Add System Role'
              : quickModal === 'department'
              ? 'Add Department'
              : quickModal === 'designation'
              ? 'Add Designation / Role'
              : 'Add Reporting Manager'
          }
          onClose={() => setQuickModal(null)}
          actions={
            <>
              <button className="secondary" onClick={() => setQuickModal(null)}>
                Cancel
              </button>
              <button className="primary" onClick={saveQuickAdd} disabled={!quickForm.name.trim()}>
                Add {quickModal === 'system_role' ? 'System Role' : quickModal === 'department' ? 'Department' : quickModal === 'designation' ? 'Designation' : 'Manager'}
              </button>
            </>
          }
        >
          <div style={{display: 'flex', flexDirection: 'column', gap: '12px'}}>
            <label>
              {quickModal === 'system_role'
                ? 'System Role Name *'
                : quickModal === 'department'
                ? 'Department Name *'
                : quickModal === 'designation'
                ? 'Designation / Role Title *'
                : 'Manager Full Name *'}
              <input
                autoFocus
                value={quickForm.name}
                onChange={e => setQuickForm({...quickForm, name: e.target.value})}
                placeholder={
                  quickModal === 'system_role'
                    ? 'e.g. Lead Auditor'
                    : quickModal === 'department'
                    ? 'e.g. Quality Assurance'
                    : quickModal === 'designation'
                    ? 'e.g. Senior Tech Lead'
                    : 'e.g. Rajesh Kumar'
                }
              />
            </label>

            {quickModal === 'designation' ? (
              <label>
                Department
                <select
                  value={quickForm.department_id}
                  onChange={e => setQuickForm({...quickForm, department_id: e.target.value})}
                >
                  <option value="">Default Department</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {quickModal === 'manager' ? (
              <>
                <label>
                  Manager Email (Optional)
                  <input
                    value={quickForm.email}
                    onChange={e => setQuickForm({...quickForm, email: e.target.value})}
                    placeholder="e.g. rajesh.kumar@eaglesoftware.in"
                  />
                </label>
                <label>
                  Role Type
                  <select
                    value={quickForm.role}
                    onChange={e => setQuickForm({...quickForm, role: e.target.value})}
                  >
                    <option value="manager">Manager</option>
                    <option value="hr">HR</option>
                    <option value="superadmin">Super Admin</option>
                    <option value="employee">Employee</option>
                  </select>
                </label>
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {importOpen ? (
        <Modal
          title="Import Employees"
          onClose={() => setImportOpen(false)}
          actions={
            <>
              <button className="secondary" onClick={() => setImportOpen(false)}>
                Cancel
              </button>
              <button className="primary" disabled={busy} onClick={importEmployees}>
                {busy ? 'Importing...' : 'Import file'}
              </button>
            </>
          }
        >
          <p className="muted small-copy">
            Use the same headings as the Add Employee screen: Employee No / Unique ID, Full Name, Email, Temporary Password, System Role,
            Department, Designation / Role and Reporting Manager Email.
          </p>
          <button type="button" className="secondary" onClick={downloadEmployeeSample} style={{marginBottom: '12px'}}>
            <Download size={16} />
            Download current Employee Excel format
          </button>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={e => setImportFile(e.target.files?.[0] || null)} />
        </Modal>
      ) : null}
    </>
  )
}
