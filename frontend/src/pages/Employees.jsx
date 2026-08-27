import {useEffect, useMemo, useState} from 'react'
import {FileUp, KeyRound, Plus, UserPlus, ShieldAlert} from 'lucide-react'
import {api, getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card, ErrorBox, Loader, Modal, PageHeader, Status} from '../components/UI'

export default function Employees(){
  const {user} = useAuth()
  const isAdmin = ['superadmin', 'hr'].includes(user?.role)

  const [users,setUsers]=useState(null)
  const [masters,setMasters]=useState([])
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [showModal,setShowModal]=useState(false)
  const [importOpen,setImportOpen]=useState(false)
  const [importFile,setImportFile]=useState(null)
  const [busy,setBusy]=useState(false)
  const [autoEmail,setAutoEmail]=useState(true)

  const [form,setForm]=useState({
    name:'',
    email:'',
    password:'Admin@123',
    role:'employee',
    manager_id:'',
    division_id:'',
    department_id:'',
    designation_id:''
  })

  const load=()=>api.get('/admin/users').then(r=>setUsers(r.data)).catch(e=>setError(getError(e)))
  useEffect(()=>{
    load()
    api.get('/admin/masters').then(r=>setMasters(r.data)).catch(e=>setError(getError(e)))
  },[])

  const divisions = masters
  const departments = useMemo(()=>
    divisions.filter(d=>!form.division_id || String(d.id)===String(form.division_id))
      .flatMap(d=>d.departments.map(dep=>({...dep, division_name:d.name}))),
    [divisions, form.division_id]
  )
  const designations = useMemo(()=>
    departments.filter(dep=>!form.department_id || String(dep.id)===String(form.department_id))
      .flatMap(dep=>dep.designations.map(x=>({...x, label:`${dep.division_name} / ${dep.name} / ${x.name}`}))),
    [departments, form.department_id]
  )

  function handleNameChange(nameVal) {
    let emailVal = form.email
    if (autoEmail && nameVal.trim()) {
      const slug = nameVal.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.')
      emailVal = `${slug}@kpi.local`
    }
    setForm({...form, name:nameVal, email:emailVal})
  }

  function handleEmailChange(emailVal) {
    setAutoEmail(false)
    setForm({...form, email:emailVal})
  }

  function generateRandomPass() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#'
    let pass = ''
    for (let i=0; i<10; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length))
    setForm({...form, password: pass})
  }

  async function create(){
    if (!isAdmin) {
      setError('Only Super Admin or HR can create new employees.')
      return
    }
    try{
      setError('')
      setMessage('')
      await api.post('/admin/users',{
        ...form,
        manager_id: form.manager_id ? Number(form.manager_id) : null,
        designation_id: form.designation_id ? Number(form.designation_id) : null
      })
      setMessage(`Employee '${form.name}' created successfully.`)
      setShowModal(false)
      setForm({name:'',email:'',password:'Admin@123',role:'employee',manager_id:'',division_id:'',department_id:'',designation_id:''})
      setAutoEmail(true)
      load()
    }catch(e){
      setError(getError(e))
    }
  }

  async function toggle(u){
    if (!isAdmin) return
    try{
      await api.patch(`/admin/users/${u.id}`,{active:!u.active})
      load()
    }catch(e){
      setError(getError(e))
    }
  }

  async function importEmployees(){
    if (!isAdmin) return
    if(!importFile){setError('Choose an Excel or CSV file first.');return}
    setBusy(true)
    try{
      const fd=new FormData()
      fd.append('file',importFile)
      fd.append('preview','false')
      const {data}=await api.post('/admin/import-employees-excel',fd,{headers:{'Content-Type':'multipart/form-data'}})
      setMessage(`Imported ${data.created} employee(s); ${data.skipped} existing row(s) skipped.`)
      setImportOpen(false)
      setImportFile(null)
      load()
    }catch(e){
      setError(getError(e))
    }finally{
      setBusy(false)
    }
  }

  return <>
    <PageHeader 
      title="Employees Directory" 
      subtitle="View, create, and manage organization employee profiles and reporting lines." 
      actions={isAdmin ? (
        <div className="row-actions">
          <button className="secondary" onClick={()=>setImportOpen(true)}>
            <FileUp size={16}/>Import Excel/CSV
          </button>
          <button className="primary" onClick={()=>setShowModal(true)}>
            <UserPlus size={16}/>Add Employee
          </button>
        </div>
      ) : null}
    />

    {!isAdmin ? (
      <div className="helper-strip" style={{borderColor:'#f59e0b',background:'#fffbeb',color:'#b45309'}}>
        <ShieldAlert size={16}/> Access restricted: User creation and employee management is restricted to Super Admin and HR roles only.
      </div>
    ) : null}

    <ErrorBox error={error}/>
    {message ? <div className="success-box">{message}</div> : null}

    {!users ? <Loader/> : (
      <Card>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Reports to</th>
                <th>Status</th>
                {isAdmin ? <th>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td><strong>{u.employee_id || `EMP-${String(u.id).padStart(4,'0')}`}</strong></td>
                  <td><strong>{u.name}</strong></td>
                  <td>{u.email}</td>
                  <td><span style={{textTransform:'capitalize'}}>{u.role}</span></td>
                  <td>{u.department || '—'}</td>
                  <td>{u.designation || '—'}</td>
                  <td>{u.manager || '—'}</td>
                  <td><Status value={u.active ? 'active' : 'inactive'}/></td>
                  {isAdmin ? (
                    <td>
                      {u.role !== 'superadmin' ? (
                        <button className="secondary small" onClick={()=>toggle(u)}>
                          {u.active ? 'Deactivate' : 'Activate'}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    )}

    {/* Easy Add Employee Modal */}
    {showModal ? (
      <Modal 
        title="Add New Employee (Admin Only)" 
        onClose={()=>setShowModal(false)}
        className="wide-modal"
        actions={
          <>
            <button className="secondary" onClick={()=>setShowModal(false)}>Cancel</button>
            <button className="primary" onClick={create}>Create Employee</button>
          </>
        }
      >
        <p className="muted small-copy" style={{marginBottom:'16px'}}>
          Fill in employee details. Email auto-generates as you type the full name. Select hierarchy for automatic designation matching.
        </p>
        <div className="form-grid">
          <label className="span-2">
            Full Name *
            <input 
              value={form.name} 
              onChange={e => handleNameChange(e.target.value)} 
              placeholder="e.g. Rahul Sharma"
            />
          </label>

          <label className="span-2">
            Email Address * <span className="field-note">(Auto-suggested)</span>
            <input 
              value={form.email} 
              onChange={e => handleEmailChange(e.target.value)} 
              placeholder="e.g. rahul.sharma@kpi.local"
            />
          </label>

          <label>
            Temporary Password *
            <div style={{display:'flex',gap:'6px'}}>
              <input 
                value={form.password} 
                onChange={e => setForm({...form, password: e.target.value})} 
              />
              <button type="button" className="secondary icon-button" title="Generate password" onClick={generateRandomPass}>
                <KeyRound size={14}/>
              </button>
            </div>
          </label>

          <label>
            System Role *
            <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
              <option value="hr">HR</option>
              <option value="superadmin">Super Admin</option>
            </select>
          </label>

          <label>
            Division Filter
            <select value={form.division_id} onChange={e => setForm({...form, division_id: e.target.value, department_id: '', designation_id: ''})}>
              <option value="">All Divisions</option>
              {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>

          <label>
            Department Filter
            <select value={form.department_id} onChange={e => setForm({...form, department_id: e.target.value, designation_id: ''})}>
              <option value="">All Departments</option>
              {departments.map(dep => <option key={dep.id} value={dep.id}>{dep.name}</option>)}
            </select>
          </label>

          <label className="span-2">
            Designation / Role Scope
            <select value={form.designation_id} onChange={e => setForm({...form, designation_id: e.target.value})}>
              <option value="">None / Unassigned</option>
              {designations.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>

          <label className="span-2">
            Reporting Manager
            <select value={form.manager_id} onChange={e => setForm({...form, manager_id: e.target.value})}>
              <option value="">None (Top Level / Direct HR Report)</option>
              {(users || []).filter(u => ['manager', 'hr', 'superadmin'].includes(u.role)).map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
          </label>
        </div>
      </Modal>
    ) : null}

    {/* Import Modal */}
    {importOpen ? (
      <Modal 
        title="Import Employees from File" 
        onClose={()=>setImportOpen(false)} 
        actions={
          <>
            <button className="secondary" onClick={()=>setImportOpen(false)}>Cancel</button>
            <button className="primary" disabled={busy} onClick={importEmployees}>{busy ? 'Importing...' : 'Import file'}</button>
          </>
        }
      >
        <p className="muted small-copy">
          Upload an Excel or CSV file containing <b>Name | Email | Role | Department | Designation | Manager Email</b>.
        </p>
        <div className="form-grid">
          <label>Employee File (.xlsx, .csv)<input type="file" accept=".xlsx,.xls,.csv" onChange={e=>setImportFile(e.target.files?.[0]||null)}/></label>
        </div>
      </Modal>
    ) : null}
  </>
}
