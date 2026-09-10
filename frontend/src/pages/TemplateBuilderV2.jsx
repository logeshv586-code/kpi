import {useEffect,useMemo,useState} from 'react'
import {ArrowLeft,Equal,Plus,Save,Trash2} from 'lucide-react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {api,getError} from '../lib/api'
import {Card,ErrorBox,PageHeader} from '../components/UI'

const splitWeight=(total,count)=>{
  if(!count)return[]
  const wholeTotal=Math.max(0,Math.round(Number(total||0)))
  const base=Math.floor(wholeTotal/count)
  const remainder=wholeTotal-base*count
  const out=Array(count).fill(base)
  for(let index=0;index<remainder;index+=1)out[index]+=1
  return out
}

// Internal contribution shares are kept only for storage/backward compatibility.
// The user-facing KPI score is always 0-100 and KPIs are averaged equally in a KRA.
const splitContribution=(total,count)=>{
  if(!count)return[]
  const cents=Math.max(0,Math.round(Number(total||0)*100))
  const base=Math.floor(cents/count)
  const remainder=cents-base*count
  const out=Array(count).fill(base)
  for(let index=0;index<remainder;index+=1)out[index]+=1
  return out.map(value=>value/100)
}

function mapToOptions(map){
  const source=map||{}
  const legacyDefaults={Excellent:100,Good:80,Average:60,Poor:40,'Not achieved':0}
  const sourceKeys=Object.keys(source)
  const isLegacyPreset=sourceKeys.length===Object.keys(legacyDefaults).length&&Object.entries(legacyDefaults).every(([label,score])=>Number(source[label])===score)
  if(isLegacyPreset)return[]
  return Object.entries(source).map(([label,score])=>({label,score:Number(score)}))
}
const optionsToMap=rows=>Object.fromEntries((rows||[]).filter(row=>String(row.label||'').trim()).map(row=>[String(row.label).trim(),Number(row.score||0)]))
const wholeValue=value=>value===''||value===null||value===undefined?'':Math.round(Number(value))
const clamp100=value=>Math.max(0,Math.min(100,Math.round(Number(value||0))))

const newItem=()=>({
  question:'',task_responsibility:'',input_type:'number',score_base:100,minimum_score:0,
  frequency:'Monthly',measurement:'',choice_options:[],source:'',weight_basis:'Equal KPI average within KRA'
})

function ExpandingTextarea({value,onChange,...props}){
  const resize=element=>{
    if(!element)return
    element.style.height='auto'
    element.style.height=`${element.scrollHeight}px`
  }
  return <textarea {...props} className={`expanding-textarea ${props.className||''}`.trim()} rows={2} wrap="soft" value={value} ref={resize} onChange={event=>{resize(event.currentTarget);onChange(event)}}/>
}

export default function TemplateBuilderV2(){
  const[params]=useSearchParams(),navigate=useNavigate()
  const editId=params.get('edit'),departmentParam=params.get('department'),designationParam=params.get('designation')
  const[masters,setMasters]=useState([]),[name,setName]=useState(''),[department,setDepartment]=useState(''),[designation,setDesignation]=useState('')
  const[kras,setKras]=useState([{name:'New KRA',weight:100,items:[newItem()]}]),[error,setError]=useState('')
  const[fieldErrors,setFieldErrors]=useState({})

  const departments=useMemo(()=>masters.flatMap(parent=>parent.departments.map(dep=>({...dep,parent_division_id:parent.id}))).sort((a,b)=>a.name.localeCompare(b.name)),[masters])
  const selectedDepartment=departments.find(d=>String(d.id)===String(department))
  const designations=selectedDepartment?.designations||[]
  const total=useMemo(()=>Number(kras.reduce((sum,kra)=>sum+Number(kra.weight||0),0).toFixed(2)),[kras])

  useEffect(()=>{
    Promise.all([api.get('/admin/masters'),api.get('/kpi/templates')]).then(([m,t])=>{
      setMasters(m.data)
      if(departmentParam)setDepartment(String(departmentParam))
      if(designationParam)setDesignation(String(designationParam))
      if(editId){
        const found=t.data.find(x=>String(x.id)===String(editId))
        if(!found)throw new Error('Template not found')
        setName(found.name||'')
        setDepartment(found.department_id?String(found.department_id):'')
        setDesignation(found.designation_id?String(found.designation_id):'')
        setKras(found.kras.map(kra=>({
          name:kra.name,
          weight:wholeValue(kra.weight),
          items:kra.items.map(item=>{
            const cfg=item.config||{},meta=cfg.meta||{}
            const minimum=meta.minimum_score??meta.threshold_min??0
            return{
              question:item.question,
              task_responsibility:meta.task_responsibility||'',
              input_type:item.input_type==='choice'?'choice':'number',
              score_base:100,
              minimum_score:clamp100(minimum),
              frequency:meta.frequency||'Monthly',
              measurement:meta.measurement||'',
              choice_options:mapToOptions(cfg.score_map),
              source:meta.source||'',
              weight_basis:'Equal KPI average within KRA'
            }
          })
        })))
      }
    }).catch(e=>setError(getError(e)))
  },[editId,departmentParam,designationParam])

  function updateKra(ki,patch){setKras(cur=>cur.map((kra,index)=>index===ki?{...kra,...patch}:kra))}
  function updateItem(ki,ii,patch){setKras(cur=>cur.map((kra,kidx)=>kidx!==ki?kra:{...kra,items:kra.items.map((item,iidx)=>iidx===ii?{...item,...patch}:item)}))}
  function changeInputType(ki,ii,type){updateItem(ki,ii,{input_type:type,choice_options:type==='choice'?[]:kras[ki].items[ii].choice_options})}
  function addOption(ki,ii){const rows=kras[ki].items[ii].choice_options||[];updateItem(ki,ii,{choice_options:[...rows,{label:'',score:''}]})}
  function updateOption(ki,ii,oi,patch){const rows=kras[ki].items[ii].choice_options||[];updateItem(ki,ii,{choice_options:rows.map((row,index)=>index===oi?{...row,...patch}:row)})}
  function removeOption(ki,ii,oi){const rows=kras[ki].items[ii].choice_options||[];updateItem(ki,ii,{choice_options:rows.filter((_,index)=>index!==oi)})}
  function addMultipleOptions(ki,ii,count=5){const rows=kras[ki].items[ii].choice_options||[];updateItem(ki,ii,{choice_options:[...rows,...Array.from({length:count},()=>({label:'',score:''}))]})}

  function applyPreset(ki,ii,presetType){
    let presets=[]
    if(presetType==='5star')presets=[{label:'Excellent',score:100},{label:'Very Good',score:80},{label:'Good',score:60},{label:'Average',score:40},{label:'Poor',score:0}]
    else if(presetType==='3star')presets=[{label:'High',score:100},{label:'Medium',score:50},{label:'Low',score:0}]
    else if(presetType==='passfail')presets=[{label:'Achieved / Pass',score:100},{label:'Not Achieved / Fail',score:0}]
    else if(presetType==='numeric5')presets=[{label:'Option 1 (100)',score:100},{label:'Option 2 (75)',score:75},{label:'Option 3 (50)',score:50},{label:'Option 4 (25)',score:25},{label:'Option 5 (0)',score:0}]
    updateItem(ki,ii,{choice_options:presets})
  }

  function balanceAll(){
    const weights=splitWeight(100,kras.length)
    setKras(cur=>cur.map((kra,index)=>({...kra,weight:weights[index]})))
  }

  function addKra(){
    setKras(current=>{
      const next=[...current,{name:'New KRA',weight:0,items:[newItem()]}]
      const weights=splitWeight(100,next.length)
      return next.map((kra,index)=>({...kra,weight:weights[index]}))
    })
  }

  function validateItem(item,kraName){
    if(!item.question.trim())throw new Error(`${kraName}: every KPI needs a name`)
    const minimum=Number(item.minimum_score)
    if(!Number.isFinite(minimum)||minimum<0||minimum>100)throw new Error(`${item.question}: minimum score must be between 0 and 100`)
    if(item.input_type==='choice'){
      const options=item.choice_options||[]
      if(!options.length)throw new Error(`${item.question}: add at least one dropdown result`)
      const labels=options.map(row=>String(row.label||'').trim())
      if(labels.some(label=>!label))throw new Error(`${item.question}: every dropdown result needs a name`)
      if(new Set(labels.map(label=>label.toLowerCase())).size!==labels.length)throw new Error(`${item.question}: dropdown result names must be unique`)
      options.forEach(row=>{const score=Number(row.score);if(!Number.isFinite(score)||score<0||score>100)throw new Error(`${item.question}: each dropdown score must be between 0 and 100`)})
    }
  }

  function normalizedItem(item,contributionWeight){
    const minimum=clamp100(item.minimum_score)
    const meta={
      frequency:item.frequency||'Monthly',
      measurement:item.measurement||'',
      evidence_required:false,
      scoring_model:'kra_average_100',
      scoring_method:'direct_score_100',
      score_base:100,
      score_cap_pct:100,
      minimum_score:minimum,
      threshold_rule:minimum>0?'minimum':'none',
      threshold_min:minimum,
      threshold_max:null,
      source:item.source||'',
      weight_basis:'Equal KPI average within KRA',
      task_responsibility:(item.task_responsibility||item.question||'Complete assigned KPI task').trim(),
      score_limit:100
    }
    return{
      question:item.question.trim(),
      input_type:item.input_type,
      weight:Number(contributionWeight||0),
      target_value:item.input_type==='choice'?null:100,
      direction:'higher',
      options:{score_map:item.input_type==='choice'?optionsToMap(item.choice_options):{},meta}
    }
  }

  async function save(){
    setError('')
    try{
      const errors={}
      if(!name.trim())errors.name='Template name is required.'
      if(!department)errors.department='Select a department.'
      if(Object.keys(errors).length){setFieldErrors(errors);throw new Error('Complete the required fields highlighted in red.')}
      setFieldErrors({})
      if(total>100.001)throw new Error(`KRA total cannot exceed 100. Current total: ${total}`)
      if(!kras.length)throw new Error('Add at least one KRA')
      kras.forEach(kra=>{
        if(!kra.name.trim())throw new Error('Every KRA needs a name')
        if(Number(kra.weight||0)<0||Number(kra.weight||0)>100)throw new Error(`${kra.name}: KRA weight must be between 0 and 100`)
        if(!kra.items.length)throw new Error(`${kra.name}: add at least one KPI`)
        kra.items.forEach(item=>validateItem(item,kra.name))
      })
      const dep=departments.find(d=>String(d.id)===String(department))
      const payload={
        name:name.trim(),
        division_id:dep?.parent_division_id?Number(dep.parent_division_id):null,
        department_id:Number(department),
        designation_id:designation?Number(designation):null,
        kras:kras.map(kra=>{
          const shares=splitContribution(kra.weight,kra.items.length)
          return{name:kra.name.trim(),weight:Number(kra.weight||0),items:kra.items.map((item,index)=>normalizedItem(item,shares[index]))}
        })
      }
      if(editId)await api.put(`/kpi/templates/${editId}`,payload);else await api.post('/kpi/templates',payload)
      navigate('/templates')
    }catch(e){setError(getError(e))}
  }

  return<>
    <PageHeader title={editId?'Edit KPI Template':'Create KPI Template'} subtitle="KRA weights total 100. Every KPI inside a KRA is scored independently out of 100, then the KPI scores are averaged to calculate that KRA's weighted contribution." actions={<div className="responsive-actions"><button className="secondary" onClick={()=>navigate('/templates')}><ArrowLeft size={16}/>Back</button><button className="secondary" onClick={balanceAll}><Equal size={16}/>Auto-balance KRA weights</button><button className="primary" onClick={save}><Save size={16}/>{editId?'Save draft changes':'Save draft template'}</button></div>}/>
    <ErrorBox error={error}/>

    <Card>
      <div className="section-heading"><div><h3>Choose Department</h3><p className="muted small-copy">Department is the main hierarchy used to assign KPI templates.</p></div></div>
      <div className="form-grid two-responsive">
        <label>Department <span className="required-mark">*</span><select className={fieldErrors.department?'field-invalid':''} aria-invalid={Boolean(fieldErrors.department)} value={department} onChange={e=>{setDepartment(e.target.value);setDesignation('');setFieldErrors(x=>({...x,department:''}))}}><option value="">Select department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>{fieldErrors.department?<span className="field-error">{fieldErrors.department}</span>:null}</label>
        <label>Role / designation<select value={designation} onChange={e=>setDesignation(e.target.value)} disabled={!department}><option value="">All roles in department</option>{designations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>
    </Card>

    <Card>
      <div className="form-grid"><label>Template name <span className="required-mark">*</span><input className={fieldErrors.name?'field-invalid':''} aria-invalid={Boolean(fieldErrors.name)} value={name} onChange={e=>{setName(e.target.value);setFieldErrors(x=>({...x,name:''}))}} placeholder="e.g. AVP Monthly KPI"/>{fieldErrors.name?<span className="field-error">{fieldErrors.name}</span>:null}</label><label>Department<input value={selectedDepartment?.name||''} disabled/></label><label>Total KRA weight<input value={`${total} / 100`} disabled className={Math.abs(total-100)<0.001?'valid-field':'invalid-field'}/></label></div>
      <div className="helper-strip"><strong>Scoring formula:</strong> each KPI = score out of 100. If its score is below the configured minimum, that KPI becomes 0. <strong>KRA contribution = average of KPI scores × KRA weight ÷ 100.</strong> Final score is the sum of all KRA contributions, out of 100.</div>
    </Card>

    <div className="stack">{kras.map((kra,ki)=><Card key={ki}>
      <div className="kra-title"><div className="inline-fields"><input className="title-input" value={kra.name} onChange={e=>updateKra(ki,{name:e.target.value})}/><input className="weight-input no-spinner" type="number" min="0" max="100" step="1" value={kra.weight} onChange={e=>updateKra(ki,{weight:e.target.value===''?0:Math.round(Number(e.target.value))})}/><span>KRA weight</span></div><div className="row-actions"><span className="weight-chip">{kra.items.length} KPI{kra.items.length===1?'':'s'} · each /100</span><button className="icon-button danger" onClick={()=>setKras(cur=>cur.filter((_,index)=>index!==ki))}><Trash2 size={15}/></button></div></div>
      <div className="dynamic-kpi-list">{kra.items.map((item,ii)=><div className="dynamic-kpi is-open" key={ii}>
        <div className="dynamic-kpi-head"><strong>KPI {ii+1}: {item.question||'Untitled KPI'}</strong><button className="icon-button danger" onClick={()=>updateKra(ki,{items:kra.items.filter((_,index)=>index!==ii)})}><Trash2 size={14}/></button></div>
        <div className="form-grid four">
          <label className="span-2">KPI name<ExpandingTextarea value={item.question} onChange={e=>updateItem(ki,ii,{question:e.target.value})} placeholder="Enter KPI name"/></label>
          <label className="span-2">Task responsibility<ExpandingTextarea value={item.task_responsibility} onChange={e=>updateItem(ki,ii,{task_responsibility:e.target.value})} placeholder="What should the employee achieve?"/></label>
          <label>Input type<select value={item.input_type} onChange={e=>changeInputType(ki,ii,e.target.value)}><option value="number">Score (0–100)</option><option value="choice">Custom Dropdown</option></select></label>
          <label>KPI score base<input value="100" disabled/><span className="cell-help">Every KPI is always scored out of 100.</span></label>
          <label>Minimum qualifying score<input type="number" min="0" max="100" step="1" value={item.minimum_score} onChange={e=>updateItem(ki,ii,{minimum_score:e.target.value===''?0:clamp100(e.target.value)})} placeholder="0"/><span className="cell-help">Default 0. Score below this becomes 0.</span></label>
          <label>Review frequency<select value={item.frequency} onChange={e=>updateItem(ki,ii,{frequency:e.target.value})}><option>Monthly</option><option>Quarterly</option><option>Half-Yearly</option><option>Annual</option></select></label>

          {item.input_type==='choice'?<div className="span-4 custom-results-panel">
            <div className="custom-results-head"><div><strong>Dropdown results and score out of 100</strong><div className="cell-help">Each option assigns a KPI score from 0 to 100; the minimum qualifying score is then applied.</div></div><div className="responsive-actions"><button type="button" className="secondary small" onClick={()=>addOption(ki,ii)}><Plus size={13}/>Add result</button><button type="button" className="secondary small" onClick={()=>addMultipleOptions(ki,ii,5)}>+ Add 5 fields</button></div></div>
            <div className="quick-presets"><strong>Quick presets:</strong><button type="button" className="text-action" onClick={()=>applyPreset(ki,ii,'5star')}>5-Level</button><button type="button" className="text-action" onClick={()=>applyPreset(ki,ii,'3star')}>3-Level</button><button type="button" className="text-action" onClick={()=>applyPreset(ki,ii,'passfail')}>Pass/Fail</button><button type="button" className="text-action" onClick={()=>applyPreset(ki,ii,'numeric5')}>5 Custom Options</button></div>
            {(item.choice_options||[]).length===0?<div className="helper-strip">No results added yet. Add one or choose a quick preset.</div>:null}
            <div className="custom-result-grid">{(item.choice_options||[]).map((row,oi)=><div key={oi} className="custom-result-row"><label>Result / option name<input value={row.label} onChange={e=>updateOption(ki,ii,oi,{label:e.target.value})} placeholder="Result name"/></label><label>Score / 100<input type="number" min="0" max="100" step="1" value={row.score} onChange={e=>updateOption(ki,ii,oi,{score:e.target.value===''?'':clamp100(e.target.value)})} placeholder="0-100"/></label><button type="button" className="icon-button danger" title="Remove result" onClick={()=>removeOption(ki,ii,oi)}><Trash2 size={14}/></button></div>)}</div>
          </div>:null}

          <label className="span-2">Measurement / guidance<ExpandingTextarea value={item.measurement} onChange={e=>updateItem(ki,ii,{measurement:e.target.value})} placeholder="Explain how the 0-100 KPI score should be decided"/></label>
          <label>Source<ExpandingTextarea value={item.source} onChange={e=>updateItem(ki,ii,{source:e.target.value})} placeholder="Policy / task system / manager"/></label>
          <label>Weighting method<input value="Equal average inside this KRA" disabled/></label>
        </div>
      </div>)}</div>
      <button className="text-action" onClick={()=>updateKra(ki,{items:[...kra.items,newItem()]})}><Plus size={15}/>Add KPI parameter</button>
    </Card>)}</div>

    <div className="footer-actions"><button className="secondary" onClick={addKra}><Plus size={16}/>Add KRA</button><button className="primary" onClick={save}><Save size={16}/>{editId?'Save draft changes':'Save draft template'}</button></div>
  </>
}
