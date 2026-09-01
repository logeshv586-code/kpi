import {useEffect, useMemo, useState} from 'react'
import {Download, RotateCcw, Save, Send} from 'lucide-react'
import {useSearchParams} from 'react-router-dom'
import {api, getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card, ErrorBox, Loader, PageHeader, Status} from '../components/UI'
import {assignmentDepartment, compareText} from '../lib/sorting'
import KpiInputV2 from './KpiInputV2'

function scoreItem(item,value,prefix=''){
  const v=value||{},cfg=item.config||{},meta=cfg.meta||{}
  const weight=Number(item.weight||0)
  const cap=Math.max(0,Number(meta.score_cap_pct??100)/100)
  if(['choice','yesno'].includes(item.input_type)){
    const selected=v[`${prefix}selected_option`]
    if(!selected)return 0
    const pct=Number((cfg.score_map||{})[selected]||0)
    return Math.round(weight*Math.max(0,Math.min(pct/100,cap))*100)/100
  }
  const raw=v[`${prefix}actual_numeric`]
  if(raw===null||raw===undefined||raw==='')return 0
  const actual=Number(raw)
  if(!Number.isFinite(actual))return 0
  let ratio=0
  if(item.input_type==='rating'){
    ratio=actual/Math.max(1,Number(cfg.max_rating||5))
  }else if(meta.scoring_method==='direct_percentage'||(item.input_type==='percentage'&&item.target_value==null)){
    ratio=actual/100
  }else if(item.target_value==null){
    ratio=actual/100
  }else if(item.direction==='lower'&&Number(item.target_value)===0){
    ratio=actual<=0?1:0
  }else if(item.direction==='lower'){
    const target=Number(item.target_value)
    ratio=actual<=target||actual<=0?1:target/actual
  }else{
    const target=Number(item.target_value)
    ratio=target===0?(actual>=0?1:0):actual/target
  }
  return Math.round(weight*Math.max(0,Math.min(ratio,cap))*100)/100
}

function ManagerInput({item,value,onChange,disabled}){
  const v=value||{},cfg=item.config||{}
  if(['choice','yesno'].includes(item.input_type)){
    return <select disabled={disabled} value={v.manager_selected_option||''} onChange={e=>onChange({manager_selected_option:e.target.value})}>
      <option value="">Select manager result...</option>
      {Object.keys(cfg.score_map||{}).map(option=><option key={option} value={option}>{option}</option>)}
    </select>
  }
  return <input
    disabled={disabled}
    type="number"
    min="0"
    step="0.01"
    max={item.input_type==='rating'?(cfg.max_rating||5):undefined}
    value={v.manager_actual_numeric??''}
    onChange={e=>onChange({manager_actual_numeric:e.target.value===''?null:Number(e.target.value)})}
    placeholder={item.target_value!=null?`Enter manager result (target ${item.target_value})`:'Enter manager result'}
  />
}

function employeeAnswer(item,value){
  if(!value)return '—'
  if(['choice','yesno'].includes(item.input_type))return value.selected_option||'—'
  return value.actual_numeric===null||value.actual_numeric===undefined?'—':String(value.actual_numeric)
}

function monthLabel(row){
  const value=row?.month
  if(value&&/^\d{4}-\d{2}/.test(value)){
    const date=new Date(`${value.slice(0,7)}-01T00:00:00`)
    if(!Number.isNaN(date.getTime()))return new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(date)
  }
  return row?.cycle||'Month'
}

function ReviewerWorkspace({initialList,onListChange}){
  const {user}=useAuth()
  const [params,setParams]=useSearchParams()
  const id=params.get('assignment')
  const [list,setList]=useState(initialList||[])
  const [assignment,setAssignment]=useState(null)
  const [values,setValues]=useState({})
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)

  useEffect(()=>setList(initialList||[]),[initialList])

  async function refreshList(){
    try{
      const {data}=await api.get('/kpi/my')
      setList(data)
      onListChange?.(data)
    }catch(e){setError(getError(e))}
  }

  async function loadAssignment(){
    if(!id)return
    setAssignment(null)
    setValues({})
    try{
      const {data}=await api.get(`/kpi/assignments/${id}`)
      setAssignment(data)
      const next={}
      data.template.kras.forEach(kra=>kra.items.forEach(item=>{
        next[item.id]={kpi_item_id:item.id,...(item.response||{})}
      }))
      setValues(next)
    }catch(e){setError(getError(e))}
  }
  useEffect(()=>{loadAssignment()},[id])

  const current=(list||[]).find(row=>String(row.id)===String(id))
  const department=assignmentDepartment(current)
  const departments=useMemo(()=>[...new Set((list||[]).map(assignmentDepartment).filter(Boolean))].sort(compareText),[list])
  const departmentRows=useMemo(()=>department?(list||[]).filter(row=>assignmentDepartment(row)===department):(list||[]),[list,department])
  const people=useMemo(()=>{
    const seen=new Map()
    departmentRows.forEach(row=>{
      const key=String(row.employee_id)
      if(!seen.has(key))seen.set(key,{id:row.employee_id,name:row.employee,no:row.employee_no||'',designation:row.designation||''})
    })
    return [...seen.values()].sort((a,b)=>compareText(a.name,b.name))
  },[departmentRows])
  const personId=current?String(current.employee_id):''
  const personRows=useMemo(()=>departmentRows.filter(row=>String(row.employee_id)===personId).sort((a,b)=>String(b.month||'').localeCompare(String(a.month||''))),[departmentRows,personId])

  function selectDepartment(value){
    const first=(list||[]).filter(row=>assignmentDepartment(row)===value).sort((a,b)=>compareText(a.employee,b.employee))[0]
    if(first)setParams({assignment:first.id})
  }
  function selectPerson(value){
    const first=departmentRows.find(row=>String(row.employee_id)===String(value))
    if(first)setParams({assignment:first.id})
  }
  function selectMonth(value){
    if(value)setParams({assignment:value})
  }

  const items=useMemo(()=>assignment?assignment.template.kras.flatMap(kra=>kra.items):[],[assignment])
  const managerReady=items.length>0&&items.every(item=>{
    const v=values[item.id]||{}
    return ['choice','yesno'].includes(item.input_type)?Boolean(v.manager_selected_option):v.manager_actual_numeric!==null&&v.manager_actual_numeric!==undefined&&v.manager_actual_numeric!==''
  })
  const liveManagerScore=Math.min(100,Math.round(items.reduce((sum,item)=>sum+scoreItem(item,values[item.id],'manager_'),0)*100)/100)
  const canEdit=Boolean(assignment?.can_edit_manager_score)
  const isSuperAdmin=user?.role==='superadmin'
  const officialScore=assignment?.final_score??(assignment?.status==='manager_reviewed'?assignment?.manager_score:null)

  function setManagerValue(itemId,patch){
    setValues(currentValues=>({...currentValues,[itemId]:{...currentValues[itemId],...patch,kpi_item_id:itemId}}))
    setError('');setMessage('')
  }

  function payload(){
    return items.map(item=>({
      kpi_item_id:item.id,
      actual_numeric:values[item.id]?.actual_numeric??null,
      answer_text:values[item.id]?.answer_text??null,
      selected_option:values[item.id]?.selected_option??null,
      manager_actual_numeric:values[item.id]?.manager_actual_numeric??null,
      manager_selected_option:values[item.id]?.manager_selected_option??null,
      measurement:values[item.id]?.measurement??null,
      remarks:values[item.id]?.remarks??null,
      evidence_url:values[item.id]?.evidence_url??null,
      evidence_file_id:values[item.id]?.evidence_file_id??null,
    }))
  }

  async function saveManagerScore(showMessage=true){
    if(!id||!canEdit||busy)return false
    setBusy(true);setError('')
    try{
      const {data}=await api.put(`/kpi/assignments/${id}/responses`,payload())
      if(showMessage)setMessage(`Manager Score saved: ${Number(data.manager_score??liveManagerScore).toFixed(1)}/100.`)
      await loadAssignment();await refreshList()
      return true
    }catch(e){setError(getError(e));return false}
    finally{setBusy(false)}
  }

  async function submitManagerReview(){
    if(!canEdit)return
    if(!managerReady){setError('Complete every Manager Score before submitting the review.');return}
    setBusy(true);setError('');setMessage('')
    try{
      await api.put(`/kpi/assignments/${id}/responses`,payload())
      const {data}=await api.post(`/kpi/assignments/${id}/manager-review`,{
        decision:'approved',
        comments:isSuperAdmin?'Manager Score reviewed/updated by Super Admin.':'Manager Score submitted by reporting person.'
      })
      setMessage(`Manager review completed. Official Manager Score: ${Number(data.manager_score??liveManagerScore).toFixed(1)}/100.`)
      await loadAssignment();await refreshList()
    }catch(e){setError(getError(e))}
    finally{setBusy(false)}
  }

  async function returnToEmployee(){
    const comments=window.prompt('Reason for returning this KPI to the employee:','Please update the KPI values and resubmit.')
    if(comments===null)return
    setBusy(true);setError('');setMessage('')
    try{
      await api.post(`/kpi/assignments/${id}/manager-review`,{decision:'rejected',comments})
      setMessage('KPI returned to the employee for correction.')
      await loadAssignment();await refreshList()
    }catch(e){setError(getError(e))}
    finally{setBusy(false)}
  }

  async function downloadPdf(){
    if(!id)return
    try{
      const response=await api.get(`/kpi/assignments/${id}/pdf`,{responseType:'blob'})
      const blob=new Blob([response.data],{type:'application/pdf'})
      const url=URL.createObjectURL(blob)
      const a=document.createElement('a')
      a.href=url
      a.download=`kpi_report_${(assignment?.employee||'employee').toLowerCase().replace(/[^a-z0-9]+/g,'_')}.pdf`
      a.click();URL.revokeObjectURL(url)
    }catch(e){setError(getError(e))}
  }

  if(!assignment)return <Loader/>

  return <>
    <PageHeader title="KPI Input" subtitle="Reporting relationship controls Manager Score review. Employee self-score is reference only; Manager Score becomes the official weighted score." actions={<button className="secondary" onClick={downloadPdf}><Download size={16}/>Export PDF Report</button>}/>
    <ErrorBox error={error}/>
    {message?<div className="success-box" style={{marginBottom:'12px'}}>{message}</div>:null}

    <Card>
      <div className="form-grid" style={{gridTemplateColumns:'1fr 1.2fr 1fr'}}>
        <label><span>1. Department</span><select value={department||''} onChange={e=>selectDepartment(e.target.value)}>{departments.map(name=><option key={name} value={name}>{name}</option>)}</select></label>
        <label><span>2. Employee</span><select value={personId} onChange={e=>selectPerson(e.target.value)}>{people.map(person=><option key={person.id} value={person.id}>{person.name} ({person.no}){person.designation?` · ${person.designation}`:''}</option>)}</select></label>
        <label><span>3. Month</span><select value={String(id||'')} onChange={e=>selectMonth(e.target.value)}>{personRows.map(row=><option key={row.id} value={row.id}>{monthLabel(row)}</option>)}</select></label>
      </div>
    </Card>

    <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:'12px',margin:'14px 0'}}>
      <Card><div className="muted">Employee</div><strong>{assignment.employee}</strong><div className="muted" style={{marginTop:'5px'}}>Reports to: {assignment.manager_name||'Not assigned'}</div></Card>
      <Card><div className="muted">Employee Your Score</div><strong style={{fontSize:'1.5rem'}}>{Number(assignment.calculated_score||0).toFixed(1)}</strong><div className="muted">Reference only</div></Card>
      <Card><div className="muted">Manager Score</div><strong style={{fontSize:'1.5rem'}}>{liveManagerScore.toFixed(1)}</strong><div className="muted">Official weighted source</div></Card>
      <Card><div className="muted">Official Score</div><strong style={{fontSize:'1.5rem'}}>{officialScore==null?'Pending':Number(officialScore).toFixed(1)}</strong><div style={{marginTop:'6px'}}><Status value={assignment.status}/></div></Card>
    </div>

    {!canEdit?<div className="locked-note" style={{marginBottom:'14px'}}>{assignment.status==='draft'||assignment.status==='not_started'?'Employee must submit the KPI before Manager Score can be entered.':assignment.status==='finalized'&&!isSuperAdmin?'This KPI is finalized. Only Super Admin can change the Manager Score.':'Manager Score editing is currently locked for this KPI cycle.'}</div>:null}

    {assignment.template.kras.map(kra=><Card key={kra.id}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
        <div><strong>{kra.name}</strong><div className="muted">Manager reviews the employee submission below.</div></div>
        <div className="weight-chip">{kra.weight} marks weightage</div>
      </div>
      <div className="table-wrap">
        <table className="kpi-input-table">
          <thead><tr><th>KPI parameter & task</th><th>Expected target / criteria</th><th>Your Score</th><th>Manager Score</th><th>Weight</th><th>Marks scored</th><th>Employee notes</th></tr></thead>
          <tbody>{kra.items.map(item=>{
            const v=values[item.id]||{}
            const employeeMark=scoreItem(item,v)
            const managerMark=scoreItem(item,v,'manager_')
            return <tr key={item.id}>
              <td><strong>{item.question}</strong></td>
              <td>{item.target_value==null?(item.config?.meta?.measurement||'Configured criteria'):`Target: ${item.target_value}`}</td>
              <td><div style={{padding:'10px',border:'1px solid #e2e8f0',borderRadius:'8px',background:'#f8fafc'}}><strong>{employeeAnswer(item,v)}</strong><div className="muted" style={{marginTop:'5px'}}>Employee mark: {employeeMark.toFixed(1)} / {item.weight}</div></div></td>
              <td><ManagerInput disabled={!canEdit||busy} item={item} value={v} onChange={patch=>setManagerValue(item.id,patch)}/></td>
              <td><strong>{item.weight}</strong></td>
              <td><div><span className="muted">Manager</span><br/><strong style={{fontSize:'1.08rem',color:'#16a34a'}}>{managerMark.toFixed(1)}</strong><span className="muted"> / {item.weight}</span></div></td>
              <td>{v.remarks||v.measurement||'—'}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
    </Card>)}


    <div className="footer-actions sticky-actions" style={{display:'flex',justifyContent:'space-between',gap:'10px'}}>
      <button className="secondary" disabled={busy||!canEdit||assignment.status==='finalized'} onClick={returnToEmployee}><RotateCcw size={16}/>Return to Employee</button>
      <div style={{display:'flex',gap:'10px'}}>
        <button className="secondary" disabled={busy||!canEdit} onClick={()=>saveManagerScore(true)}><Save size={16}/>{busy?'Saving...':'Save Manager Score'}</button>
        <button className="primary" disabled={busy||!canEdit||!managerReady} onClick={submitManagerReview}><Send size={16}/>{assignment.status==='finalized'&&isSuperAdmin?'Update Official Manager Score':'Submit Manager Review'}</button>
      </div>
    </div>
  </>
}

export default function KpiInputRouter(){
  const {user}=useAuth()
  const [params,setParams]=useSearchParams()
  const [list,setList]=useState(null)
  const [error,setError]=useState('')
  const id=params.get('assignment')
  const reviewerUser=['manager','superadmin','hr'].includes(user?.role)||Boolean(user?.is_reporting_manager)

  useEffect(()=>{
    api.get('/kpi/my').then(({data})=>setList(data)).catch(e=>setError(getError(e)))
  },[])

  useEffect(()=>{
    if(!list?.length||id)return
    const preferred=list.find(row=>String(row.employee_id)===String(user?.id))||list[0]
    if(preferred)setParams({assignment:preferred.id},{replace:true})
  },[list,id,user?.id,setParams])

  if(error)return <ErrorBox error={error}/>
  if(!list)return <Loader/>
  if(!reviewerUser)return <KpiInputV2/>
  if(!id)return <Loader/>

  const current=list.find(row=>String(row.id)===String(id))
  if(current&&String(current.employee_id)===String(user?.id))return <KpiInputV2/>
  return <ReviewerWorkspace initialList={list} onListChange={setList}/>
}
