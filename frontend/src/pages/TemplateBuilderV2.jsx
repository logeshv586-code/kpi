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

// KPI weights shown to users are always 100. This internal share only converts
// the KRA weight into equal KPI contribution shares for storage compatibility.
const contributionShares=(kraWeight,count)=>{
  if(!count)return[]
  const share=Number(kraWeight||0)/count
  return Array(count).fill(share)
}

const wholeValue=value=>value===''||value===null||value===undefined?'':Math.round(Number(value))
const clamp100=value=>Math.max(0,Math.min(100,Math.round(Number(value||0))))

const newItem=()=>({
  question:'',task_responsibility:'',minimum_score:0,frequency:'Monthly',measurement:'',source:''
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
            return{
              question:item.question,
              task_responsibility:meta.task_responsibility||'',
              minimum_score:clamp100(meta.minimum_score??meta.threshold_min??0),
              frequency:meta.frequency||'Monthly',
              measurement:meta.measurement||'',
              source:meta.source||''
            }
          })
        })))
      }
    }).catch(e=>setError(getError(e)))
  },[editId,departmentParam,designationParam])

  function updateKra(ki,patch){setKras(cur=>cur.map((kra,index)=>index===ki?{...kra,...patch}:kra))}
  function updateItem(ki,ii,patch){setKras(cur=>cur.map((kra,kidx)=>kidx!==ki?kra:{...kra,items:kra.items.map((item,iidx)=>iidx===ii?{...item,...patch}:item)}))}

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
    if(!Number.isInteger(minimum)||minimum<0||minimum>100)throw new Error(`${item.question}: minimum score must be a whole number from 0 to 100`)
  }

  function normalizedItem(item,contributionWeight){
    const minimum=clamp100(item.minimum_score)
    return{
      question:item.question.trim(),
      input_type:'number',
      weight:Number(contributionWeight||0),
      target_value:100,
      direction:'higher',
      options:{
        score_map:{},
        meta:{
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
      if(total>100)throw new Error(`KRA total cannot exceed 100. Current total: ${total}`)
      if(!kras.length)throw new Error('Add at least one KRA')
      kras.forEach(kra=>{
        if(!kra.name.trim())throw new Error('Every KRA needs a name')
        const weight=Number(kra.weight)
        if(!Number.isInteger(weight)||weight<0||weight>100)throw new Error(`${kra.name}: KRA weight must be a whole number from 0 to 100`)
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
          return{name:kra.name.trim(),weight:Number(kra.weight||0),items:kra.items.map((item,index)=>normalizedItem(item,shares[index]))}
        })
      }
      if(editId)await api.put(`/kpi/templates/${editId}`,payload);else await api.post('/kpi/templates',payload)
      navigate('/templates')
    }catch(e){setError(getError(e))}
  }

  return<>
    <PageHeader title={editId?'Edit KPI Template':'Create KPI Template'} subtitle="Set KRA weights to total 100. Every KPI inside a KRA is fixed at 100 and accepts one whole-number score from 0 to 100." actions={<div className="responsive-actions"><button className="secondary" onClick={()=>navigate('/templates')}><ArrowLeft size={16}/>Back</button><button className="secondary" onClick={balanceAll}><Equal size={16}/>Auto-balance KRA weights</button><button className="primary" onClick={save}><Save size={16}/>{editId?'Save draft changes':'Save draft template'}</button></div>}/>
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
      <div className="helper-strip"><strong>Excel-style scoring:</strong> every KPI is 100. Employee enters a whole number from 0 to 100. If the input is below the KPI minimum, calculated KPI = 0; otherwise calculated KPI = the entered number. KRA score = average calculated KPI × KRA weight ÷ 100.</div>
    </Card>

    <div className="stack">{kras.map((kra,ki)=><Card key={ki}>
      <div className="kra-title"><div className="inline-fields"><input className="title-input" value={kra.name} onChange={e=>updateKra(ki,{name:e.target.value})}/><input className="weight-input no-spinner" type="number" min="0" max="100" step="1" value={kra.weight} onChange={e=>{const raw=e.target.value;if(raw===''){updateKra(ki,{weight:0});return}updateKra(ki,{weight:clamp100(raw)})}}/><span>KRA weight</span></div><div className="row-actions"><span className="weight-chip">{kra.items.length} KPI{kra.items.length===1?'':'s'} · each 100</span><button className="icon-button danger" title="Remove KRA" onClick={()=>setKras(cur=>cur.filter((_,index)=>index!==ki))}><Trash2 size={15}/></button></div></div>

      <div className="dynamic-kpi-list">{kra.items.map((item,ii)=><div className="dynamic-kpi is-open" key={ii}>
        <div className="dynamic-kpi-head"><strong>KPI {ii+1}: {item.question||'Untitled KPI'}</strong><button className="icon-button danger" title="Remove KPI" onClick={()=>updateKra(ki,{items:kra.items.filter((_,index)=>index!==ii)})}><Trash2 size={14}/></button></div>
        <div className="form-grid four">
          <label className="span-2">KPI name<ExpandingTextarea value={item.question} onChange={e=>updateItem(ki,ii,{question:e.target.value})} placeholder="Enter KPI name"/></label>
          <label className="span-2">Task responsibility<ExpandingTextarea value={item.task_responsibility} onChange={e=>updateItem(ki,ii,{task_responsibility:e.target.value})} placeholder="What should the employee achieve?"/></label>

          <label>KPI weight / score base<input value="100" disabled/><span className="cell-help">Fixed at 100 for every KPI.</span></label>
          <label>Minimum qualifying score<input type="number" min="0" max="100" step="1" value={item.minimum_score} onChange={e=>{const raw=e.target.value;updateItem(ki,ii,{minimum_score:raw===''?0:clamp100(raw)})}} placeholder="0"/><span className="cell-help">Default 0. Below this, calculated KPI becomes 0.</span></label>
          <label>Review frequency<select value={item.frequency} onChange={e=>updateItem(ki,ii,{frequency:e.target.value})}><option>Monthly</option><option>Quarterly</option><option>Half-Yearly</option><option>Annual</option></select></label>
          <label>Calculated KPI rule<input value="Input if ≥ minimum; otherwise 0" disabled/><span className="cell-help">Example: minimum 25, input 24 → calculated 0.</span></label>

          <label className="span-2">Measurement / guidance<ExpandingTextarea value={item.measurement} onChange={e=>updateItem(ki,ii,{measurement:e.target.value})} placeholder="Explain what this KPI score represents"/></label>
          <label className="span-2">Source<ExpandingTextarea value={item.source} onChange={e=>updateItem(ki,ii,{source:e.target.value})} placeholder="Policy / task system / manager"/></label>
        </div>
      </div>)}</div>

      <button className="text-action" onClick={()=>updateKra(ki,{items:[...kra.items,newItem()]})}><Plus size={15}/>Add KPI</button>
    </Card>)}</div>

    <div className="footer-actions"><button className="secondary" onClick={addKra}><Plus size={16}/>Add KRA</button><button className="primary" onClick={save}><Save size={16}/>{editId?'Save draft changes':'Save draft template'}</button></div>
  </>
}
