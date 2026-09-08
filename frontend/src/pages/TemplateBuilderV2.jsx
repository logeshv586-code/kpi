import {useEffect,useMemo,useState} from 'react'
import {ArrowLeft,Equal,Plus,Save,Trash2} from 'lucide-react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {api,getError} from '../lib/api'
import {Card,ErrorBox,PageHeader} from '../components/UI'

const splitWeight=(total,count)=>{
  if(!count)return[]
  const base=Math.floor((Number(total||0)/count)*100)/100
  const out=Array(count).fill(base)
  out[count-1]=Number((Number(total||0)-base*(count-1)).toFixed(2))
  return out
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
const numericTypes=['number','count','currency','percentage','days']
const defaultUnit=type=>({number:'units',count:'count',currency:'₹',percentage:'%',days:'days'}[type]||'')

const newItem=(weight=100)=>({
  question:'',task_responsibility:'',input_type:'number',weight,target_value:100,direction:'higher',
  threshold_rule:'none',threshold_min:'',threshold_max:'',frequency:'Monthly',unit:'units',measurement:'',choice_options:[],source:'',weight_basis:'Configured by HR'
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
  const[kras,setKras]=useState([{name:'New KRA',weight:100,items:[newItem(100)]}]),[error,setError]=useState('')
  const[fieldErrors,setFieldErrors]=useState({})

  const departments=useMemo(()=>masters.flatMap(parent=>parent.departments.map(dep=>({...dep,parent_division_id:parent.id}))).sort((a,b)=>a.name.localeCompare(b.name)),[masters])
  const selectedDepartment=departments.find(d=>String(d.id)===String(department))
  const designations=selectedDepartment?.designations||[]
  const total=useMemo(()=>Number(kras.reduce((s,k)=>s+Number(k.weight||0),0).toFixed(2)),[kras])

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
        setKras(found.kras.map(k=>({
          name:k.name,weight:k.weight,items:k.items.map(i=>{
            const cfg=i.config||{},meta=cfg.meta||{}
            const inputType=[...numericTypes,'choice'].includes(i.input_type)?i.input_type:'number'
            return{
              question:i.question,
              task_responsibility:meta.task_responsibility||'',
              input_type:inputType,
              weight:i.weight,
              target_value:i.target_value??(inputType==='percentage'?100:''),
              direction:i.direction||'higher',
              threshold_rule:meta.threshold_rule||'none',
              threshold_min:meta.threshold_min??'',
              threshold_max:meta.threshold_max??'',
              frequency:meta.frequency||'Monthly',
              unit:meta.unit||defaultUnit(inputType),
              measurement:meta.measurement||'',
              choice_options:mapToOptions(cfg.score_map),
              source:meta.source||'',
              weight_basis:meta.weight_basis||'Configured by HR'
            }
          })
        })))
      }
    }).catch(e=>setError(getError(e)))
  },[editId,departmentParam,designationParam])

  function updateKra(ki,patch){setKras(cur=>cur.map((k,i)=>i===ki?{...k,...patch}:k))}
  function updateItem(ki,ii,patch){setKras(cur=>cur.map((k,kidx)=>kidx!==ki?k:{...k,items:k.items.map((item,iidx)=>iidx===ii?{...item,...patch}:item)}))}

  function changeInputType(ki,ii,type){
    const item=kras[ki].items[ii]
    const patch={input_type:type}
    if(type==='choice')Object.assign(patch,{target_value:'',unit:'',direction:'higher',threshold_rule:'none',threshold_min:'',threshold_max:'',choice_options:[]})
    else Object.assign(patch,{target_value:item.target_value===''||item.target_value==null?(type==='percentage'?100:100):item.target_value,unit:defaultUnit(type),direction:item.direction||'higher'})
    updateItem(ki,ii,patch)
  }

  function addOption(ki,ii){const rows=kras[ki].items[ii].choice_options||[];updateItem(ki,ii,{choice_options:[...rows,{label:'',score:''}]})}
  function updateOption(ki,ii,oi,patch){const rows=kras[ki].items[ii].choice_options||[];updateItem(ki,ii,{choice_options:rows.map((r,i)=>i===oi?{...r,...patch}:r)})}
  function removeOption(ki,ii,oi){const rows=kras[ki].items[ii].choice_options||[];updateItem(ki,ii,{choice_options:rows.filter((_,i)=>i!==oi)})}
  function addMultipleOptions(ki,ii,count=5){const rows=kras[ki].items[ii].choice_options||[];updateItem(ki,ii,{choice_options:[...rows,...Array.from({length:count},()=>({label:'',score:''}))]})}

  function applyPreset(ki,ii,presetType){
    let presets=[]
    if(presetType==='5star')presets=[{label:'Excellent',score:100},{label:'Very Good',score:80},{label:'Good',score:60},{label:'Average',score:40},{label:'Poor',score:0}]
    else if(presetType==='3star')presets=[{label:'High',score:100},{label:'Medium',score:50},{label:'Low',score:0}]
    else if(presetType==='passfail')presets=[{label:'Achieved / Pass',score:100},{label:'Not Achieved / Fail',score:0}]
    else if(presetType==='numeric5')presets=[{label:'Option 1 (100%)',score:100},{label:'Option 2 (75%)',score:75},{label:'Option 3 (50%)',score:50},{label:'Option 4 (25%)',score:25},{label:'Option 5 (0%)',score:0}]
    updateItem(ki,ii,{choice_options:presets})
  }

  function balanceAll(){
    const kws=splitWeight(100,kras.length)
    setKras(cur=>cur.map((k,ki)=>{const iws=splitWeight(kws[ki],k.items.length);return{...k,weight:kws[ki],items:k.items.map((it,ii)=>({...it,weight:iws[ii]}))}}))
  }
  function balanceItems(ki){setKras(cur=>cur.map((k,i)=>{if(i!==ki)return k;const weights=splitWeight(k.weight,k.items.length);return{...k,items:k.items.map((it,ii)=>({...it,weight:weights[ii]}))}}))}
  function addKra(){
    setKras(current=>{
      const next=[...current,{name:'New KRA',weight:0,items:[newItem(0)]}],kraWeights=splitWeight(100,next.length)
      return next.map((kra,ki)=>{const itemWeights=splitWeight(kraWeights[ki],kra.items.length);return{...kra,weight:kraWeights[ki],items:kra.items.map((item,ii)=>({...item,weight:itemWeights[ii]}))}})
    })
  }

  function validateItem(item,kraName){
    if(!item.question.trim())throw new Error(`${kraName}: every KPI needs a name`)
    if(Number(item.weight||0)<=0)throw new Error(`${item.question}: weight must be greater than 0`)
    if(numericTypes.includes(item.input_type)){
      const target=Number(item.target_value)
      if(!Number.isFinite(target)||target<0)throw new Error(`${item.question}: enter a valid expected target`)
      const min=item.threshold_min===''?null:Number(item.threshold_min),max=item.threshold_max===''?null:Number(item.threshold_max)
      if(min!==null&&!Number.isFinite(min))throw new Error(`${item.question}: enter a valid minimum threshold`)
      if(max!==null&&!Number.isFinite(max))throw new Error(`${item.question}: enter a valid maximum threshold`)
      if(min!==null&&max!==null&&min>max)throw new Error(`${item.question}: minimum threshold cannot be greater than maximum threshold`)
      if(item.threshold_rule==='minimum'&&min===null)throw new Error(`${item.question}: minimum threshold is required`)
      if(item.threshold_rule==='maximum'&&max===null)throw new Error(`${item.question}: maximum threshold is required`)
      if(item.threshold_rule==='range'&&min===null&&max===null)throw new Error(`${item.question}: enter a minimum or maximum threshold`)
      if(item.input_type==='percentage'&&[min,max].filter(v=>v!==null).some(v=>v<0||v>100))throw new Error(`${item.question}: percentage thresholds must be between 0 and 100`)
    }
    if(item.input_type==='choice'){
      const options=item.choice_options||[]
      if(!options.length)throw new Error(`${item.question}: click Add result and create at least one dropdown result`)
      const labels=options.map(x=>String(x.label||'').trim())
      if(labels.some(x=>!x))throw new Error(`${item.question}: every dropdown result needs a name`)
      if(new Set(labels.map(x=>x.toLowerCase())).size!==labels.length)throw new Error(`${item.question}: dropdown result names must be unique`)
      options.forEach(row=>{const score=Number(row.score);if(!Number.isFinite(score)||score<0||score>100)throw new Error(`${item.question}: each dropdown score must be between 0 and 100%`)})
    }
  }

  function normalizedItem(item){
    const numeric=numericTypes.includes(item.input_type)
    const meta={
      frequency:item.frequency||'Monthly',unit:item.unit||'',measurement:item.measurement||'',evidence_required:false,
      scoring_method:'target_ratio',score_cap_pct:100,source:item.source||'',weight_basis:item.weight_basis||'Configured by HR',
      task_responsibility:(item.task_responsibility||item.question||'Complete assigned KPI task').trim(),score_limit:Number(item.weight||0),
      threshold_rule:numeric?(item.threshold_rule||'none'):'none',
      threshold_min:numeric&&item.threshold_min!==''?Number(item.threshold_min):null,
      threshold_max:numeric&&item.threshold_max!==''?Number(item.threshold_max):null
    }
    return{
      question:item.question.trim(),input_type:item.input_type,weight:Number(item.weight||0),
      target_value:item.input_type==='choice'||item.target_value===''?null:Number(item.target_value),direction:item.direction,
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
      kras.forEach(k=>{
        if(!k.name.trim())throw new Error('Every KRA needs a name')
        if(!k.items.length)throw new Error(`${k.name}: add at least one KPI`)
        const subtotal=Number(k.items.reduce((s,i)=>s+Number(i.weight||0),0).toFixed(2))
        if(subtotal>Number(k.weight)+0.001)throw new Error(`${k.name}: KPI weights cannot exceed ${k.weight}. Current total: ${subtotal}`)
        k.items.forEach(i=>validateItem(i,k.name))
      })
      const dep=departments.find(d=>String(d.id)===String(department))
      const payload={name:name.trim(),division_id:dep?.parent_division_id?Number(dep.parent_division_id):null,department_id:Number(department),designation_id:designation?Number(designation):null,kras:kras.map(k=>({name:k.name.trim(),weight:Number(k.weight||0),items:k.items.map(normalizedItem)}))}
      if(editId)await api.put(`/kpi/templates/${editId}`,payload);else await api.post('/kpi/templates',payload)
      navigate('/templates')
    }catch(e){setError(getError(e))}
  }

  return<>
    <PageHeader title={editId?'Edit KPI Template':'Create KPI Template'} subtitle="Set measurable KPI targets plus optional minimum / maximum qualification thresholds." actions={<div className="responsive-actions"><button className="secondary" onClick={()=>navigate('/templates')}><ArrowLeft size={16}/>Back</button><button className="secondary" onClick={balanceAll}><Equal size={16}/>Auto-balance marks</button><button className="primary" onClick={save}><Save size={16}/>{editId?'Save draft changes':'Save draft template'}</button></div>}/>
    <ErrorBox error={error}/>

    <Card>
      <div className="section-heading"><div><h3>Choose Department</h3><p className="muted small-copy">Department is the main hierarchy used to assign KPI templates.</p></div></div>
      <div className="form-grid two-responsive">
        <label>Department <span className="required-mark">*</span><select className={fieldErrors.department?'field-invalid':''} aria-invalid={Boolean(fieldErrors.department)} value={department} onChange={e=>{setDepartment(e.target.value);setDesignation('');setFieldErrors(x=>({...x,department:''}))}}><option value="">Select department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>{fieldErrors.department?<span className="field-error">{fieldErrors.department}</span>:null}</label>
        <label>Role / designation<select value={designation} onChange={e=>setDesignation(e.target.value)} disabled={!department}><option value="">All roles in department</option>{designations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>
    </Card>

    <Card>
      <div className="form-grid"><label>Template name <span className="required-mark">*</span><input className={fieldErrors.name?'field-invalid':''} aria-invalid={Boolean(fieldErrors.name)} value={name} onChange={e=>{setName(e.target.value);setFieldErrors(x=>({...x,name:''}))}} placeholder="e.g. Customer Support KPI"/>{fieldErrors.name?<span className="field-error">{fieldErrors.name}</span>:null}</label><label>Department<input value={selectedDepartment?.name||''} disabled/></label><label>Total weight<input value={`${total} / 100`} disabled className={Math.abs(total-100)<0.001?'valid-field':'invalid-field'}/></label></div>
      <div className="helper-strip"><strong>Scoring:</strong> staff enter only the achieved value. The system calculates achievement and whole-number marks. When a minimum / maximum threshold is configured and not met, that KPI receives <strong>0 marks</strong>.</div>
    </Card>

    <div className="stack">{kras.map((kra,ki)=><Card key={ki}>
      <div className="kra-title"><div className="inline-fields"><input className="title-input" value={kra.name} onChange={e=>updateKra(ki,{name:e.target.value})}/><input className="weight-input no-spinner" type="number" min="0" max="100" step="1" value={kra.weight} onChange={e=>updateKra(ki,{weight:Number(e.target.value)})}/><span>marks</span></div><div className="row-actions"><button className="secondary small" onClick={()=>balanceItems(ki)}><Equal size={14}/>Balance KPIs</button><button className="icon-button danger" onClick={()=>setKras(cur=>cur.filter((_,i)=>i!==ki))}><Trash2 size={15}/></button></div></div>
      <div className="dynamic-kpi-list">{kra.items.map((item,ii)=><div className="dynamic-kpi is-open" key={ii}>
        <div className="dynamic-kpi-head"><strong>KPI {ii+1}: {item.question||'Untitled KPI'}</strong><button className="icon-button danger" onClick={()=>updateKra(ki,{items:kra.items.filter((_,x)=>x!==ii)})}><Trash2 size={14}/></button></div>
        <div className="form-grid four">
          <label className="span-2">KPI name<ExpandingTextarea value={item.question} onChange={e=>updateItem(ki,ii,{question:e.target.value})} placeholder="Enter measurable KPI name"/></label>
          <label className="span-2">Task responsibility<ExpandingTextarea value={item.task_responsibility} onChange={e=>updateItem(ki,ii,{task_responsibility:e.target.value})} placeholder="What should the employee complete?"/></label>
          <label>Measurement type<select value={item.input_type} onChange={e=>changeInputType(ki,ii,e.target.value)}><option value="number">Number</option><option value="count">Quantity / Count</option><option value="currency">Currency</option><option value="percentage">Percentage</option><option value="days">Days / Time</option><option value="choice">Custom Dropdown</option></select></label>
          <label>Weight / marks<input type="text" inputMode="numeric" pattern="[0-9]*" value={item.weight} onChange={e=>{const digits=e.target.value.replace(/\D/g,'');updateItem(ki,ii,{weight:digits===''?0:Number(digits)})}}/></label>

          {numericTypes.includes(item.input_type)?<>
            <label>Target / goal *<input className="no-spinner" type="number" min="0" step={item.input_type==='count'?'1':'0.01'} value={item.target_value??''} onChange={e=>updateItem(ki,ii,{target_value:e.target.value})} placeholder={item.input_type==='percentage'?'100':'e.g. 100'}/></label>
            <label>Unit<input value={item.unit} onChange={e=>updateItem(ki,ii,{unit:e.target.value})} placeholder={defaultUnit(item.input_type)}/></label>
            <label>Scoring direction<select value={item.direction} onChange={e=>updateItem(ki,ii,{direction:e.target.value})}><option value="higher">Higher result is better</option><option value="lower">Lower result is better</option></select></label>
            <label>Threshold rule<select value={item.threshold_rule} onChange={e=>updateItem(ki,ii,{threshold_rule:e.target.value})}><option value="none">No hard threshold</option><option value="minimum">Minimum required</option><option value="maximum">Maximum allowed</option><option value="range">Acceptable range</option></select></label>
            {['minimum','range'].includes(item.threshold_rule)?<label>Minimum threshold<input type="number" min="0" step={item.input_type==='count'?'1':'0.01'} value={item.threshold_min} onChange={e=>updateItem(ki,ii,{threshold_min:e.target.value})} placeholder="Minimum acceptable"/></label>:null}
            {['maximum','range'].includes(item.threshold_rule)?<label>Maximum threshold<input type="number" min="0" step={item.input_type==='count'?'1':'0.01'} value={item.threshold_max} onChange={e=>updateItem(ki,ii,{threshold_max:e.target.value})} placeholder="Maximum allowed"/></label>:null}
            {item.threshold_rule!=='none'?<div className="span-2 helper-strip threshold-helper"><strong>Qualification:</strong> a result outside this threshold receives 0 marks and is shown as Not Achieved.</div>:null}
          </>:null}

          {item.input_type==='choice'?<div className="span-2 custom-results-panel">
            <div className="custom-results-head"><div><strong>Custom results shown to employee</strong><div className="cell-help">{(item.choice_options||[]).length} option fields added</div></div><div className="responsive-actions"><button type="button" className="secondary small" onClick={()=>addOption(ki,ii)}><Plus size={13}/>Add result</button><button type="button" className="secondary small" onClick={()=>addMultipleOptions(ki,ii,5)}>+ Add 5 fields</button></div></div>
            <div className="quick-presets"><strong>Quick presets:</strong><button type="button" className="text-action" onClick={()=>applyPreset(ki,ii,'5star')}>5-Level</button><button type="button" className="text-action" onClick={()=>applyPreset(ki,ii,'3star')}>3-Level</button><button type="button" className="text-action" onClick={()=>applyPreset(ki,ii,'passfail')}>Pass/Fail</button><button type="button" className="text-action" onClick={()=>applyPreset(ki,ii,'numeric5')}>5 Custom Options</button></div>
            {(item.choice_options||[]).length===0?<div className="helper-strip">No results added yet. Click <strong>Add result</strong> or choose a quick preset.</div>:null}
            <div className="custom-result-grid">{(item.choice_options||[]).map((row,oi)=><div key={oi} className="custom-result-row"><label>Result / option name<input value={row.label} onChange={e=>updateOption(ki,ii,oi,{label:e.target.value})} placeholder="Result name"/></label><label>Score %<input type="number" min="0" max="100" step="1" value={row.score} onChange={e=>updateOption(ki,ii,oi,{score:e.target.value})} placeholder="0-100"/></label><button type="button" className="icon-button danger" title="Remove result" onClick={()=>removeOption(ki,ii,oi)}><Trash2 size={14}/></button></div>)}</div>
          </div>:null}

          <label>Review frequency<select value={item.frequency} onChange={e=>updateItem(ki,ii,{frequency:e.target.value})}><option>Monthly</option><option>Quarterly</option><option>Half-Yearly</option><option>Annual</option></select></label>
          <label className="span-2">Measurement / guidance<ExpandingTextarea value={item.measurement} onChange={e=>updateItem(ki,ii,{measurement:e.target.value})} placeholder="Explain exactly what is measured"/></label>
          <label>Source<ExpandingTextarea value={item.source} onChange={e=>updateItem(ki,ii,{source:e.target.value})} placeholder="Policy / task system / manager"/></label>
          <label>Weight basis<ExpandingTextarea value={item.weight_basis} onChange={e=>updateItem(ki,ii,{weight_basis:e.target.value})}/></label>
        </div>
      </div>)}</div>
      <button className="text-action" onClick={()=>updateKra(ki,{items:[...kra.items,newItem(10)]})}><Plus size={15}/>Add KPI parameter</button>
    </Card>)}</div>

    <div className="footer-actions"><button className="secondary" onClick={addKra}><Plus size={16}/>Add KRA</button><button className="primary" onClick={save}><Save size={16}/>{editId?'Save draft changes':'Save draft template'}</button></div>
  </>
}
