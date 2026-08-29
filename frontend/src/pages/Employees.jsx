import {useEffect, useMemo, useState} from 'react'
import {Link} from 'react-router-dom'
import {ArrowDown, ArrowUp, ArrowUpDown, FileUp, KeyRound, Pencil, ShieldAlert, Trash2, UserPlus} from 'lucide-react'
import {api, getError, apiPostForm} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card, ErrorBox, Loader, Modal, PageHeader, Status} from '../components/UI'

const sortableColumns = [
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

function textValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'active' : 'inactive'
  return String(value).trim().toLowerCase()
}

export default function Employees(){
  const {user} = useAuth()
  const isAdmin = ['superadmin', 'hr'].includes(user?.role)

  const [users,setUsers]=useState(null)
  const [masters,setMasters]=useState([])
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [showModal,setShowModal]=useState(false)
  const [editingUser,setEditingUser]=useState(null)
  const [importOpen,setImportOpen]=useState(false)
  const [importFile,setImportFile]=useState(null)
  const [busy,setBusy]=useState(false)
  const [autoEmail,setAutoEmail]=useState(true)
  const [sortConfig,setSortConfig]=useState({key:'department',direction:'asc'})

  const [quickAddType,setQuickAddType]=useState(null)
  const [quickAddName,setQuickAddName]=useState('')
  const [quickAddBusy,setQuickAddBusy]=useState(false)

  const [form,setForm]=useState({
    employee_no:'',name:'',email:'',password:'Admin@123',role:'employee',
    manager_id:'',division_id:'',department_id:'',designation_id:''
  })

  const loadUsers=()=>api.get('/admin/users').then(r=>setUsers(r.data)).catch(e=>setError(getError(e)))
  const loadMasters=()=>api.get('/admin/masters').then(r=>setMasters(r.data)).catch(e=>setError(getError(e)))

  useEffect(()=>{loadUsers();loadMasters()},[])

  const divisions=masters
  const departments=useMemo(()=>divisions
    .filter(d=>!form.division_id||String(d.id)===String(form.division_id))
    .flatMap(d=>d.departments.map(dep=>({...dep,division_id:d.id,division_name:d.name}))),[divisions,form.division_id])
  const designations=useMemo(()=>departments
    .filter(dep=>!form.department_id||String(dep.id)===String(form.department_id))
    .flatMap(dep=>dep.designations.map(x=>({...x,department_id:dep.id,label:`${dep.division_name} / ${dep.name} / ${x.name}`}))),[departments,form.department_id])

  const sortedUsers=useMemo(()=>{
    if(!users)return []
    const list=[...users]
    const {key,direction}=sortConfig
    const multiplier=direction==='asc'?1:-1
    return list.sort((a,b)=>{
      let av,bv
      if(key==='employee_no'){
        av=a.employee_no||a.employee_id||`EMP-${String(a.id).padStart(4,'0')}`
        bv=b.employee_no||b.employee_id||`EMP-${String(b.id).padStart(4,'0')}`
      }else{
        av=a[key]
        bv=b[key]
      }
      const aa=textValue(av),bb=textValue(bv)
      const primary=aa.localeCompare(bb,undefined,{numeric:true,sensitivity:'base'})
      if(primary!==0)return primary*multiplier
      return textValue(a.name).localeCompare(textValue(b.name))*multiplier
    })
  },[users,sortConfig])

  function toggleSort(key){
    setSortConfig(current=>current.key===key
      ? {key,direction:current.direction==='asc'?'desc':'asc'}
      : {key,direction:'asc'})
  }

  function SortIcon({column}){
    if(sortConfig.key!==column)return <ArrowUpDown size={12} style={{opacity:.55}}/>
    return sortConfig.direction==='asc'?<ArrowUp size={12}/>:<ArrowDown size={12}/>
  }

  function openAddModal(){
    setEditingUser(null)
    const nextNum=users?`EMP-${String(users.length+1).padStart(4,'0')}`:'EMP-0001'
    setForm({employee_no:nextNum,name:'',email:'',password:'Admin@123',role:'employee',manager_id:'',division_id:'',department_id:'',designation_id:''})
    setAutoEmail(true)
    setShowModal(true)
  }

  function openEditModal(u){
    setEditingUser(u)
    setForm({employee_no:u.employee_no||u.employee_id||'',name:u.name||'',email:u.email||'',password:'',role:u.role||'employee',manager_id:u.manager_id?String(u.manager_id):'',division_id:'',department_id:'',designation_id:u.designation_id?String(u.designation_id):''})
    setAutoEmail(false)
    setShowModal(true)
  }

  function handleNameChange(nameVal){
    let emailVal=form.email
    if(autoEmail&&nameVal.trim()){
      const slug=nameVal.trim().toLowerCase().replace(/[^a-z0-9]+/g,'.')
      emailVal=`${slug}@eaglesoftware.in`
    }
    setForm({...form,name:nameVal,email:emailVal})
  }

  function handleEmailChange(emailVal){setAutoEmail(false);setForm({...form,email:emailVal})}

  function generateRandomPass(){
    const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#'
    let pass=''
    for(let i=0;i<10;i++)pass+=chars.charAt(Math.floor(Math.random()*chars.length))
    setForm({...form,password:pass})
  }

  async function handleQuickAddMaster(e){
    e.preventDefault()
    if(!quickAddName.trim())return
    setQuickAddBusy(true);setError('')
    try{
      if(quickAddType==='division'){
        const {data}=await api.post('/admin/divisions',{name:quickAddName.trim()})
        await loadMasters();setForm(f=>({...f,division_id:String(data.id),department_id:'',designation_id:''}));setMessage(`Division '${data.name}' added dynamically.`)
      }else if(quickAddType==='department'){
        if(!form.division_id){setError('Select a division first before adding a new department.');return}
        const {data}=await api.post('/admin/departments',{name:quickAddName.trim(),parent_id:Number(form.division_id)})
        await loadMasters();setForm(f=>({...f,department_id:String(data.id),designation_id:''}));setMessage(`Department '${data.name}' added dynamically.`)
      }else if(quickAddType==='designation'){
        if(!form.department_id){setError('Select a department first before adding a new role/designation.');return}
        const {data}=await api.post('/admin/designations',{name:quickAddName.trim(),parent_id:Number(form.department_id)})
        await loadMasters();setForm(f=>({...f,designation_id:String(data.id)}));setMessage(`Role/Designation '${data.name}' added dynamically.`)
      }
      setQuickAddType(null);setQuickAddName('')
    }catch(e){setError(getError(e))}finally{setQuickAddBusy(false)}
  }

  async function saveEmployee(){
    if(!isAdmin){setError('Only Super Admin or HR can create or edit employee profiles.');return}
    try{
      setError('');setMessage('')
      const payload={employee_no:form.employee_no?form.employee_no.trim():null,name:form.name.trim(),email:form.email.trim(),role:form.role,manager_id:form.manager_id?Number(form.manager_id):null,designation_id:form.designation_id?Number(form.designation_id):null}
      if(form.password)payload.password=form.password
      if(editingUser){await api.patch(`/admin/users/${editingUser.id}`,payload);setMessage(`Employee '${form.name}' updated successfully.`)}
      else{await api.post('/admin/users',payload);setMessage(`Employee '${form.name}' created successfully.`)}
      setShowModal(false);setEditingUser(null);loadUsers()
    }catch(e){setError(getError(e))}
  }

  async function deleteEmployee(u){
    if(!isAdmin)return
    const empNo=u.employee_no||u.employee_id||`EMP-${u.id}`
    if(!window.confirm(`Permanently delete employee '${u.name}' (${empNo})? You can create / add them again anytime.`))return
    try{setError('');setMessage('');await api.delete(`/admin/users/${u.id}`);setMessage(`Employee '${u.name}' (${empNo}) deleted. You can re-add this employee anytime.`);loadUsers()}catch(e){setError(getError(e))}
  }

  async function toggle(u){
    if(!isAdmin)return
    try{await api.patch(`/admin/users/${u.id}`,{active:!u.active});setMessage(`Employee '${u.name}' ${u.active?'deactivated':'activated'}.`);loadUsers()}catch(e){setError(getError(e))}
  }

  async function importEmployees(){
    if(!isAdmin)return
    if(!importFile){setError('Choose an Excel or CSV file first.');return}
    setBusy(true)
    try{
      const fd=new FormData();fd.append('file',importFile);fd.append('preview','false')
      const {data}=await apiPostForm('/admin/import-employees-excel',fd)
      setMessage(`Imported ${data.created} employee(s); ${data.skipped} existing row(s) skipped.`);setImportOpen(false);setImportFile(null);loadUsers()
    }catch(e){setError(getError(e))}finally{setBusy(false)}
  }

  return <>
    <PageHeader title="Employees Directory" subtitle="View, create, manage and sort organization employee profiles and reporting lines." actions={isAdmin?(
      <div className="row-actions"><button className="secondary" onClick={()=>setImportOpen(true)}><FileUp size={16}/>Import Excel/CSV</button><button className="primary" onClick={openAddModal}><UserPlus size={16}/>Add Employee</button></div>
    ):null}/>

    {!isAdmin?<div className="helper-strip" style={{borderColor:'#3b82f6',background:'#eff6ff',color:'#1d4ed8',marginBottom:'12px'}}><ShieldAlert size={16}/> User creation and profile management is managed by HR and Super Admin. You can view and sort all employee profiles below.</div>:null}
    <div className="helper-strip" style={{marginBottom:'12px'}}>Click any column header to sort. Click the same header again to reverse the order. Current sort: <strong>{sortableColumns.find(([key])=>key===sortConfig.key)?.[1]} {sortConfig.direction==='asc'?'↑':'↓'}</strong></div>
    <ErrorBox error={error}/>{message?<div className="success-box">{message}</div>:null}

    {!users?<Loader/>:(
      <Card>
        <div className="table-wrap">
          <table>
            <thead><tr>
              {sortableColumns.map(([key,label])=><th key={key}><button type="button" onClick={()=>toggleSort(key)} style={{display:'inline-flex',alignItems:'center',gap:'5px',border:0,background:'transparent',padding:0,font:'inherit',color:'inherit',textTransform:'inherit',letterSpacing:'inherit',fontWeight:'inherit'}}>{label}<SortIcon column={key}/></button></th>)}
              {isAdmin?<th>Actions</th>:null}
            </tr></thead>
            <tbody>
              {sortedUsers.map(u=><tr key={u.id}>
                <td><strong>{u.employee_no||u.employee_id||`EMP-${String(u.id).padStart(4,'0')}`}</strong></td>
                <td><strong>{u.name}</strong></td>
                <td>{u.email}</td>
                <td><span style={{textTransform:'capitalize'}}>{u.role}</span></td>
                <td>{u.department||'—'}</td>
                <td>{u.designation||'—'}</td>
                <td><Link to="/templates"><span style={{background:'#eff6ff',color:'#1d4ed8',padding:'3px 9px',borderRadius:'6px',fontSize:'0.8rem',fontWeight:600,display:'inline-flex',border:'1px solid #bfdbfe'}}>{u.kpi_template||'General KPI Template'}</span></Link></td>
                <td>{u.manager||'—'}</td>
                <td><Status value={u.active?'active':'inactive'}/></td>
                {isAdmin?<td><div className="row-actions">
                  <button className="secondary small" title="Edit employee profile" onClick={()=>openEditModal(u)}><Pencil size={13}/>Edit</button>
                  {u.role!=='superadmin'?<button className="secondary small" onClick={()=>toggle(u)}>{u.active?'Deactivate':'Activate'}</button>:null}
                  {!u.active&&u.role!=='superadmin'?<button className="secondary small" title="Delete deactivated employee profile" onClick={()=>deleteEmployee(u)} style={{color:'#dc2626',borderColor:'#fca5a5',background:'#fef2f2'}}><Trash2 size={13}/>Delete</button>:null}
                </div></td>:null}
              </tr>)}
            </tbody>
          </table>
        </div>
      </Card>
    )}

    {showModal?<Modal title={editingUser?`Edit Employee: ${editingUser.name}`:'Add New Employee (Admin Only)'} onClose={()=>{setShowModal(false);setEditingUser(null);setQuickAddType(null)}} className="wide-modal" actions={<><button className="secondary" onClick={()=>{setShowModal(false);setEditingUser(null);setQuickAddType(null)}}>Cancel</button><button className="primary" onClick={saveEmployee}>{editingUser?'Update Employee':'Create Employee'}</button></>}>
      <p className="muted small-copy" style={{marginBottom:'16px'}}>Fill in employee details. You can add a Division, Department, or Role directly from the dropdown section when needed.</p>
      <div className="form-grid">
        <label className="span-2">Employee No / Unique ID * <span className="field-note">(Unique ID to fetch data & assign tasks)</span><input value={form.employee_no} onChange={e=>setForm({...form,employee_no:e.target.value})} placeholder="e.g. EMP-0015"/></label>
        <label className="span-2">Full Name *<input value={form.name} onChange={e=>handleNameChange(e.target.value)} placeholder="e.g. Rahul Sharma"/></label>
        <label className="span-2">Email Address * <span className="field-note">(Auto-suggested)</span><input value={form.email} onChange={e=>handleEmailChange(e.target.value)} placeholder="e.g. rahul.sharma@eaglesoftware.in"/></label>
        <label>{editingUser?'New Password (leave blank to keep current)':'Temporary Password *'}<div style={{display:'flex',gap:'6px'}}><input value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><button type="button" className="secondary icon-button" title="Generate password" onClick={generateRandomPass}><KeyRound size={14}/></button></div></label>
        <label>System Role *<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="employee">Employee</option><option value="manager">Manager</option><option value="hr">HR</option><option value="superadmin">Super Admin</option></select></label>

        <label><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span>Division Filter</span><button type="button" className="text-action" style={{padding:0,fontSize:'0.75rem'}} onClick={()=>{setQuickAddType('division');setQuickAddName('')}}>+ Add New</button></div><select value={form.division_id} onChange={e=>setForm({...form,division_id:e.target.value,department_id:'',designation_id:''})}><option value="">All Divisions</option>{divisions.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span>Department Filter</span><button type="button" className="text-action" style={{padding:0,fontSize:'0.75rem'}} onClick={()=>{setQuickAddType('department');setQuickAddName('')}}>+ Add New</button></div><select value={form.department_id} onChange={e=>setForm({...form,department_id:e.target.value,designation_id:''})}><option value="">All Departments</option>{departments.map(dep=><option key={dep.id} value={dep.id}>{dep.name}</option>)}</select></label>
        <label className="span-2"><div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span>Designation / Role Scope</span><button type="button" className="text-action" style={{padding:0,fontSize:'0.75rem'}} onClick={()=>{setQuickAddType('designation');setQuickAddName('')}}>+ Add New Role</button></div><select value={form.designation_id} onChange={e=>setForm({...form,designation_id:e.target.value})}><option value="">None / Unassigned</option>{designations.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
        <label className="span-2">Reporting Manager<select value={form.manager_id} onChange={e=>setForm({...form,manager_id:e.target.value})}><option value="">None (Top Level / Direct HR Report)</option>{(users||[]).filter(u=>!editingUser||u.id!==editingUser.id).map(u=><option key={u.id} value={u.id}>{u.name} ({u.role} · {u.department||u.designation||'Staff'})</option>)}</select></label>
      </div>
    </Modal>:null}

    {quickAddType?<Modal title={`Add New ${quickAddType.charAt(0).toUpperCase()+quickAddType.slice(1)}`} onClose={()=>setQuickAddType(null)} actions={<><button className="secondary" onClick={()=>setQuickAddType(null)}>Cancel</button><button className="primary" disabled={quickAddBusy||!quickAddName.trim()} onClick={handleQuickAddMaster}>{quickAddBusy?'Saving...':'Add to Dropdown'}</button></>}>
      <form onSubmit={handleQuickAddMaster} style={{display:'flex',flexDirection:'column',gap:'12px'}}><p className="muted small-copy" style={{margin:0}}>{quickAddType==='division'?'Enter a new division name to add to the dropdown.':quickAddType==='department'?'Enter a new department name for the selected division.':'Enter a new role / designation name for the selected department.'}</p><label>New {quickAddType.charAt(0).toUpperCase()+quickAddType.slice(1)} Name *<input autoFocus value={quickAddName} onChange={e=>setQuickAddName(e.target.value)} placeholder={quickAddType==='designation'?'e.g. Full Stack Developer':'e.g. Innovation & R&D'}/></label></form>
    </Modal>:null}

    {importOpen?<Modal title="Import Employees from File" onClose={()=>setImportOpen(false)} actions={<><button className="secondary" onClick={()=>setImportOpen(false)}>Cancel</button><button className="primary" disabled={busy} onClick={importEmployees}>{busy?'Importing...':'Import file'}</button></>}>
      <p className="muted small-copy">Upload an Excel or CSV file containing <b>Name | Email | Role | Department | Designation | Manager Email</b>.</p><div className="form-grid"><label>Employee File (.xlsx, .csv)<input type="file" accept=".xlsx,.xls,.csv" onChange={e=>setImportFile(e.target.files?.[0]||null)}/></label></div>
    </Modal>:null}
  </>
}
