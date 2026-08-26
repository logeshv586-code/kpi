import {useEffect, useMemo, useState} from 'react'
import {Sparkles} from 'lucide-react'
import {api, getError} from '../lib/api'
import {Card, ErrorBox, Loader, PageHeader, Score, Status} from '../components/UI'
import {sortAssignments,sortUsers,compareText} from '../lib/sorting'

export default function Assignments() {
  const [users,setUsers]=useState([]),[templates,setTemplates]=useState([]),[cycles,setCycles]=useState([]),[rows,setRows]=useState(null)
  const [form,setForm]=useState({cycle_id:'',user_id:'',template_id:''})
  const [error,setError]=useState(''),[message,setMessage]=useState('')
  const load=()=>Promise.all([api.get('/admin/users'),api.get('/kpi/templates'),api.get('/kpi/cycles'),api.get('/kpi/my')]).then(([u,t,c,a])=>{
    setUsers(sortUsers(u.data.filter(x=>x.active&&x.role!=='superadmin')));setTemplates(t.data.filter(x=>x.status==='active'&&x.validation?.publishable));setCycles([...c.data.filter(x=>x.status!=='closed')].sort((a,b)=>compareText(b.month||b.name,a.month||a.name)));setRows(sortAssignments(a.data))
    setForm(f=>({...f,cycle_id:f.cycle_id||c.data.find(x=>x.status==='running')?.id||c.data[0]?.id||'',user_id:f.user_id||u.data.find(x=>x.role!=='superadmin')?.id||''}))
  }).catch(e=>setError(getError(e)))
  useEffect(()=>{load()},[])
  const employee=users.find(u=>Number(u.id)===Number(form.user_id))
  const matchingTemplates=useMemo(()=>templates.filter(t=>!t.designation_id||!employee?.designation_id||Number(t.designation_id)===Number(employee.designation_id)),[templates,employee])
  useEffect(()=>{if(!matchingTemplates.some(t=>Number(t.id)===Number(form.template_id)))setForm(f=>({...f,template_id:matchingTemplates[0]?.id||''}))},[form.user_id,matchingTemplates])

  async function assign(){try{setError('');setMessage('');await api.post('/kpi/assignments',{cycle_id:Number(form.cycle_id),user_id:Number(form.user_id),template_id:Number(form.template_id)});setMessage('KPI assigned successfully.');load()}catch(e){setError(getError(e))}}
  async function autoAssign(){
    if(!form.cycle_id)return
    try{setError('');setMessage('');const {data}=await api.post('/kpi/assignments/auto',{cycle_id:Number(form.cycle_id),include_managers:true,include_hr:true});setMessage(`Auto-assigned ${data.assigned.length}. Existing: ${data.skipped_existing.length}. No active designation template: ${data.no_active_template.length}.`);load()}catch(e){setError(getError(e))}
  }

  return <>
    <PageHeader title="KPI Assignments" subtitle="Assign one template manually or let the system match every employee to the active template for their designation." actions={<button className="secondary" disabled={!form.cycle_id} onClick={autoAssign}><Sparkles size={16}/>Auto-assign by designation</button>}/>
    <ErrorBox error={error}/>{message?<div className="success-box">{message}</div>:null}
    <Card><div className="form-grid"><label>Cycle<select value={form.cycle_id} onChange={e=>setForm({...form,cycle_id:e.target.value})}>{cycles.map(c=><option key={c.id} value={c.id}>{c.name} · {c.status}</option>)}</select></label><label>Employee<select value={form.user_id} onChange={e=>setForm({...form,user_id:e.target.value})}>{users.map(u=><option key={u.id} value={u.id}>{u.department||'Unassigned department'} · {u.name} — {u.designation||u.role}</option>)}</select></label><label>Matching template<select value={form.template_id} onChange={e=>setForm({...form,template_id:e.target.value})}>{matchingTemplates.map(t=><option key={t.id} value={t.id}>{t.name} v{t.version}</option>)}</select></label><button className="primary align-end" disabled={!form.cycle_id||!form.user_id||!form.template_id} onClick={assign}>Assign KPI</button></div><div className="helper-strip"><strong>Monthly shortcut:</strong> create the cycle, publish one template per designation, then click Auto-assign. Existing employee assignments are skipped safely.</div></Card>
    {!rows?<Loader/>:<Card><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Cycle</th><th>Template</th><th>Status</th><th>Score</th></tr></thead><tbody>{rows.map(a=><tr key={a.id}><td>{a.employee}</td><td>{a.cycle}</td><td>{a.template.name} v{a.template.version}</td><td><Status value={a.status}/></td><td><Score value={a.final_score??a.manager_score??a.calculated_score}/></td></tr>)}</tbody></table></div></Card>}
  </>
}
