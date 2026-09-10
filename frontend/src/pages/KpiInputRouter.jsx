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
const score2=value=>Math.round((Number(value||0)+Number.EPSILON)*100)/100
const scoreText=value=>score2(value).toFixed(2)
const isKraAverage100=item=>item?.config?.meta?.scoring_model==='kra_average_100'
const minimumScore=item=>{
  const meta=item?.config?.meta||{},value=Number(meta.minimum_score??meta.threshold_min??0)
  return Number.isFinite(value)?Math.max(0,Math.min(100,value)):0
}

function thresholdInfo(item,value,prefix=''){
  const meta=item.config?.meta||{}
  if(isKraAverage100(item)){
    const min=minimumScore(item)
    if(['choice','yesno'].includes(item.input_type)){
      const selected=value?.[`${prefix}selected_option`]
      if(!selected)return{configured:true,passed:null,rule:'minimum',min,max:null}
      const raw=Number((item.config?.score_map||{})[selected]||0),passed=raw>=min
      return{configured:true,passed,rule:'minimum',min,max:null,actual:raw,reason:passed?'Minimum score achieved':`Minimum score ${min} not achieved`}
    }
    const raw=value?.[`${prefix}actual_numeric`]
    if(raw===null||raw===undefined||raw==='')return{configured:true,passed:null,rule:'minimum',min,max:null}
    const actual=Number(raw),passed=Number.isFinite(actual)&&actual>=min
    return{configured:true,passed,rule:'minimum',min,max:null,actual,reason:passed?'Minimum score achieved':`Minimum score ${min} not achieved`}
  }

  if(!numericTypes.includes(item.input_type))return{configured:false,passed:null}
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

function kpiScore100(item,value,prefix=''){
  const v=value||{},cfg=item.config||{}
  if(['choice','yesno'].includes(item.input_type)){
    const selected=v[`${prefix}selected_option`]
    if(!selected)return 0
    const raw=Math.max(0,Math.min(100,Number((cfg.score_map||{})[selected]||0)))
    return isKraAverage100(item)&&raw<minimumScore(item)?0:score2(raw)
  }
  const raw=v[`${prefix}actual_numeric`]
  if(raw===null||raw===undefined||raw==='')return 0
  const actual=Number(raw)
  if(!Number.isFinite(actual))return 0
  if(isKraAverage100(item))return actual<minimumScore(item)?0:score2(Math.max(0,Math.min(100,actual)))
  const mark=scoreItemLegacy(item,value,prefix),weight=Number(item.weight||0)
  return weight>0?score2(mark/weight*100):0
}

function scoreItemLegacy(item,value,prefix=''){
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
  if(thresholdInfo(item,v,prefix).passed===false)return 0
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

function scoreItem(item,value,prefix=''){
  if(!isKraAverage100(item))return scoreItemLegacy(item,value,prefix)
  return score2(Number(item.weight||0)*kpiScore100(item,value,prefix)/100)
}

function scoringLabel(item){
  if(isKraAverage100(item))return `Minimum score: ${minimumScore(item)} / 100`
  const meta=item.config?.meta||{},unit=meta.unit||'',suffix=unit?` ${unit}`:'',parts=[]
  const min=meta.threshold_min,max=meta.threshold_max
  if(min!==null&&min!==undefined&&min!=='')parts.push(`Minimum: ${min}${suffix}`)
  if(max!==null&&max!==undefined&&max!=='')parts.push(`Maximum: ${max}${suffix}`)
  return parts.length?parts.join(' · '):'Legacy target scoring'
}

function TargetSummary({item,value,prefix=''}){
  const status=thresholdInfo(item,value,prefix)
  return <div className="kpi-threshold-summary"><div><strong>{scoringLabel(item)}</strong></div>{isKraAverage100(item)?<div className="cell-help">Every KPI is scored out of 100. Below minimum becomes 0.</div>:null}{status.passed!==null?<div className={status.passed?'threshold-achieved':'threshold-not-achieved'}>{status.passed?'Minimum achieved':`Below minimum · calculated KPI score 0`}</div>:null}</div>
}

function ManagerInput({item,value,onChange,disabled}){
  const v=value||{},cfg=item.config||{}
  if(['choice','yesno'].includes(item.input_type))return <select disabled={disabled} value={v.manager_selected_option||''} onChange={e=>onChange({manager_selected_option:e.target.value})}><option value="">Select manager result...</option>{Object.keys(cfg.score_map||{}).map(option=><option key={option} value={option}>{option}</option>)}</select>
  return <input disabled={disabled} type="number" min="0" max={isKraAverage100(item)?100:(item.input_type==='rating'?(cfg.max_rating||5):undefined)} step="1" value={v.manager_actual_numeric==null?'':Math.round(Number(v.manager_actual_numeric))} onChange={e=>{if(e.target.value===''){onChange({manager_actual_numeric:null});return}const next=Math.round(Number(e.target.value));onChange({manager_actual_numeric:isKraAverage100(item)?Math.max(0,Math.min(100,next)):next})}} placeholder={isKraAverage100(item)?'Manager score 0–100':'Enter achieved result'}/>
}

function employeeAnswer(item,value){
  if(!value)return'—'
  if(['choice','yesno'].includes(item.input_type))return value.selected_option||'—'
  return value.actual_numeric===null||value.actual_numeric===undefined?'—':isKraAverage100(item)?`${value.actual_numeric} / 100`:`${value.actual_numeric}${item.config?.meta?.unit?` ${item.config.meta.unit}`:''}`
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
    try{const{data}=await api.get(`/kpi/assignments/${id}`);setAssignment(data);const next={};data.template.kras.forEach(kra=>kra.items.forEach(item=>{next[item.id]={kpi_item_id:item.id,...(item.response||{})}}));setValues(next)}catch(e){setError(getError(e))}
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
  const liveManagerScore=Math.min(100,score2(items.reduce((sum,item)=>sum+scoreItem(item,values[item.id],'manager_'),0)))
  const liveStaffScore=Math.min(100,score2(items.reduce((sum,item)=>sum+scoreItem(item,values[item.id]),0)))
  const canEdit=Boolean(assignment?.can_edit_manager_score),canReview=Boolean(assignment?.can_review)
  const isSuperAdmin=user?.role==='superadmin',officialScore=assignment?.final_score??(assignment?.status==='manager_reviewed'?assignment?.manager_score:null)
  const cap=assignment?.subordinate_score_cap,pendingSubordinates=Number(assignment?.subordinate_pending_count||0)

  function setManagerValue(itemId,patch){setValues(currentValues=>({...currentValues,[itemId]:{...currentValues[itemId],...patch,kpi_item_id:itemId}}));setError('');setMessage('')}
  function payload(){return items.map(item=>({kpi_item_id:item.id,actual_numeric:values[item.id]?.actual_numeric??null,answer_text:values[item.id]?.answer_text??null,selected_option:values[item.id]?.selected_option??null,manager_actual_numeric:values[item.id]?.manager_actual_numeric??null,manager_selected_option:values[item.id]?.manager_selected_option??null,measurement:values[item.id]?.measurement??null,remarks:values[item.id]?.remarks??null,evidence_url:values[item.id]?.evidence_url??null,evidence_file_id:values[item.id]?.evidence_file_id??null}))}

  async function saveManagerScore(){if(!id||!canEdit||busy)return;setBusy(true);setError('');try{const{data}=await api.put(`/kpi/assignments/${id}/responses`,payload());setMessage(`Manager Score saved: ${scoreText(data.manager_score??liveManagerScore)}/100.`);await loadAssignment();await refreshList()}catch(e){setError(getError(e))}finally{setBusy(false)}}
  async function submitManagerReview(){
    if(!canEdit)return
    if(!managerReady){setError('Complete every Manager KPI score before submitting the review.');return}
    if(pendingSubordinates>0){setError(`Complete ${pendingSubordinates} subordinate KPI review${pendingSubordinates===1?'':'s'} first.`);return}
    if(cap!==null&&cap!==undefined&&liveManagerScore>Number(cap)){setError(`Manager Score cannot exceed summarized subordinate score ${cap}/100.`);return}
    setBusy(true);setError('');setMessage('')
    try{await api.put(`/kpi/assignments/${id}/responses`,payload());const{data}=await api.post(`/kpi/assignments/${id}/manager-review`,{decision:'approved',comments:isSuperAdmin?'Manager Score reviewed/updated by Super Admin.':'Manager Score submitted by reporting person.'});setMessage(`Manager review completed. Official Manager Score: ${scoreText(data.manager_score??liveManagerScore)}/100.`);await loadAssignment();await refreshList()}catch(e){setError(getError(e))}finally{setBusy(false)}
  }
  async function returnToEmployee(){const comments=window.prompt('Reason for returning this KPI to the employee:','Please update the KPI scores and resubmit.');if(comments===null)return;setBusy(true);setError('');try{await api.post(`/kpi/assignments/${id}/manager-review`,{decision:'rejected',comments});setMessage('KPI returned to the employee for correction.');await loadAssignment();await refreshList()}catch(e){setError(getError(e))}finally{setBusy(false)}}
  async function downloadPdf(){if(!id)return;try{const response=await api.get(`/kpi/assignments/${id}/pdf`,{responseType:'blob'}),blob=new Blob([response.data],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`kpi_report_${(assignment?.employee||'employee').toLowerCase().replace(/[^a-z0-9]+/g,'_')}.pdf`;a.click();URL.revokeObjectURL(url)}catch(e){setError(getError(e))}}

  if(!assignment)return<Loader/>
  return <>
    <PageHeader title={canReview?'KPI Manager Review':'KPI Hierarchy View'} subtitle={canReview?'Review each KPI as a score out of 100. Minimum score is applied first, then KPI scores are averaged inside each KRA and weighted to the final score.':'You can view KPI results for all levels below you. Manager Score remains editable only by the immediate reporting person.'} actions={<button className="secondary" onClick={downloadPdf}><Download size={16}/>Export PDF Report</button>}/>
    <ErrorBox error={error}/>{message?<div className="success-box" style={{marginBottom:'12px'}}>{message}</div>:null}
    <Card><div className="form-grid three-responsive"><label><span>1. Department</span><select value={department||''} onChange={e=>selectDepartment(e.target.value)}>{departments.map(name=><option key={name} value={name}>{name}</option>)}</select></label><label><span>2. Employee</span><select value={personId} onChange={e=>selectPerson(e.target.value)}>{people.map(person=><option key={person.id} value={person.id}>{person.name} ({person.no}){person.designation?` · ${person.designation}`:''}</option>)}</select></label><label><span>3. Review Period</span><select value={String(id||'')} onChange={e=>selectPeriod(e.target.value)}>{personRows.map(row=><option key={row.id} value={row.id}>{periodLabel(row)}</option>)}</select></label></div></Card>

    <div className="metric-grid compact" style={{margin:'14px 0'}}>
      <Card><div className="muted">Employee</div><strong>{assignment.employee}</strong><div className="muted">Reports to: {assignment.manager_name||'Not assigned'}</div></Card>
      <Card><div className="muted">Staff Score</div><strong className="small-metric">{scoreText(liveStaffScore)}</strong><div className="muted">out of 100</div></Card>
      <Card><div className="muted">Manager Score</div><strong className="small-metric">{scoreText(liveManagerScore)}</strong><div className="muted">out of 100</div></Card>
      <Card><div className="muted">Official Score</div><strong className="small-metric">{officialScore==null?'Pending':scoreText(officialScore)}</strong><div><Status value={assignment.status}/></div></Card>
    </div>

    {!canReview?<div className="view-only-note"><strong>Hierarchy view only.</strong> This employee is below your reporting chain, but only their immediate reporting manager can enter or submit Manager Score.</div>:null}
    {assignment.subordinate_score_cap_applies?<div className="subordinate-cap-note"><strong>Subordinate score rule:</strong> {pendingSubordinates>0?`${pendingSubordinates} direct-report KPI review${pendingSubordinates===1?' is':'s are'} still pending. This manager's review cannot be completed until those scores are available.`:`Maximum Manager Score for this employee: ${cap}/100, based on the summarized score of direct reports.`}</div>:null}
    {canReview&&!canEdit?<div className="locked-note" style={{marginBottom:'14px'}}>{assignment.status==='draft'||assignment.status==='not_started'?'Employee must submit the KPI before Manager Score can be entered.':assignment.status==='finalized'&&!isSuperAdmin?'This KPI is finalized. Only Super Admin can change the Manager Score.':'Manager Score editing is currently locked for this KPI.'}</div>:null}

    {assignment.template.kras.map(kra=>{
      const staffKra=score2(kra.items.reduce((sum,item)=>sum+scoreItem(item,values[item.id]),0)),managerKra=score2(kra.items.reduce((sum,item)=>sum+scoreItem(item,values[item.id],'manager_'),0))
      return <Card key={kra.id}><div className="kra-review-head"><div><strong>{kra.name}</strong><div className="muted">{kra.items.length} KPI{kra.items.length===1?'':'s'} · each scored independently out of 100</div></div><div className="kra-score-summary"><div className="weight-chip">KRA weight {kra.weight} / 100</div><div>Staff {scoreText(staffKra)} · Manager {scoreText(managerKra)}</div></div></div><div className="table-wrap"><table className="kpi-input-table"><thead><tr><th>KPI parameter & task</th><th>Minimum / scoring rule</th><th>Staff KPI score</th><th>Manager KPI score</th><th>KPI score base</th><th>KRA contribution</th><th>Employee notes</th></tr></thead><tbody>{kra.items.map(item=>{
        const v=values[item.id]||{},employeeMark=scoreItem(item,v),managerMark=scoreItem(item,v,'manager_'),staffScore=kpiScore100(item,v),managerScore=kpiScore100(item,v,'manager_'),staffThreshold=thresholdInfo(item,v),managerThreshold=thresholdInfo(item,v,'manager_')
        return <tr key={item.id}><td><strong>{item.question}</strong><div className="cell-help">{item.config?.meta?.task_responsibility||''}</div></td><td><TargetSummary item={item} value={v}/></td><td><div className="achieved-box"><strong>{employeeAnswer(item,v)}</strong><div className="cell-help">Calculated KPI score: {scoreText(staffScore)} / 100</div>{staffThreshold.passed===false?<div className="threshold-not-achieved">Below minimum · 0 score</div>:staffThreshold.passed===true?<div className="threshold-achieved">Minimum achieved</div>:null}</div></td><td><ManagerInput disabled={!canEdit||busy} item={item} value={v} onChange={patch=>setManagerValue(item.id,patch)}/><div className="cell-help">Calculated KPI score: {scoreText(managerScore)} / 100</div>{managerThreshold.passed===false?<div className="threshold-not-achieved">Below minimum · 0 score</div>:managerThreshold.passed===true?<div className="threshold-achieved">Minimum achieved</div>:null}</td><td><strong>{isKraAverage100(item)?'100':item.weight}</strong><div className="cell-help">{isKraAverage100(item)?'fixed':'legacy'}</div></td><td><div>Staff <strong>{scoreText(employeeMark)}</strong></div><div>Manager <strong>{scoreText(managerMark)}</strong></div></td><td>{v.remarks||v.measurement||'—'}</td></tr>
      })}</tbody></table></div></Card>
    })}

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
