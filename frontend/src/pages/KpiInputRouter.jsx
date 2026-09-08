import {useEffect,useMemo,useState} from 'react'
import {Download,RotateCcw,Save,Send} from 'lucide-react'
import {useSearchParams} from 'react-router-dom'
import {api,getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card,ErrorBox,Loader,PageHeader,Status} from '../components/UI'
import {assignmentDepartment,compareText} from '../lib/sorting'
import KpiInputV2 from './KpiInputV2'

const numericTypes=['number','percentage','currency','days','count']
const whole=value=>Math.round(Number(value||0))

function thresholdInfo(item,value,prefix=''){
  if(!numericTypes.includes(item.input_type))return{configured:false,passed:null}
  const meta=item.config?.meta||{}
  const rule=meta.threshold_rule||'none'
  const min=meta.threshold_min===null||meta.threshold_min===undefined||meta.threshold_min===''?null:Number(meta.threshold_min)
  const max=meta.threshold_max===null||meta.threshold_max===undefined||meta.threshold_max===''?null:Number(meta.threshold_max)
  const raw=value?.[`${prefix}actual_numeric`]
  if(rule==='none'||(min===null&&max===null))return{configured:false,passed:null,rule,min,max}
  if(raw===null||raw===undefined||raw==='')return{configured:true,passed:null,rule,min,max}
  const actual=Number(raw)
  let passed=true,reason='Threshold achieved'
  if(rule==='minimum'&&min!==null){passed=actual>=min;reason=passed?'Minimum achieved':`Minimum ${min} not achieved`}
  else if(rule==='maximum'&&max!==null){passed=actual<=max;reason=passed?'Maximum limit met':`Maximum ${max} exceeded`}
  else if(rule==='range'){
    if(min!==null&&actual<min){passed=false;reason=`Minimum ${min} not achieved`}
    else if(max!==null&&actual>max){passed=false;reason=`Maximum ${max} exceeded`}
    else reason='Within acceptable range'
  }
  return{configured:true,passed,rule,min,max,reason,actual}
}

function scoreItem(item,value,prefix=''){
  const v=value||{},cfg=item.config||{},meta=cfg.meta||{},weight=Number(item.weight||0)
  const cap=Math.max(0,Number(meta.score_cap_pct??100)/100)
  if(['choice','yesno'].includes(item.input_type)){
    const selected=v[`${prefix}selected_option`]
    if(!selected)return 0
    const pct=Number((cfg.score_map||{})[selected]||0)
    return whole(weight*Math.max(0,Math.min(pct/100,cap)))
  }
  const raw=v[`${prefix}actual_numeric`]
  if(raw===null||raw===undefined||raw==='')return 0
  const actual=Number(raw)
  if(!Number.isFinite(actual))return 0
  const threshold=thresholdInfo(item,v,prefix)
  if(threshold.passed===false)return 0
  let ratio=0
  if(item.input_type==='rating')ratio=actual/Math.max(1,Number(cfg.max_rating||5))
  else if(meta.scoring_method==='direct_percentage'||(item.input_type==='percentage'&&item.target_value==null))ratio=actual/100
  else if(item.target_value==null)ratio=actual/100
  else if(item.direction==='lower'&&Number(item.target_value)===0)ratio=actual<=0?1:0
  else if(item.direction==='lower'){
    const target=Number(item.target_value);ratio=actual<=target||actual<=0?1:target/actual
  }else{
    const target=Number(item.target_value);ratio=target===0?(actual>=0?1:0):actual/target
  }
  return whole(weight*Math.max(0,Math.min(ratio,cap)))
}

function thresholdLabel(item){
  const meta=item.config?.meta||{},rule=meta.threshold_rule||'none',unit=meta.unit||''
  const min=meta.threshold_min,max=meta.threshold_max,suffix=unit?` ${unit}`:''
  if(rule==='minimum'&&min!==null&&min!==undefined)return`Minimum: ${min}${suffix}`
  if(rule==='maximum'&&max!==null&&max!==undefined)return`Maximum: ${max}${suffix}`
  if(rule==='range'){
    if(min!==null&&min!==undefined&&max!==null&&max!==undefined)return`Range: ${min}${suffix} – ${max}${suffix}`
    if(min!==null&&min!==undefined)return`Minimum: ${min}${suffix}`
    if(max!==null&&max!==undefined)return`Maximum: ${max}${suffix}`
  }
  return'No hard threshold'
}

function TargetSummary({item,value,prefix=''}){
  const unit=item.config?.meta?.unit||'',suffix=unit?` ${unit}`:''
  const threshold=thresholdInfo(item,value,prefix)
  return <div className="kpi-threshold-summary">
    <div><strong>Target:</strong> {item.target_value==null?'Configured criteria':`${item.target_value}${suffix}`}</div>
    {threshold.configured?<div><strong>{thresholdLabel(item)}</strong></div>:null}
    {threshold.passed!==null?<div className={threshold.passed?'threshold-achieved':'threshold-not-achieved'}>{threshold.passed?'Achieved':`Not Achieved · ${threshold.reason}`}</div>:null}
  </div>
}

function ManagerInput({item,value,onChange,disabled}){
  const v=value||{},cfg=item.config||{}
  if(['choice','yesno'].includes(item.input_type))return <select disabled={disabled} value={v.manager_selected_option||''} onChange={e=>onChange({manager_selected_option:e.target.value})}><option value="">Select manager result...</option>{Object.keys(cfg.score_map||{}).map(option=><option key={option} value={option}>{option}</option>)}</select>
  return <input disabled={disabled} type="number" min="0" step={item.input_type==='count'?'1':'0.01'} max={item.input_type==='rating'?(cfg.max_rating||5):undefined} value={v.manager_actual_numeric??''} onChange={e=>onChange({manager_actual_numeric:e.target.value===''?null:Number(e.target.value)})} placeholder="Enter achieved result"/>
}

function employeeAnswer(item,value){
  if(!value)return'—'
  if(['choice','yesno'].includes(item.input_type))return value.selected_option||'—'
  const unit=item.config?.meta?.unit||''
  return value.actual_numeric===null||value.actual_numeric===undefined?'—':`${value.actual_numeric}${unit?` ${unit}`:''}`
}

function periodLabel(row){return row?.period_label||row?.cycle||'Review period'}

function ReviewerWorkspace({initialList,onListChange}){
  const{user}=useAuth()
  const[params,setParams]=useSearchParams(),id=params.get('assignment')
  const[list,setList]=useState(initialList||[]),[assignment,setAssignment]=useState(null),[values,setValues]=useState({})
  const[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)

  useEffect(()=>setList(initialList||[]),[initialList])
  async function refreshList(){try{const{data}=await api.get('/kpi/my');setList(data);onListChange?.(data)}catch(e){setError(getError(e))}}
  async function loadAssignment(){
    if(!id)return
    setAssignment(null);setValues({})
    try{
      const{data}=await api.get(`/kpi/assignments/${id}`);setAssignment(data)
      const next={};data.template.kras.forEach(kra=>kra.items.forEach(item=>{next[item.id]={kpi_item_id:item.id,...(item.response||{})}}));setValues(next)
    }catch(e){setError(getError(e))}
  }
  useEffect(()=>{loadAssignment()},[id])

  const current=(list||[]).find(row=>String(row.id)===String(id)),department=assignmentDepartment(current)
  const departments=useMemo(()=>[...new Set((list||[]).map(assignmentDepartment).filter(Boolean))].sort(compareText),[list])
  const departmentRows=useMemo(()=>department?(list||[]).filter(row=>assignmentDepartment(row)===department):(list||[]),[list,department])
  const people=useMemo(()=>{const seen=new Map();departmentRows.forEach(row=>{const key=String(row.employee_id);if(!seen.has(key))seen.set(key,{id:row.employee_id,name:row.employee,no:row.employee_no||'',designation:row.designation||''})});return[...seen.values()].sort((a,b)=>compareText(a.name,b.name))},[departmentRows])
  const personId=current?String(current.employee_id):''
  const personRows=useMemo(()=>departmentRows.filter(row=>String(row.employee_id)===personId).sort((a,b)=>String(b.month||'').localeCompare(String(a.month||''))||String(b.id).localeCompare(String(a.id))),[departmentRows,personId])

  function selectDepartment(value){const first=(list||[]).filter(row=>assignmentDepartment(row)===value).sort((a,b)=>compareText(a.employee,b.employee))[0];if(first)setParams({assignment:first.id})}
  function selectPerson(value){const first=departmentRows.find(row=>String(row.employee_id)===String(value));if(first)setParams({assignment:first.id})}
  function selectPeriod(value){if(value)setParams({assignment:value})}

  const items=useMemo(()=>assignment?assignment.template.kras.flatMap(kra=>kra.items):[],[assignment])
  const managerReady=items.length>0&&items.every(item=>{const v=values[item.id]||{};return['choice','yesno'].includes(item.input_type)?Boolean(v.manager_selected_option):v.manager_actual_numeric!==null&&v.manager_actual_numeric!==undefined&&v.manager_actual_numeric!==''})
  const liveManagerScore=Math.min(100,whole(items.reduce((sum,item)=>sum+scoreItem(item,values[item.id],'manager_'),0)))
  const canEdit=Boolean(assignment?.can_edit_manager_score),canReview=Boolean(assignment?.can_review)
  const isSuperAdmin=user?.role==='superadmin',officialScore=assignment?.final_score??(assignment?.status==='manager_reviewed'?assignment?.manager_score:null)
  const cap=assignment?.subordinate_score_cap,pendingSubordinates=Number(assignment?.subordinate_pending_count||0)

  function setManagerValue(itemId,patch){setValues(currentValues=>({...currentValues,[itemId]:{...currentValues[itemId],...patch,kpi_item_id:itemId}}));setError('');setMessage('')}
  function payload(){return items.map(item=>({kpi_item_id:item.id,actual_numeric:values[item.id]?.actual_numeric??null,answer_text:values[item.id]?.answer_text??null,selected_option:values[item.id]?.selected_option??null,manager_actual_numeric:values[item.id]?.manager_actual_numeric??null,manager_selected_option:values[item.id]?.manager_selected_option??null,measurement:values[item.id]?.measurement??null,remarks:values[item.id]?.remarks??null,evidence_url:values[item.id]?.evidence_url??null,evidence_file_id:values[item.id]?.evidence_file_id??null}))}

  async function saveManagerScore(){if(!id||!canEdit||busy)return;setBusy(true);setError('');try{const{data}=await api.put(`/kpi/assignments/${id}/responses`,payload());setMessage(`Manager Score saved: ${whole(data.manager_score??liveManagerScore)}/100.`);await loadAssignment();await refreshList()}catch(e){setError(getError(e))}finally{setBusy(false)}}
  async function submitManagerReview(){
    if(!canEdit)return
    if(!managerReady){setError('Complete every Manager Score before submitting the review.');return}
    if(pendingSubordinates>0){setError(`Complete ${pendingSubordinates} subordinate KPI review${pendingSubordinates===1?'':'s'} first.`);return}
    if(cap!==null&&cap!==undefined&&liveManagerScore>Number(cap)){setError(`Manager Score cannot exceed summarized subordinate score ${cap}/100.`);return}
    setBusy(true);setError('');setMessage('')
    try{await api.put(`/kpi/assignments/${id}/responses`,payload());const{data}=await api.post(`/kpi/assignments/${id}/manager-review`,{decision:'approved',comments:isSuperAdmin?'Manager Score reviewed/updated by Super Admin.':'Manager Score submitted by reporting person.'});setMessage(`Manager review completed. Official Manager Score: ${whole(data.manager_score??liveManagerScore)}/100.`);await loadAssignment();await refreshList()}catch(e){setError(getError(e))}finally{setBusy(false)}
  }
  async function returnToEmployee(){const comments=window.prompt('Reason for returning this KPI to the employee:','Please update the KPI values and resubmit.');if(comments===null)return;setBusy(true);setError('');try{await api.post(`/kpi/assignments/${id}/manager-review`,{decision:'rejected',comments});setMessage('KPI returned to the employee for correction.');await loadAssignment();await refreshList()}catch(e){setError(getError(e))}finally{setBusy(false)}}
  async function downloadPdf(){if(!id)return;try{const response=await api.get(`/kpi/assignments/${id}/pdf`,{responseType:'blob'}),blob=new Blob([response.data],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`kpi_report_${(assignment?.employee||'employee').toLowerCase().replace(/[^a-z0-9]+/g,'_')}.pdf`;a.click();URL.revokeObjectURL(url)}catch(e){setError(getError(e))}}

  if(!assignment)return<Loader/>
  return <>
    <PageHeader title={canReview?'KPI Manager Review':'KPI Hierarchy View'} subtitle={canReview?'Review the direct report. Staff enter achieved values; the system applies targets and thresholds.':'You can view KPI results for all levels below you. Manager Score remains editable only by the immediate reporting person.'} actions={<button className="secondary" onClick={downloadPdf}><Download size={16}/>Export PDF Report</button>}/>
    <ErrorBox error={error}/>{message?<div className="success-box" style={{marginBottom:'12px'}}>{message}</div>:null}
    <Card><div className="form-grid three-responsive"><label><span>1. Department</span><select value={department||''} onChange={e=>selectDepartment(e.target.value)}>{departments.map(name=><option key={name} value={name}>{name}</option>)}</select></label><label><span>2. Employee</span><select value={personId} onChange={e=>selectPerson(e.target.value)}>{people.map(person=><option key={person.id} value={person.id}>{person.name} ({person.no}){person.designation?` · ${person.designation}`:''}</option>)}</select></label><label><span>3. Review Period</span><select value={String(id||'')} onChange={e=>selectPeriod(e.target.value)}>{personRows.map(row=><option key={row.id} value={row.id}>{periodLabel(row)}</option>)}</select></label></div></Card>

    <div className="metric-grid compact" style={{margin:'14px 0'}}>
      <Card><div className="muted">Employee</div><strong>{assignment.employee}</strong><div className="muted">Reports to: {assignment.manager_name||'Not assigned'}</div></Card>
      <Card><div className="muted">Staff Score</div><strong className="small-metric">{whole(assignment.calculated_score)}</strong><div className="muted">System calculated</div></Card>
      <Card><div className="muted">Manager Score</div><strong className="small-metric">{liveManagerScore}</strong><div className="muted">Whole-number score</div></Card>
      <Card><div className="muted">Official Score</div><strong className="small-metric">{officialScore==null?'Pending':whole(officialScore)}</strong><div><Status value={assignment.status}/></div></Card>
    </div>

    {!canReview?<div className="view-only-note"><strong>Hierarchy view only.</strong> This employee is below your reporting chain, but only their immediate reporting manager can enter or submit Manager Score.</div>:null}
    {assignment.subordinate_score_cap_applies?<div className="subordinate-cap-note"><strong>Subordinate score rule:</strong> {pendingSubordinates>0?`${pendingSubordinates} direct-report KPI review${pendingSubordinates===1?' is':'s are'} still pending. This manager's review cannot be completed until those scores are available.`:`Maximum Manager Score for this employee: ${cap}/100, based on the rounded summarized score of direct reports.`}</div>:null}
    {canReview&&!canEdit?<div className="locked-note" style={{marginBottom:'14px'}}>{assignment.status==='draft'||assignment.status==='not_started'?'Employee must submit the KPI before Manager Score can be entered.':assignment.status==='finalized'&&!isSuperAdmin?'This KPI is finalized. Only Super Admin can change the Manager Score.':'Manager Score editing is currently locked for this KPI.'}</div>:null}

    {assignment.template.kras.map(kra=><Card key={kra.id}><div className="kra-review-head"><div><strong>{kra.name}</strong><div className="muted">Achieved values are measured against the configured target and threshold.</div></div><div className="weight-chip">{kra.weight} marks weightage</div></div><div className="table-wrap"><table className="kpi-input-table"><thead><tr><th>KPI parameter & task</th><th>Target / threshold</th><th>Staff achieved</th><th>Manager achieved</th><th>Weight</th><th>Marks scored</th><th>Employee notes</th></tr></thead><tbody>{kra.items.map(item=>{
      const v=values[item.id]||{},employeeMark=scoreItem(item,v),managerMark=scoreItem(item,v,'manager_'),staffThreshold=thresholdInfo(item,v),managerThreshold=thresholdInfo(item,v,'manager_')
      return <tr key={item.id}><td><strong>{item.question}</strong><div className="cell-help">{item.config?.meta?.task_responsibility||''}</div></td><td><TargetSummary item={item} value={v}/></td><td><div className="achieved-box"><strong>{employeeAnswer(item,v)}</strong><div className="cell-help">Staff mark: {employeeMark} / {item.weight}</div>{staffThreshold.passed===false?<div className="threshold-not-achieved">Not Achieved</div>:staffThreshold.passed===true?<div className="threshold-achieved">Achieved</div>:null}</div></td><td><ManagerInput disabled={!canEdit||busy} item={item} value={v} onChange={patch=>setManagerValue(item.id,patch)}/>{managerThreshold.passed===false?<div className="threshold-not-achieved">Not Achieved · 0 marks</div>:managerThreshold.passed===true?<div className="threshold-achieved">Achieved</div>:null}</td><td><strong>{item.weight}</strong></td><td><strong>{managerMark}</strong> / {item.weight}</td><td>{v.remarks||v.measurement||'—'}</td></tr>
    })}</tbody></table></div></Card>)}

    {canReview?<div className="footer-actions sticky-actions"><button className="secondary" disabled={busy||!canEdit||assignment.status==='finalized'} onClick={returnToEmployee}><RotateCcw size={16}/>Return to Employee</button><div className="responsive-actions"><button className="secondary" disabled={busy||!canEdit} onClick={saveManagerScore}><Save size={16}/>{busy?'Saving...':'Save Manager Score'}</button><button className="primary" disabled={busy||!canEdit||!managerReady||pendingSubordinates>0||(cap!==null&&cap!==undefined&&liveManagerScore>Number(cap))} onClick={submitManagerReview}><Send size={16}/>{assignment.status==='finalized'&&isSuperAdmin?'Update Official Manager Score':'Submit Manager Review'}</button></div></div>:null}
  </>
}

export default function KpiInputRouter(){
  const{user}=useAuth(),[params,setParams]=useSearchParams(),[list,setList]=useState(null),[error,setError]=useState(''),id=params.get('assignment')
  const reviewerUser=['manager','superadmin','hr'].includes(user?.role)||Boolean(user?.is_reporting_manager)
  useEffect(()=>{api.get('/kpi/my').then(({data})=>setList(data)).catch(e=>setError(getError(e)))},[])
  useEffect(()=>{if(!list?.length||id)return;const preferred=list.find(row=>String(row.employee_id)===String(user?.id))||list[0];if(preferred)setParams({assignment:preferred.id},{replace:true})},[list,id,user?.id,setParams])
  if(error)return<ErrorBox error={error}/>
  if(!list)return<Loader/>
  if(!reviewerUser)return<KpiInputV2/>
  if(!id)return<Loader/>
  const current=list.find(row=>String(row.id)===String(id))
  if(current&&String(current.employee_id)===String(user?.id))return<KpiInputV2/>
  return<ReviewerWorkspace initialList={list} onListChange={setList}/>
}
