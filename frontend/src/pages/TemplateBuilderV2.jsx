import {useEffect,useMemo,useState} from 'react'
import {ArrowLeft,Equal,Plus,Save,Trash2} from 'lucide-react'
import {useNavigate,useSearchParams} from 'react-router-dom'
import {api,getError} from '../lib/api'
import {Card,ErrorBox,PageHeader} from '../components/UI'

const defaultChoices={'Excellent':100,'Good':80,'Average':60,'Poor':40,'Not achieved':0}
const choiceText=map=>Object.entries(map||{}).map(([k,v])=>`${k}:${v}`).join(', ')
const splitWeight=(total,count)=>{if(!count)return[];const base=Math.floor(Number(total||0)/count*100)/100;const out=Array(count).fill(base);out[count-1]=Number((Number(total||0)-base*(count-1)).toFixed(2));return out}
const newItem=(weight=100)=>({question:'',task_responsibility:'',input_type:'percentage',weight,target_value:100,direction:'higher',frequency:'Monthly',unit:'%',measurement:'',scoring_method:'target_ratio',choice_map:choiceText(defaultChoices),source:'',weight_basis:'Configured by HR'})

function parseChoiceMap(text){
  const map={}
  String(text||'').split(',').forEach(part=>{const idx=part.lastIndexOf(':');if(idx<1)return;const label=part.slice(0,idx).trim(),value=Number(part.slice(idx+1).trim());if(label&&Number.isFinite(value))map[label]=value})
  return Object.keys(map).length?map:defaultChoices
}

export default function TemplateBuilderV2(){
  const[params]=useSearchParams(),navigate=useNavigate()
  const editId=params.get('edit'),departmentParam=params.get('department'),designationParam=params.get('designation')
  const[masters,setMasters]=useState([]),[name,setName]=useState(''),[department,setDepartment]=useState(''),[designation,setDesignation]=useState(''),[kras,setKras]=useState([{name:'New KRA',weight:100,items:[newItem(100)]}]),[error,setError]=useState('')

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
        setKras(found.kras.map(k=>({name:k.name,weight:k.weight,items:k.items.map(i=>{const cfg=i.config||{},meta=cfg.meta||{};return{question:i.question,task_responsibility:meta.task_responsibility||'',input_type:['percentage','number','choice','yesno','rating'].includes(i.input_type)?i.input_type:'number',weight:i.weight,target_value:i.target_value??'',direction:i.direction||'higher',frequency:meta.frequency||'Monthly',unit:meta.unit||'',measurement:meta.measurement||'',scoring_method:meta.scoring_method||'target_ratio',choice_map:choiceText(cfg.score_map||defaultChoices),source:meta.source||'',weight_basis:meta.weight_basis||'Configured by HR'}})})))
      }
    }).catch(e=>setError(getError(e)))
  },[editId,departmentParam,designationParam])

  function updateKra(ki,patch){setKras(current=>current.map((k,i)=>i===ki?{...k,...patch}:k))}
  function updateItem(ki,ii,patch){setKras(current=>current.map((k,kidx)=>kidx!==ki?k:{...k,items:k.items.map((it,iidx)=>iidx===ii?{...it,...patch}:it)}))}
  function balanceAll(){const kws=splitWeight(100,kras.length);setKras(current=>current.map((k,ki)=>{const iw=splitWeight(kws[ki],k.items.length);return{...k,weight:kws[ki],items:k.items.map((it,ii)=>({...it,weight:iw[ii]}))}}))}
  function balanceItems(ki){setKras(current=>current.map((k,i)=>i!==ki?k:{...k,items:k.items.map((it,ii)=>({...it,weight:splitWeight(k.weight,k.items.length)[ii]}))}))}

  function normalizedItem(i){
    const meta={frequency:i.frequency||'Monthly',unit:i.unit||'',measurement:i.measurement||'',evidence_required:false,scoring_method:i.scoring_method||'target_ratio',score_cap_pct:100,source:i.source||'',weight_basis:i.weight_basis||'Configured by HR',task_responsibility:(i.task_responsibility||i.question||'Complete assigned KPI task').trim(),score_limit:Number(i.weight||0)}
    const options={score_map:['choice','yesno'].includes(i.input_type)?parseChoiceMap(i.choice_map):{},meta}
    if(i.input_type==='rating')options.max=5
    return{question:i.question.trim(),input_type:i.input_type,weight:Number(i.weight||0),target_value:['choice','yesno','rating'].includes(i.input_type)||i.target_value===''?null:Number(i.target_value),direction:i.direction,options}
  }

  async function save(){
    setError('')
    try{
      if(!name.trim())throw new Error('Template name is required')
      if(!department)throw new Error('Select a department')
      if(total>100.001)throw new Error(`KRA total cannot exceed 100. Current total: ${total}`)
      if(!kras.length)throw new Error('Add at least one KRA')
      kras.forEach(k=>{if(!k.name.trim())throw new Error('Every KRA needs a name');if(!k.items.length)throw new Error(`${k.name}: add at least one KPI`);const subtotal=k.items.reduce((s,i)=>s+Number(i.weight||0),0);if(subtotal>Number(k.weight)+0.001)throw new Error(`${k.name}: KPI weights cannot exceed KRA weight`);if(k.items.some(i=>!i.question.trim()))throw new Error(`${k.name}: every KPI needs a name`)})
      const dep=departments.find(d=>String(d.id)===String(department))
      const payload={name:name.trim(),division_id:dep?.parent_division_id?Number(dep.parent_division_id):null,department_id:Number(department),designation_id:designation?Number(designation):null,kras:kras.map(k=>({name:k.name.trim(),weight:Number(k.weight||0),items:k.items.map(normalizedItem)}))}
      if(editId)await api.put(`/kpi/templates/${editId}`,payload);else await api.post('/kpi/templates',payload)
      navigate('/templates')
    }catch(e){setError(getError(e))}
  }

  return<>
    <PageHeader title={editId?'Edit KPI Template':'Create KPI Template'} subtitle="Create KPI targets by Department. PDF evidence is optional for employees." actions={<div style={{display:'flex',gap:'8px'}}><button className="secondary" onClick={()=>navigate('/templates')}><ArrowLeft size={16}/>Back</button><button className="secondary" onClick={balanceAll}><Equal size={16}/>Auto-balance marks</button></div>}/>
    <ErrorBox error={error}/>

    <Card><div className="section-heading"><div><h3>Choose Department</h3><p className="muted small-copy">Department is the primary hierarchy. Division is handled internally and is not shown to users.</p></div></div><div className="form-grid" style={{gridTemplateColumns:'1fr 1fr'}}><label>Department *<select value={department} onChange={e=>{setDepartment(e.target.value);setDesignation('')}}><option value="">Select department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Role / designation<select value={designation} onChange={e=>setDesignation(e.target.value)} disabled={!department}><option value="">All roles in department</option>{designations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label></div><div className="helper-strip"><strong>Selected scope:</strong> {[selectedDepartment?.name,designations.find(d=>String(d.id)===String(designation))?.name].filter(Boolean).join(' / ')||'Select department'}</div></Card>

    <Card><div className="form-grid"><label>Template name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Software Team KPI"/></label><label>Department<input value={selectedDepartment?.name||''} disabled/></label><label>Total weight<input value={`${total} / 100`} disabled className={Math.abs(total-100)<0.001?'valid-field':'invalid-field'}/></label></div><div className="helper-strip">Evidence upload and employee description are optional during KPI entry.</div></Card>

    <div className="stack">{kras.map((k,ki)=><Card key={ki}><div className="kra-title"><div className="inline-fields"><input className="title-input" value={k.name} onChange={e=>updateKra(ki,{name:e.target.value})}/><input className="weight-input" type="number" min="0" max="100" step="0.01" value={k.weight} onChange={e=>updateKra(ki,{weight:Number(e.target.value)})}/><span>marks</span></div><div className="row-actions"><button className="secondary small" onClick={()=>balanceItems(ki)}><Equal size={14}/>Balance KPIs</button><button className="icon-button danger" onClick={()=>setKras(current=>current.filter((_,i)=>i!==ki))}><Trash2 size={15}/></button></div></div><div className="dynamic-kpi-list">{k.items.map((i,ii)=><div className="dynamic-kpi is-open" key={ii}><div className="dynamic-kpi-head"><strong>KPI {ii+1}: {i.question||'Untitled KPI'}</strong><button className="icon-button danger" onClick={()=>updateKra(ki,{items:k.items.filter((_,x)=>x!==ii)})}><Trash2 size={14}/></button></div><div className="form-grid four"><label className="span-2">KPI name<input value={i.question} onChange={e=>updateItem(ki,ii,{question:e.target.value})}/></label><label className="span-2">Task responsibility<input value={i.task_responsibility} onChange={e=>updateItem(ki,ii,{task_responsibility:e.target.value})}/></label><label>Answer type<select value={i.input_type} onChange={e=>updateItem(ki,ii,{input_type:e.target.value,target_value:['choice','yesno','rating'].includes(e.target.value)?'':i.target_value})}><option value="percentage">Percentage</option><option value="number">Number</option><option value="choice">Objective choice</option><option value="yesno">Yes / No</option><option value="rating">Rating</option></select></label><label>Weight / marks<input type="number" min="0" max="100" step="0.01" value={i.weight} onChange={e=>updateItem(ki,ii,{weight:Number(e.target.value)})}/></label><label>Expected target<input type="number" step="0.01" disabled={['choice','yesno','rating'].includes(i.input_type)} value={i.target_value??''} onChange={e=>updateItem(ki,ii,{target_value:e.target.value})}/></label><label>Direction<select disabled={['choice','yesno','rating'].includes(i.input_type)} value={i.direction} onChange={e=>updateItem(ki,ii,{direction:e.target.value})}><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select></label><label>Frequency<input value={i.frequency} onChange={e=>updateItem(ki,ii,{frequency:e.target.value})}/></label><label>Unit<input value={i.unit} onChange={e=>updateItem(ki,ii,{unit:e.target.value})}/></label><label className="span-2">Measurement / guidance<input value={i.measurement} onChange={e=>updateItem(ki,ii,{measurement:e.target.value})}/></label>{['choice','yesno'].includes(i.input_type)?<label className="span-2">Answer → score mapping<input value={i.choice_map} onChange={e=>updateItem(ki,ii,{choice_map:e.target.value})}/></label>:null}<label>Source<input value={i.source} onChange={e=>updateItem(ki,ii,{source:e.target.value})}/></label><label>Weight basis<input value={i.weight_basis} onChange={e=>updateItem(ki,ii,{weight_basis:e.target.value})}/></label></div></div>)}</div><button className="text-action" onClick={()=>updateKra(ki,{items:[...k.items,newItem(10)]})}><Plus size={15}/>Add KPI parameter</button></Card>)}</div>

    <div className="footer-actions"><button className="secondary" onClick={()=>setKras(current=>[...current,{name:'New KRA',weight:0,items:[newItem(0)]}])}><Plus size={16}/>Add KRA</button><button className="primary" onClick={save}><Save size={16}/>{editId?'Save draft changes':'Save draft template'}</button></div>
  </>
}
