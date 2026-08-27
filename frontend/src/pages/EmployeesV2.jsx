import {useEffect,useMemo,useState} from 'react'
import {ArrowDown,ArrowUp,ArrowUpDown,Download,FileUp,KeyRound,Pencil,ShieldAlert,Trash2,UserPlus} from 'lucide-react'
import {Link} from 'react-router-dom'
import {api,downloadApiFile,getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card,ErrorBox,Loader,Modal,PageHeader,Status} from '../components/UI'

const columns=[['employee_no','Employee ID'],['name','Name'],['email','Email'],['role','Role'],['department','Department'],['designation','Designation'],['kpi_template','Assigned KPI Template'],['manager','Reports to'],['active','Status']]
const text=v=>v==null?'':typeof v==='boolean'?(v?'active':'inactive'):String(v).trim().toLowerCase()

export default function EmployeesV2(){
  const{user}=useAuth(),isAdmin=['superadmin','hr'].includes(user?.role)
  const[users,setUsers]=useState(null),[masters,setMasters]=useState([]),[error,setError]=useState(''),[message,setMessage]=useState('')
  const[showModal,setShowModal]=useState(false),[editing,setEditing]=useState(null),[importOpen,setImportOpen]=useState(false),[importFile,setImportFile]=useState(null),[busy,setBusy]=useState(false),[autoEmail,setAutoEmail]=useState(true)
  const[sort,setSort]=useState({key:'department',direction:'asc'}),[quickRoleOpen,setQuickRoleOpen]=useState(false),[quickRole,setQuickRole]=useState('')
  const[form,setForm]=useState({employee_no:'',name:'',email:'',password:'Admin@123',role:'employee',manager_id:'',department_id:'',designation_id:''})

  const loadUsers=()=>api.get('/admin/users').then(r=>setUsers(r.data)).catch(e=>setError(getError(e)))
  const loadMasters=()=>api.get('/admin/masters').then(r=>setMasters(r.data)).catch(e=>setError(getError(e)))
  useEffect(()=>{loadUsers();loadMasters()},[])

  const departments=useMemo(()=>masters.flatMap(parent=>parent.departments.map(dep=>({...dep,parent_id:parent.id}))).sort((a,b)=>a.name.localeCompare(b.name)),[masters])
  const selectedDepartment=departments.find(d=>String(d.id)===String(form.department_id))
  const designations=selectedDepartment?.designations||[]

  const sortedUsers=useMemo(()=>{
    if(!users)return[]
    const mult=sort.direction==='asc'?1:-1
    return[...users].sort((a,b)=>{
      const val=u=>sort.key==='employee_no'?(u.employee_no||u.employee_id||`EMP-${String(u.id).padStart(4,'0')}`):u[sort.key]
      const c=text(val(a)).localeCompare(text(val(b)),undefined,{numeric:true,sensitivity:'base'})
      return c?c*mult:text(a.name).localeCompare(text(b.name))*mult
    })
  },[users,sort])

  function toggleSort(key){setSort(s=>s.key===key?{key,direction:s.direction==='asc'?'desc':'asc'}:{key,direction:'asc'})}
  function SortIcon({column}){if(sort.key!==column)return<ArrowUpDown size={12} style={{opacity:.5}}/>;return sort.direction==='asc'?<ArrowUp size={12}/>:<ArrowDown size={12}/>}

  function openAdd(){const next=users?`EMP-${String(users.length+1).padStart(4,'0')}`:'EMP-0001';setEditing(null);setForm({employee_no:next,name:'',email:'',password:'Admin@123',role:'employee',manager_id:'',department_id:'',designation_id:''});setAutoEmail(true);setShowModal(true)}
  function openEdit(u){
    const dep=departments.find(d=>d.designations?.some(x=>String(x.id)===String(u.designation_id)))
    setEditing(u);setForm({employee_no:u.employee_no||u.employee_id||'',name:u.name||'',email:u.email||'',password:'',role:u.role||'employee',manager_id:u.manager_id?String(u.manager_id):'',department_id:dep?String(dep.id):'',designation_id:u.designation_id?String(u.designation_id):''});setAutoEmail(false);setShowModal(true)
  }
  function nameChange(name){let email=form.email;if(autoEmail&&name.trim())email=`${name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'.')}@eaglesoftware.in`;setForm({...form,name,email})}
  function generatePassword(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#';let pass='';for(let i=0;i<10;i++)pass+=chars[Math.floor(Math.random()*chars.length)];setForm({...form,password:pass})}

  async function saveEmployee(){
    try{
      setError('');setMessage('')
      if(!form.name.trim()||!form.email.trim())throw new Error('Name and email are required.')
      if(form.department_id&&!form.designation_id)throw new Error('Choose a designation for the selected department so the employee can be mapped correctly.')
      const payload={employee_no:form.employee_no.trim()||null,name:form.name.trim(),email:form.email.trim(),role:form.role,manager_id:form.manager_id?Number(form.manager_id):null,designation_id:form.designation_id?Number(form.designation_id):null}
      if(form.password)payload.password=form.password
      if(editing){await api.patch(`/admin/users/${editing.id}`,payload);setMessage(`Employee '${form.name}' updated.`)}else{await api.post('/admin/users',payload);setMessage(`Employee '${form.name}' created.`)}
      setShowModal(false);setEditing(null);loadUsers()
    }catch(e){setError(getError(e))}
  }
  async function toggle(u){try{await api.patch(`/admin/users/${u.id}`,{active:!u.active});loadUsers()}catch(e){setError(getError(e))}}
  async function remove(u){if(!window.confirm(`Delete '${u.name}'?`))return;try{await api.delete(`/admin/users/${u.id}`);loadUsers()}catch(e){setError(getError(e))}}
  async function addRole(){
    if(!form.department_id||!quickRole.trim())return
    try{const{data}=await api.post('/admin/designations',{name:quickRole.trim(),parent_id:Number(form.department_id)});await loadMasters();setForm(f=>({...f,designation_id:String(data.id)}));setQuickRole('');setQuickRoleOpen(false)}catch(e){setError(getError(e))}
  }
  async function downloadEmployeeSample(){try{await downloadApiFile('/admin/samples/employees','Employee_Import_Sample.xlsx')}catch(e){setError(getError(e))}}
  async function importEmployees(){
    if(!importFile){setError('Choose an Excel or CSV file first.');return}
    setBusy(true)
    try{const fd=new FormData();fd.append('file',importFile);fd.append('preview','false');const{data}=await api.post('/admin/import-employees-excel-v2',fd,{headers:{'Content-Type':'multipart/form-data'}});setMessage(`Imported ${data.created} employee(s); ${data.skipped} skipped.`);setImportOpen(false);setImportFile(null);loadUsers()}catch(e){setError(getError(e))}finally{setBusy(false)}
  }

  return<>
    <PageHeader title="Employees Directory" subtitle="Department-based employee directory. Click any column heading to sort." actions={isAdmin?<div className="row-actions"><button className="secondary" onClick={()=>setImportOpen(true)}><FileUp size={16}/>Import Excel/CSV</button><button className="primary" onClick={openAdd}><UserPlus size={16}/>Add Employee</button></div>:null}/>
    {!isAdmin?<div className="helper-strip" style={{marginBottom:'12px'}}><ShieldAlert size={16}/> HR and Super Admin manage employee profiles. All users can sort the directory.</div>:null}
    <ErrorBox error={error}/>{message?<div className="success-box">{message}</div>:null}
    {!users?<Loader/>:<Card><div className="table-wrap"><table><thead><tr>{columns.map(([key,label])=><th key={key}><button type="button" onClick={()=>toggleSort(key)} style={{border:0,background:'transparent',padding:0,display:'inline-flex',alignItems:'center',gap:'5px',font:'inherit',color:'inherit',textTransform:'inherit'}}>{label}<SortIcon column={key}/></button></th>)}{isAdmin?<th>Actions</th>:null}</tr></thead><tbody>{sortedUsers.map(u=><tr key={u.id}><td><strong>{u.employee_no||u.employee_id||`EMP-${String(u.id).padStart(4,'0')}`}</strong></td><td><strong>{u.name}</strong></td><td>{u.email}</td><td style={{textTransform:'capitalize'}}>{u.role}</td><td>{u.department||'—'}</td><td>{u.designation||'—'}</td><td><Link to="/templates"><span style={{background:'#eff6ff',color:'#1d4ed8',padding:'3px 9px',borderRadius:'6px',fontSize:'0.8rem',fontWeight:600}}>{u.kpi_template||'General KPI Template'}</span></Link></td><td>{u.manager||'—'}</td><td><Status value={u.active?'active':'inactive'}/></td>{isAdmin?<td><div className="row-actions"><button className="secondary small" onClick={()=>openEdit(u)}><Pencil size={13}/>Edit</button>{u.role!=='superadmin'?<button className="secondary small" onClick={()=>toggle(u)}>{u.active?'Deactivate':'Activate'}</button>:null}{!u.active&&u.role!=='superadmin'?<button className="secondary small" style={{color:'#dc2626'}} onClick={()=>remove(u)}><Trash2 size={13}/>Delete</button>:null}</div></td>:null}</tr>)}</tbody></table></div></Card>}

    {showModal?<Modal title={editing?`Edit Employee: ${editing.name}`:'Add Employee'} onClose={()=>setShowModal(false)} className="wide-modal" actions={<><button className="secondary" onClick={()=>setShowModal(false)}>Cancel</button><button className="primary" onClick={saveEmployee}>{editing?'Update Employee':'Create Employee'}</button></>}><div className="form-grid"><label className="span-2">Employee No / Unique ID<input value={form.employee_no} onChange={e=>setForm({...form,employee_no:e.target.value})}/></label><label className="span-2">Full Name *<input value={form.name} onChange={e=>nameChange(e.target.value)}/></label><label className="span-2">Email *<input value={form.email} onChange={e=>{setAutoEmail(false);setForm({...form,email:e.target.value})}}/></label><label>{editing?'New Password (optional)':'Temporary Password'}<div style={{display:'flex',gap:'6px'}}><input value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><button type="button" className="secondary icon-button" onClick={generatePassword}><KeyRound size={14}/></button></div></label><label>System Role<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="employee">Employee</option><option value="manager">Manager</option><option value="hr">HR</option><option value="superadmin">Super Admin</option></select></label><label className="span-2">Department<select value={form.department_id} onChange={e=>setForm({...form,department_id:e.target.value,designation_id:''})}><option value="">Select department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="span-2"><div style={{display:'flex',justifyContent:'space-between'}}><span>Designation / Role</span>{form.department_id?<button type="button" className="text-action" style={{padding:0}} onClick={()=>setQuickRoleOpen(true)}>+ Add Role</button>:null}</div><select value={form.designation_id} onChange={e=>setForm({...form,designation_id:e.target.value})} disabled={!form.department_id}><option value="">Select designation</option>{designations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label className="span-2">Reporting Manager<select value={form.manager_id} onChange={e=>setForm({...form,manager_id:e.target.value})}><option value="">None</option>{(users||[]).filter(u=>!editing||u.id!==editing.id).map(u=><option key={u.id} value={u.id}>{u.name} ({u.department||u.role})</option>)}</select></label></div></Modal>:null}

    {quickRoleOpen?<Modal title="Add Designation / Role" onClose={()=>setQuickRoleOpen(false)} actions={<><button className="secondary" onClick={()=>setQuickRoleOpen(false)}>Cancel</button><button className="primary" onClick={addRole} disabled={!quickRole.trim()}>Add Role</button></>}><label>Role name<input autoFocus value={quickRole} onChange={e=>setQuickRole(e.target.value)} placeholder="e.g. Senior Developer"/></label></Modal>:null}

    {importOpen?<Modal title="Import Employees" onClose={()=>setImportOpen(false)} actions={<><button className="secondary" onClick={()=>setImportOpen(false)}>Cancel</button><button className="primary" disabled={busy} onClick={importEmployees}>{busy?'Importing...':'Import file'}</button></>}><p className="muted small-copy">Use the same headings as the Add Employee screen: Employee No / Unique ID, Full Name, Email, Temporary Password, System Role, Department, Designation / Role and Reporting Manager Email.</p><button type="button" className="secondary" onClick={downloadEmployeeSample} style={{marginBottom:'12px'}}><Download size={16}/>Download current Employee Excel format</button><input type="file" accept=".xlsx,.xls,.csv" onChange={e=>setImportFile(e.target.files?.[0]||null)}/></Modal>:null}
  </>
}
