import {useEffect,useMemo,useState} from 'react'
import {ArrowLeft,Equal,Plus,Save,Trash2} from 'lucide-react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {api,getError} from '../lib/api'
import {Card,ErrorBox,PageHeader} from '../components/UI'

const measurementTypes=[
  ['number','Number'],
  ['count','Quantity / Count'],
  ['currency','Currency'],
  ['percentage','Percentage'],
  ['days','Days / Time'],
  ['choice','Custom Dropdown']
]
const defaultUnits={number:'units',count:'units',currency:'INR',percentage:'%',days:'days',choice:''}

const splitWeight=(total,count)=>{
  if(!count)return[]
  const wholeTotal=Math.max(0,Math.round(Number(total||0)))
  const base=Math.floor(wholeTotal/count)
  const remainder=wholeTotal-base*count
  const out=Array(count).fill(base)
  for(let index=0;index<remainder;index+=1)out[index]+=1
  return out
}

const contributionShares=(kraWeight,count)=>{
  if(!count)return[]
  const share=Number(kraWeight||0)/count
  return Array(count).fill(share)
}

const whole=value=>Math.max(0,Math.round(Number(value||0)))
const clamp100=value=>Math.max(0,Math.min(100,whole(value)))
const wholeValue=value=>value===''||value===null||value===undefined?'':Math.round(Number(value))
const optionsToMap=rows=>Object.fromEntries((rows||[]).filter(row=>String(row.label||'').trim()).map(row=>[String(row.label).trim(),clamp100(row.score)]))
const mapToOptions=map=>Object.entries(map||{}).map(([label,score])=>({label,score:clamp100(score)}))

const newItem=()=>({
  question:'',task_responsibility:'',input_type:'number',unit:'units',direction:'higher',target_value:100,
  qualifying_value:0,frequency:'Monthly',measurement:'',source:'',choice_options:[]
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
  const total=useMemo(()=>kras.reduce((sum,kra)=>sum+Math.round(Number(kra.weight||0)),0),[kras])

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
            const meta=item.config?.meta||{}
            const currentType=measurementTypes.some(([value])=>value===item.input_type)?item.input_type:'number'
            const oldMinimum=meta.minimum_score??meta.threshold_min??0
            const measurementTarget=meta.scoring_method==='measurement_target'
            return{
              question:item.question,
              task_responsibility:meta.task_responsibility||'',
              input_type:currentType,
              unit:meta.unit||defaultUnits[currentType]||'units',
              direction:item.direction==='lower'?'lower':'higher',
              target_value:whole(item.target_value??100),
              qualifying_value:whole(measurementTarget?(meta.qualifying_value??0):oldMinimum),
              frequency:meta.frequency||'Monthly',
              measurement:meta.measurement||'',
              source:meta.source||'',
              choice_options:mapToOptions(item.config?.score_map)
            }
          })
        })))
      }
    }).catch(e=>setError(getError(e)))
  },[editId,departmentParam,designationParam])

  function updateKra(ki,patch){setKras(cur=>cur.map((kra,index)=>index===ki?{...kra,...patch}:kra))}
  function updateItem(ki,ii,patch){setKras(cur=>cur.map((kra,kidx)=>kidx!==ki?kra:{...kra,items:kra.items.map((item,iidx)=>iidx===ii?{...item,...patch}:item)}))}
  function changeMeasurementType(ki,ii,type){
    const current=kras[ki].items[ii]
    updateItem(ki,ii,{input_type:type,unit:defaultUnits[type]??current.unit,choice_options:type==='choice'?(current.choice_options||[]):current.choice_options})
  }
  function addOption(ki,ii){const rows=kras[ki].items[ii].choice_options||[];updateItem(ki,ii,{choice_options:[...rows,{label:'',score:''}]})}
  function addFiveOptions(ki,ii){const rows=kras[ki].items[ii].choice_options||[];updateItem(ki,ii,{choice_options:[...rows,...Array.from({length:5},()=>({label:'',score:''}))]})}
  function updateOption(ki,ii,oi,patch){const rows=kras[ki].items[ii].choice_options||[];updateItem(ki,ii,{choice_options:rows.map((row,index)=>index===oi?{...row,...patch}:row)})}
  function removeOption(ki,ii,oi){const rows=kras[ki].items[ii].choice_options||[];updateItem(ki,ii,{choice_options:rows.filter((_,index)=>index!==oi)})}

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
    if(item.input_type==='choice'){
      if(!(item.choice_options||[]).length)throw new Error(`${item.question}: add at least one dropdown result`)
      const labels=item.choice_options.map(row=>String(row.label||'').trim())
      if(labels.some(label=>!label))throw new Error(`${item.question}: every dropdown result needs a name`)
      if(new Set(labels.map(label=>label.toLowerCase())).size!==labels.length)throw new Error(`${item.question}: dropdown result names must be unique`)
      item.choice_options.forEach(row=>{if(!Number.isInteger(Number(row.score))||Number(row.score)<0||Number(row.score)>100)throw new Error(`${item.question}: every dropdown mark must be a whole number from 0 to 100`)})
      return
    }
    const target=Number(item.target_value),qualifier=Number(item.qualifying_value)
    if(!Number.isInteger(target)||target<=0)throw new Error(`${item.question}: target for 100 marks must be a positive whole number`)
    if(!Number.isInteger(qualifier)||qualifier<0)throw new Error(`${item.question}: qualifying value must be 0 or a positive whole number`)
    if(!String(item.unit||'').trim())throw new Error(`${item.question}: enter a unit for the selected measurement type`)
  }

  function normalizedItem(item,contributionWeight){
    const choice=item.input_type==='choice'
    const qualifier=choice?0:whole(item.qualifying_value)
    return{
      question:item.question.trim(),
      input_type:item.input_type,
      weight:Number(contributionWeight||0),
      target_value:choice?null:whole(item.target_value),
      direction:choice?'higher':item.direction,
      options:{
        score_map:choice?optionsToMap(item.choice_options):{},
        meta:{
          frequency:item.frequency||'Monthly',
          measurement:item.measurement||'',
          measurement_type:item.input_type,
          unit:choice?'':String(item.unit||'').trim(),
          evidence_required:false,
          scoring_model:'kra_average_100',
          scoring_method:choice?'choice_map':'measurement_target',
          score_base:100,
          marks:100,
          score_cap_pct:100,
          qualifying_value:qualifier,
          qualification_direction:choice?'none':item.direction,
          minimum_score:0,
          threshold_rule:'none',
          threshold_min:null,
          threshold_max:null,
          source:item.source||'',
          weight_basis:'Equal KPI average within KRA',
          task_responsibility:(item.task_responsibility||item.question||'Complete assigned KPI task').trim(),
          score_limit:100
        }
      }
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
      if(total!==100)throw new Error(`KRA total must equal 100. Current total: ${total}`)
      if(!kras.length)throw new Error('Add at least one KRA')
      kras.forEach(kra=>{
        if(!kra.name.trim())throw new Error('Every KRA needs a name')
        const weight=Number(kra.weight)
        if(!Number.isInteger(weight)||weight<=0||weight>100)throw new Error(`${kra.name}: KRA weight must be a whole number from 1 to 100`)
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
          const shares=contributionShares(kra.weight,kra.items.length)
          return{name:kra.name.trim(),weight:Number(kra.weight),items:kra.items.map((item,index)=>normalizedItem(item,shares[index]))}
        })
      }
      if(editId)await api.put(`/kpi/templates/${editId}`,payload);else await api.post('/kpi/templates',payload)
      navigate('/templates')
    }catch(e){setError(getError(e))}
  }

  return<>
    <PageHeader title={editId?'Edit KPI Template':'Create KPI Template'} subtitle="KRA weights total 100. Every KPI carries 100 marks, but the measurement can be Number, Quantity, Currency, Percentage, Days/Time, or a Custom Dropdown." actions={<div className="responsive-actions"><button className="secondary" onClick={()=>navigate('/templates')}><ArrowLeft size={16}/>Back</button><button className="secondary" onClick={balanceAll}><Equal size={16}/>Auto-balance KRA weights</button><button className="primary" onClick={save}><Save size={16}/>{editId?'Save draft changes':'Save draft template'}</button></div>}/>
    <ErrorBox error={error}/>

    <Card>
      <div className="section-heading"><div><h3>Choose Department</h3><p className="muted small-copy">Department is the main hierarchy used to assign KPI templates.</p></div></div>
      <div className="form-grid two-responsive">
        <label>Department <span className="required-mark">*</span><select className={fieldErrors.department?'field-invalid':''} aria-invalid={Boolean(fieldErrors.department)} value={department} onChange={e=>{setDepartment(e.target.value);setDesignation('');setFieldErrors(x=>({...x,department:''}))}}><option value="">Select department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>{fieldErrors.department?<span className="field-error">{fieldErrors.department}</span>:null}</label>
        <label>Role / designation<select value={designation} onChange={e=>setDesignation(e.target.value)} disabled={!department}><option value="">All roles in department</option>{designations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>
    </Card>

    <Card>
      <div className="form-grid"><label>Template name <span className="required-mark">*</span><input className={fieldErrors.name?'field-invalid':''} aria-invalid={Boolean(fieldErrors.name)} value={name} onChange={e=>{setName(e.target.value);setFieldErrors(x=>({...x,name:''}))}} placeholder="e.g. AVP Monthly KPI"/>{fieldErrors.name?<span className="field-error">{fieldErrors.name}</span>:null}</label><label>Department<input value={selectedDepartment?.name||''} disabled/></label><label>Total KRA weight<input value={`${total} / 100`} disabled className={total===100?'valid-field':'invalid-field'}/></label></div>
      <div className="helper-strip"><strong>Scoring:</strong> set a target value that equals 100 marks. Employee enters the actual achieved value in the selected unit. The system converts actual vs target into a whole-number KPI mark out of 100, applies the qualifying value, then averages KPIs inside the KRA and applies the KRA weight.</div>
    </Card>

    <div className="stack">{kras.map((kra,ki)=><Card key={ki}>
      <div className="kra-title"><div className="inline-fields"><input className="title-input" value={kra.name} onChange={e=>updateKra(ki,{name:e.target.value})}/><input className="weight-input no-spinner" type="number" min="1" max="100" step="1" value={kra.weight} onChange={e=>updateKra(ki,{weight:e.target.value===''?0:clamp100(e.target.value)})}/><span>KRA weight</span></div><div className="row-actions"><span className="weight-chip">{kra.items.length} KPI{kra.items.length===1?'':'s'} · each 100 marks</span><button className="icon-button danger" title="Remove KRA" onClick={()=>setKras(cur=>cur.filter((_,index)=>index!==ki))}><Trash2 size={15}/></button></div></div>

      <div className="dynamic-kpi-list">{kra.items.map((item,ii)=>{
        const choice=item.input_type==='choice'
        const qualifierLabel=item.direction==='lower'?'Maximum qualifying value':'Minimum qualifying value'
        return <div className="dynamic-kpi is-open" key={ii}>
          <div className="dynamic-kpi-head"><strong>KPI {ii+1}: {item.question||'Untitled KPI'}</strong><button className="icon-button danger" title="Remove KPI" onClick={()=>updateKra(ki,{items:kra.items.filter((_,index)=>index!==ii)})}><Trash2 size={14}/></button></div>
          <div className="form-grid four">
            <label className="span-2">KPI name<ExpandingTextarea value={item.question} onChange={e=>updateItem(ki,ii,{question:e.target.value})} placeholder="Enter KPI name"/></label>
            <label className="span-2">Task responsibility<ExpandingTextarea value={item.task_responsibility} onChange={e=>updateItem(ki,ii,{task_responsibility:e.target.value})} placeholder="What should the employee achieve?"/></label>

            <label>Measurement type<select value={item.input_type} onChange={e=>changeMeasurementType(ki,ii,e.target.value)}>{measurementTypes.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            {!choice?<label>Unit<input value={item.unit} onChange={e=>updateItem(ki,ii,{unit:e.target.value})} placeholder="units / INR / % / days"/><span className="cell-help">Shown beside target, qualifier and employee input.</span></label>:<label>KPI weightage<input value="100" disabled/><span className="cell-help">Every dropdown result maps to weightage out of 100.</span></label>}
            {!choice?<label>Scoring direction<select value={item.direction} onChange={e=>updateItem(ki,ii,{direction:e.target.value})}><option value="higher">Higher result is better</option><option value="lower">Lower result is better</option></select></label>:<label>Scoring method<input value="Result → marks / 100" disabled/></label>}
            <label>KPI weightage<input value="100" disabled/><span className="cell-help">Fixed at 100 for every KPI.</span></label>

            {!choice?<>
              <label>Target value for 100 marks<input type="number" min="1" step="1" value={item.target_value} onChange={e=>updateItem(ki,ii,{target_value:e.target.value===''?0:whole(e.target.value)})} placeholder="100"/><span className="cell-help">Example: Sales target 100000 INR = 100 marks.</span></label>
              <label>{qualifierLabel}<input type="number" min="0" step="1" value={item.qualifying_value} onChange={e=>updateItem(ki,ii,{qualifying_value:e.target.value===''?0:whole(e.target.value)})} placeholder="0"/><span className="cell-help">0 = no qualification gate. If not achieved, calculated KPI = 0.</span></label>
            </>:null}
            <label>Review frequency<select value={item.frequency} onChange={e=>updateItem(ki,ii,{frequency:e.target.value})}><option>Monthly</option><option>Quarterly</option><option>Half-Yearly</option><option>Annual</option></select></label>

            {choice?<div className="span-4 custom-results-panel">
              <div className="custom-results-head"><div><strong>Dropdown results and marks</strong><div className="cell-help">Each result gives a whole-number KPI mark from 0 to 100.</div></div><div className="responsive-actions"><button type="button" className="secondary small" onClick={()=>addOption(ki,ii)}><Plus size={13}/>Add result</button><button type="button" className="secondary small" onClick={()=>addFiveOptions(ki,ii)}>+ Add 5 fields</button></div></div>
              <div className="custom-result-grid">{(item.choice_options||[]).map((row,oi)=><div key={oi} className="custom-result-row"><label>Result / option name<input value={row.label} onChange={e=>updateOption(ki,ii,oi,{label:e.target.value})} placeholder="Result name"/></label><label>Marks / 100<input type="number" min="0" max="100" step="1" value={row.score} onChange={e=>updateOption(ki,ii,oi,{score:e.target.value===''?'':clamp100(e.target.value)})} placeholder="0-100"/></label><button type="button" className="icon-button danger" title="Remove result" onClick={()=>removeOption(ki,ii,oi)}><Trash2 size={14}/></button></div>)}</div>
              {!(item.choice_options||[]).length?<div className="helper-strip">Add result names and marks before publishing this KPI.</div>:null}
            </div>:null}

            <label className="span-2">Measurement / guidance<ExpandingTextarea value={item.measurement} onChange={e=>updateItem(ki,ii,{measurement:e.target.value})} placeholder="Explain what is measured and where the employee gets the value"/></label>
            <label className="span-2">Source<ExpandingTextarea value={item.source} onChange={e=>updateItem(ki,ii,{source:e.target.value})} placeholder="Policy / sales system / project tracker / manager"/></label>
          </div>
        </div>
      })}</div>

      <button className="text-action" onClick={()=>updateKra(ki,{items:[...kra.items,newItem()]})}><Plus size={15}/>Add KPI</button>
    </Card>)}</div>

    <div className="footer-actions"><button className="secondary" onClick={addKra}><Plus size={16}/>Add KRA</button><button className="primary" onClick={save}><Save size={16}/>{editId?'Save draft changes':'Save draft template'}</button></div>
  </>
}
