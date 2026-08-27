import {useEffect, useMemo, useState} from 'react'
import {Link} from 'react-router-dom'
import {FileUp, KeyRound, Plus, ShieldAlert, UserPlus} from 'lucide-react'
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

  // Dynamic Master Quick Add State
  const [quickAddType, setQuickAddType] = useState(null) // 'division' | 'department' | 'designation'
  const [quickAddName, setQuickAddName] = useState('')
  const [quickAddBusy, setQuickAddBusy] = useState(false)

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

  const loadUsers=()=>api.get('/admin/users').then(r=>setUsers(r.data)).catch(e=>setError(getError(e)))
  const loadMasters=()=>api.get('/admin/masters').then(r=>setMasters(r.data)).catch(e=>setError(getError(e)))

  useEffect(()=>{
    loadUsers()
    loadMasters()
  },[])

  const divisions = masters
  const departments = useMemo(()=>
    divisions.filter(d=>!form.division_id || String(d.id)===String(form.division_id))
      .flatMap(d=>d.departments.map(dep=>({...dep, division_id:d.id, division_name:d.name}))),
    [divisions, form.division_id]
  )
  const designations = useMemo(()=>
    departments.filter(dep=>!form.department_id || String(dep.id)===String(form.department_id))
      .flatMap(dep=>dep.designations.map(x=>({...x, department_id:dep.id, label:`${dep.division_name} / ${dep.name} / ${x.name}`}))),
    [departments, form.department_id]
  )

  function handleNameChange(nameVal) {
    let emailVal = form.email
    if (autoEmail && nameVal.trim()) {
      const slug = nameVal.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.')
      emailVal = `${slug}@eaglesoftware.in`
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

  async function handleQuickAddMaster(e) {
    e.preventDefault()
    if (!quickAddName.trim()) return
    setQuickAddBusy(true)
    setError('')
    try {
      if (quickAddType === 'division') {
        const {data} = await api.post('/admin/divisions', { name: quickAddName.trim() })
        await loadMasters()
        setForm(f => ({...f, division_id: String(data.id), department_id: '', designation_id: ''}))
        setMessage(`Division '${data.name}' added dynamically.`)
      } else if (quickAddType === 'department') {
        if (!form.division_id) {
          setError('Select a division first before adding a new department.')
          setQuickAddBusy(false)
          return
        }
        const {data} = await api.post('/admin/departments', { name: quickAddName.trim(), parent_id: Number(form.division_id) })
        await loadMasters()
        setForm(f => ({...f, department_id: String(data.id), designation_id: ''}))
        setMessage(`Department '${data.name}' added dynamically.`)
      } else if (quickAddType === 'designation') {
        if (!form.department_id) {
          setError('Select a department first before adding a new role/designation.')
          setQuickAddBusy(false)
          return
        }
        const {data} = await api.post('/admin/designations', { name: quickAddName.trim(), parent_id: Number(form.department_id) })
        await loadMasters()
        setForm(f => ({...f, designation_id: String(data.id)}))
        setMessage(`Role/Designation '${data.name}' added dynamically.`)
      }
      setQuickAddType(null)
      setQuickAddName('')
    } catch (e) {
      setError(getError(e))
    } finally {
      setQuickAddBusy(false)
    }
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
      loadUsers()
    }catch(e){
      setError(getError(e))
    }
  }

  async function toggle(u){
    if (!isAdmin) return
    try{
      await api.patch(`/admin/users/${u.id}`,{active:!u.active})
      loadUsers()
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
      loadUsers()
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
      <div className="helper-strip" style={{borderColor:'#3b82f6',background:'#eff6ff',color:'#1d4ed8',marginBottom:'12px'}}>
        <ShieldAlert size={16}/> Note: User creation and profile management is managed by HR and Super Admin. You can view all employee profiles and their assigned KPI templates below.
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
                <th>Assigned KPI Template</th>
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
                  <td>
                    <Link to="/templates" style={{textDecoration:'none'}}>
                      <span style={{background:'#eff6ff',color:'#1d4ed8',padding:'3px 9px',borderRadius:'6px',fontSize:'0.8rem',fontWeight:600,display:'inline-flex',alignItems:'center',gap:'4px',border:'1px solid #bfdbfe'}}>
                        {u.kpi_template || 'General KPI Template'}
                      </span>
                    </Link>
                  </td>
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
        onClose={()=>{setShowModal(false); setQuickAddType(null)}}
        className="wide-modal"
        actions={
          <>
            <button className="secondary" onClick={()=>{setShowModal(false); setQuickAddType(null)}}>Cancel</button>
            <button className="primary" onClick={create}>Create Employee</button>
          </>
        }
      >
        <p className="muted small-copy" style={{marginBottom:'16px'}}>
          Fill in employee details. Dynamically add new Division, Department, or Role directly in dropdowns if needed.
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
              placeholder="e.g. rahul.sharma@eaglesoftware.in"
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

          {/* Division Selector with Dynamic Add */}
          <label>
            <div style={{display:'flex',justify:'space-between',alignItems:'center'}}>
              <span>Division Filter</span>
              <button type="button" className="text-action" style={{padding:0,fontSize:'0.75rem'}} onClick={()=>{setQuickAddType('division'); setQuickAddName('')}}>
                + Add New
              </button>
            </div>
            <select value={form.division_id} onChange={e => setForm({...form, division_id: e.target.value, department_id: '', designation_id: ''})}>
              <option value="">All Divisions</option>
              {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>

          {/* Department Selector with Dynamic Add */}
          <label>
            <div style={{display:'flex',justify:'space-between',alignItems:'center'}}>
              <span>Department Filter</span>
              <button type="button" className="text-action" style={{padding:0,fontSize:'0.75rem'}} onClick={()=>{setQuickAddType('department'); setQuickAddName('')}}>
                + Add New
              </button>
            </div>
            <select value={form.department_id} onChange={e => setForm({...form, department_id: e.target.value, designation_id: ''})}>
              <option value="">All Departments</option>
              {departments.map(dep => <option key={dep.id} value={dep.id}>{dep.name}</option>)}
            </select>
          </label>

          {/* Designation Selector with Dynamic Add */}
          <label className="span-2">
            <div style={{display:'flex',justify:'space-between',alignItems:'center'}}>
              <span>Designation / Role Scope (e.g. Developer, Lead)</span>
              <button type="button" className="text-action" style={{padding:0,fontSize:'0.75rem'}} onClick={()=>{setQuickAddType('designation'); setQuickAddName('')}}>
                + Add New Role
              </button>
            </div>
            <select value={form.designation_id} onChange={e => setForm({...form, designation_id: e.target.value})}>
              <option value="">None / Unassigned</option>
              {designations.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>

          {/* Reporting Manager Selector */}
          <label className="span-2">
            Reporting Manager
            <select value={form.manager_id} onChange={e => setForm({...form, manager_id: e.target.value})}>
              <option value="">None (Top Level / Direct HR Report)</option>
              {(users || []).map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.role} · {u.department || u.designation || 'Staff'})</option>
              ))}
            </select>
          </label>
        </div>
      </Modal>
    ) : null}

    {/* Dynamic Quick Add Master Sub-Modal */}
    {quickAddType ? (
      <Modal 
        title={`Add New ${quickAddType.charAt(0).toUpperCase() + quickAddType.slice(1)}`}
        onClose={()=>setQuickAddType(null)}
        actions={
          <>
            <button className="secondary" onClick={()=>setQuickAddType(null)}>Cancel</button>
            <button className="primary" disabled={quickAddBusy || !quickAddName.trim()} onClick={handleQuickAddMaster}>
              {quickAddBusy ? 'Saving...' : 'Add to Dropdown'}
            </button>
          </>
        }
      >
        <form onSubmit={handleQuickAddMaster} style={{display:'flex',flexDirection:'column',gap:'12px'}}>
          <p className="muted small-copy" style={{margin:0}}>
            {quickAddType === 'division' ? 'Enter a new division name to add to the dropdown.' : null}
            {quickAddType === 'department' ? 'Enter a new department name for the selected division.' : null}
            {quickAddType === 'designation' ? 'Enter a new role / designation name (e.g. Developer, Senior Developer, Lead) for the selected department.' : null}
          </p>
          <label>
            New {quickAddType.charAt(0).toUpperCase() + quickAddType.slice(1)} Name *
            <input 
              autoFocus
              value={quickAddName}
              onChange={e => setQuickAddName(e.target.value)}
              placeholder={quickAddType === 'designation' ? 'e.g. Full Stack Developer' : 'e.g. Innovation & R&D'}
            />
          </label>
        </form>
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
