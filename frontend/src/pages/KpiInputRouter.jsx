import {useEffect,useMemo,useState} from 'react'
import {Download,RotateCcw,Save,Send} from 'lucide-react'
import {useSearchParams} from 'react-router-dom'
import {api,getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card,ErrorBox,Loader,PageHeader,Status} from '../components/UI'
import {assignmentDepartment,compareText} from '../lib/sorting'
import KpiInputV2 from './KpiInputV2'
import {
  whole,scoreText,isChoice,isKraAverage100,isMeasurementTarget,measurementLabels,metricUnit,
  minimumScore,qualifyingValue,targetValue,formatMetric,qualificationStatus,kpiScore100,kraAverage,kraScore,templateScore
} from '../lib/kpiScoring'

function ManagerInput({item,value,onChange,disabled}){
  const v=value||{},cfg=item.config||{}
  if(isChoice(item))return <select disabled={disabled} value={v.manager_selected_option||''} onChange={e=>onChange({manager_selected_option:e.target.value})}><option value="">Select manager result...</option>{Object.keys(cfg.score_map||{}).map(option=><option key={option} value={option}>{option}</option>)}</select>
  const directScore=isKraAverage100(item)&&!isMeasurementTarget(item)
  return <input disabled={disabled} type="number" min="0" max={directScore?100:undefined} step="1" value={v.manager_actual_numeric==null?'':Math.round(Number(v.manager_actual_numeric))} onChange={e=>{if(e.target.value===''){onChange({manager_actual_numeric:null});return}const next=Math.max(0,Math.round(Number(e.target.value)));onChange({manager_actual_numeric:directScore?Math.min(100,next):next})}} placeholder={isMeasurementTarget(item)?`Enter ${metricUnit(item)}`:directScore?'0 - 100':'Enter achieved result'}/>
}

function employeeAnswer(item,value){
  if(!value)return'—'
  if(isChoice(item))return value.selected_option||'—'
  if(value.actual_numeric===null||value.actual_numeric===undefined)return'—'
  return isMeasurementTarget(item)?formatMetric(value.actual_numeric,item):String(Math.round(Number(value.actual_numeric)))
}

function Calculated({item,value,prefix=''}){
  if(isChoice(item)){
    const selected=value?.[`${prefix}selected_option`]
    if(!selected)return <span className="cell-help">—</span>
    return <div><strong>{kpiScore100(item,value,prefix)}</strong> / 100<div className="threshold-achieved">Mapped marks</div></div>
  }
  const raw=value?.[`${prefix}actual_numeric`]
  if(raw===null||raw===undefined||raw==='')return <span className="cell-help">—</span>
  if(isMeasurementTarget(item)){
    const rawScore=kpiScore100(item,value,prefix,false),status=qualificationStatus(item,value,prefix)
    return <div><strong>{status.passed===false?0:rawScore}</strong> / 100{prefix==='manager_'&&status.passed===false?` (put: ${rawScore})`:''}{status.passed===false?<div className="threshold-not-achieved">Minimum not achieved → 0</div>:<div className="threshold-achieved">{rawScore===100?'Target achieved':'Calculated from target'}</div>}</div>
  }
  if(isKraAverage100(item)){
    const calculated=kpiScore100(item,value,prefix),failed=Number(raw)<minimumScore(item)
    return <div><strong>{calculated}</strong> / 100{failed?<div className="threshold-not-achieved">Below minimum → 0</div>:<div className="threshold-achieved">Qualified</div>}</div>
  }
  return <strong>{kpiScore100(item,value,prefix)}</strong>
}

function RuleSummary({item}){
  if(!isMeasurementTarget(item)){
    if(isKraAverage100(item))return <div><strong>Direct score / 100</strong><div className="cell-help">Minimum {minimumScore(item)}</div></div>
    return <span>Legacy scoring</span>
  }
  const qualifier=qualifyingValue(item),unit=metricUnit(item)
  return <div className="kpi-threshold-summary">
    <div><strong>{measurementLabels[item.input_type]||'Number'}</strong> · {unit}</div>
    <div>Target: <strong>{formatMetric(targetValue(item),item)}</strong> = 100 marks</div>
    <div className="cell-help">{item.direction==='lower'?'Lower result is better':'Higher result is better'}</div>
    {qualifier>0?<div className="cell-help">{item.direction==='lower'?'Maximum':'Minimum'} qualifying: {formatMetric(qualifier,item)}</div>:<div className="cell-help">No qualification gate</div>}
  </div>
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
  const managerReady=items.length>0&&items.every(item=>{const v=values[item.id]||{};return isChoice(item)?Boolean(v.manager_selected_option):v.manager_actual_numeric!==null&&v.manager_actual_numeric!==undefined&&v.manager_actual_numeric!==''})
  const liveManagerScore=assignment?templateScore(assignment.template.kras,values,'manager_',false):0
  const liveStaffScore=assignment?templateScore(assignment.template.kras,values):0
  const canEdit=Boolean(assignment?.can_edit_manager_score),canReview=Boolean(assignment?.can_review)
  const isSuperAdmin=user?.role==='superadmin'
  const hasThresholdFailure=items.some(item=>qualificationStatus(item,values,'manager_').passed===false)
  const rawOfficial=assignment?.final_score??(assignment?.status==='manager_reviewed'?assignment?.manager_score:null)
  const officialScore=hasThresholdFailure&&rawOfficial!==null?0:rawOfficial
  const cap=assignment?.subordinate_score_cap,pendingSubordinates=Number(assignment?.subordinate_pending_count||0)

  function setManagerValue(itemId,patch){setValues(currentValues=>({...currentValues,[itemId]:{...currentValues[itemId],...patch,kpi_item_id:itemId}}));setError('');setMessage('')}
  function payload(){return items.map(item=>({kpi_item_id:item.id,actual_numeric:values[item.id]?.actual_numeric??null,answer_text:values[item.id]?.answer_text??null,selected_option:values[item.id]?.selected_option??null,manager_actual_numeric:values[item.id]?.manager_actual_numeric??null,manager_selected_option:values[item.id]?.manager_selected_option??null,measurement:values[item.id]?.measurement??null,remarks:values[item.id]?.remarks??null,evidence_url:values[item.id]?.evidence_url??null,evidence_file_id:values[item.id]?.evidence_file_id??null}))}

  async function saveManagerScore(){if(!id||!canEdit||busy)return;setBusy(true);setError('');try{await api.put(`/kpi/assignments/${id}/responses`,payload());setMessage(`Manager Score saved: ${scoreText(liveManagerScore)}/100.`);await loadAssignment();await refreshList()}catch(e){setError(getError(e))}finally{setBusy(false)}}
  async function submitManagerReview(){
    if(!canEdit)return
    if(!managerReady){setError('Complete every Manager achieved value before submitting the review.');return}
    if(pendingSubordinates>0){setError(`Complete ${pendingSubordinates} subordinate KPI review${pendingSubordinates===1?'':'s'} first.`);return}
    if(cap!==null&&cap!==undefined&&liveManagerScore>Number(cap)){setError(`Manager Score cannot exceed summarized subordinate score ${cap}/100.`);return}
    setBusy(true);setError('');setMessage('')
    try{await api.put(`/kpi/assignments/${id}/responses`,payload());const{data}=await api.post(`/kpi/assignments/${id}/manager-review`,{decision:'approved',comments:isSuperAdmin?'Manager Score reviewed/updated by Super Admin.':'Manager Score submitted by reporting person.'});setMessage(`Manager review completed. Official Manager Score: ${scoreText(data.manager_score??liveManagerScore)}/100.`);await loadAssignment();await refreshList()}catch(e){setError(getError(e))}finally{setBusy(false)}
  }
  async function returnToEmployee(){
    const comments=window.prompt('Reason for returning this KPI to the employee:','Please update the KPI achieved values and resubmit.');
    if(comments===null)return;
    setBusy(true);setError('');
    try{
      await api.post(`/kpi/assignments/${id}/manager-review`,{decision:'rejected',comments:comments||'Returned to employee for correction.'});
      setMessage('KPI returned to the employee for correction.');
      await loadAssignment();
      await refreshList()
    }catch(e){setError(getError(e))}finally{setBusy(false)}
  }
  async function downloadPdf(){if(!id)return;try{const response=await api.get(`/kpi/assignments/${id}/pdf`,{responseType:'blob'}),blob=new Blob([response.data],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`kpi_report_${(assignment?.employee||'employee').toLowerCase().replace(/[^a-z0-9]+/g,'_')}.pdf`;a.click();URL.revokeObjectURL(url)}catch(e){setError(getError(e))}}

  if(!assignment)return<Loader/>
  return <>
    <PageHeader title={canReview?'KPI Manager Review':'KPI Hierarchy View'} subtitle={canReview?'Review the actual business result in its configured unit. The same target, direction and qualifying rule converts the manager result into marks out of 100.':'You can view KPI results for all levels below you. Manager input remains editable only by the immediate reporting person.'} actions={<button className="secondary" onClick={downloadPdf}><Download size={16}/>Export PDF Report</button>}/>
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
    {canReview&&!canEdit?<div className="locked-note" style={{marginBottom:'14px'}}>{assignment.status==='draft'||assignment.status==='not_started'?'Employee must submit the KPI before Manager input can be entered.':assignment.status==='finalized'&&!isSuperAdmin?'This KPI is finalized. Only Super Admin can change the Manager Score.':'Manager Score editing is currently locked for this KPI.'}</div>:null}

    {assignment.template.kras.map(kra=>{
      const staffAverage=kraAverage(kra,values),managerAverage=kraAverage(kra,values,'manager_',false),staffKra=kraScore(kra,values),managerKra=kraScore(kra,values,'manager_',false)
      return <Card key={kra.id}><div className="kra-review-head"><div><strong>{kra.name}</strong><div className="muted">{kra.items.length} KPI{kra.items.length===1?'':'s'} · each carries 100 marks</div></div><div className="kra-score-summary"><div className="weight-chip">KRA weight {whole(kra.weight)} / 100</div><div>Staff avg {scoreText(staffAverage)} → {scoreText(staffKra)}</div><div>Manager avg {scoreText(managerAverage)} → {scoreText(managerKra)}</div></div></div><div className="table-wrap"><table className="kpi-input-table"><thead><tr><th>KPI parameter & task</th><th>Measurement / target</th><th>Qualifying value</th><th>Staff achieved</th><th>Staff marks</th><th>Manager achieved</th><th>Manager marks</th><th>Employee notes</th></tr></thead><tbody>{kra.items.map(item=>{
        const v=values[item.id]||{},qualifier=qualifyingValue(item)
        return <tr key={item.id}>
          <td><strong>{item.question}</strong><div className="cell-help">{item.config?.meta?.task_responsibility||''}</div></td>
          <td><RuleSummary item={item}/></td>
          <td>{isMeasurementTarget(item)?<><strong>{qualifier>0?formatMetric(qualifier,item):'0 — no gate'}</strong>{qualifier>0?<div className="cell-help">{item.direction==='lower'?'At or below':'At or above'}</div>:null}</>:isKraAverage100(item)?<strong>{minimumScore(item)}</strong>:<span>Legacy</span>}</td>
          <td><strong>{employeeAnswer(item,v)}</strong></td>
          <td><Calculated item={item} value={v}/></td>
          <td><ManagerInput disabled={!canEdit||busy} item={item} value={v} onChange={patch=>setManagerValue(item.id,patch)}/>{isMeasurementTarget(item)&&v.manager_actual_numeric!==null&&v.manager_actual_numeric!==undefined?<div className="cell-help">{formatMetric(v.manager_actual_numeric,item)}</div>:null}</td>
          <td><Calculated item={item} value={v} prefix="manager_"/></td>
          <td>{v.remarks||v.measurement||'—'}</td>
        </tr>
      })}</tbody></table></div></Card>
    })}

    {canReview?<div className="footer-actions sticky-actions"><button className="secondary" disabled={busy||(assignment.status==='finalized'&&!isSuperAdmin)} onClick={returnToEmployee}><RotateCcw size={16}/>Return to Employee</button><div className="responsive-actions"><button className="secondary" disabled={busy||!canEdit} onClick={saveManagerScore}><Save size={16}/>{busy?'Saving...':'Save Manager Score'}</button><button className="primary" disabled={busy||!canEdit||!managerReady||pendingSubordinates>0||(cap!==null&&cap!==undefined&&liveManagerScore>Number(cap))} onClick={submitManagerReview}><Send size={16}/>{assignment.status==='finalized'&&isSuperAdmin?'Update Official Manager Score':'Submit Manager Review'}</button></div></div>:null}
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
