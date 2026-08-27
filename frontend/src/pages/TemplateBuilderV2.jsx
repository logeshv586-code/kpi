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

const newItem=(weight=100)=>({
  question:'',task_responsibility:'',input_type:'number',weight,target_value:100,direction:'higher',
  frequency:'Monthly',unit:'tasks',measurement:'',choice_options:[],source:'',weight_basis:'Configured by HR'
})

export default function TemplateBuilderV2(){
  const[params]=useSearchParams(),navigate=useNavigate()
  const editId=params.get('edit'),departmentParam=params.get('department'),designationParam=params.get('designation')
  const[masters,setMasters]=useState([]),[name,setName]=useState(''),[department,setDepartment]=useState(''),[designation,setDesignation]=useState('')
  const[kras,setKras]=useState([{name:'New KRA',weight:100,items:[newItem(100)]}]),[error,setError]=useState('')

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
            const inputType=['number','percentage','choice'].includes(i.input_type)?i.input_type:'number'
            return{
              question:i.question,
              task_responsibility:meta.task_responsibility||'',
              input_type:inputType,
              weight:i.weight,
              target_value:i.target_value??(inputType==='percentage'?100:''),
              direction:i.direction||'higher',
              frequency:meta.frequency||'Monthly',
              unit:meta.unit||(inputType==='percentage'?'%':'tasks'),
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
    if(type==='choice')Object.assign(patch,{target_value:'',unit:'',direction:'higher',choice_options:[]})
    if(type==='percentage')Object.assign(patch,{target_value:item.target_value===''||item.target_value==null?100:item.target_value,unit:'%',direction:'higher'})
    if(type==='number')Object.assign(patch,{target_value:item.target_value===''||item.target_value==null?100:item.target_value,unit:item.unit==='%'?'tasks':(item.unit||'tasks')})
    updateItem(ki,ii,patch)
  }

  function addOption(ki,ii){
    const rows=kras[ki].items[ii].choice_options||[]
    updateItem(ki,ii,{choice_options:[...rows,{label:'',score:''}]})
  }
  function updateOption(ki,ii,oi,patch){
    const rows=kras[ki].items[ii].choice_options||[]
    updateItem(ki,ii,{choice_options:rows.map((r,i)=>i===oi?{...r,...patch}:r)})
  }
  function removeOption(ki,ii,oi){
    const rows=kras[ki].items[ii].choice_options||[]
    updateItem(ki,ii,{choice_options:rows.filter((_,i)=>i!==oi)})
  }

  function addMultipleOptions(ki,ii,count=5){
    const rows=kras[ki].items[ii].choice_options||[]
    const newRows=Array.from({length:count},()=>({label:'',score:''}))
    updateItem(ki,ii,{choice_options:[...rows,...newRows]})
  }

  function applyPreset(ki,ii,presetType){
    let presets=[]
    if(presetType==='5star'){
      presets=[{label:'Excellent',score:100},{label:'Very Good',score:80},{label:'Good',score:60},{label:'Average',score:40},{label:'Poor',score:0}]
    }else if(presetType==='3star'){
      presets=[{label:'High',score:100},{label:'Medium',score:50},{label:'Low',score:0}]
    }else if(presetType==='passfail'){
      presets=[{label:'Achieved / Pass',score:100},{label:'Not Achieved / Fail',score:0}]
    }else if(presetType==='numeric5'){
      presets=[{label:'Option 1 (100%)',score:100},{label:'Option 2 (75%)',score:75},{label:'Option 3 (50%)',score:50},{label:'Option 4 (25%)',score:25},{label:'Option 5 (0%)',score:0}]
    }
    updateItem(ki,ii,{choice_options:presets})
  }

  function balanceAll(){
    const kws=splitWeight(100,kras.length)
    setKras(cur=>cur.map((k,ki)=>{
      const iws=splitWeight(kws[ki],k.items.length)
      return{...k,weight:kws[ki],items:k.items.map((it,ii)=>({...it,weight:iws[ii]}))}
    }))
  }

  function balanceItems(ki){
    setKras(cur=>cur.map((k,i)=>{
      if(i!==ki)return k
      const weights=splitWeight(k.weight,k.items.length)
      return{...k,items:k.items.map((it,ii)=>({...it,weight:weights[ii]}))}
    }))
  }

  function validateItem(item,kraName){
    if(!item.question.trim())throw new Error(`${kraName}: every KPI needs a name`)
    if(Number(item.weight||0)<=0)throw new Error(`${item.question}: weight must be greater than 0`)
    if(['number','percentage'].includes(item.input_type)){
      const target=Number(item.target_value)
      if(!Number.isFinite(target)||target<0)throw new Error(`${item.question}: enter a valid expected target`)
    }
    if(item.input_type==='choice'){
      const options=item.choice_options||[]
      if(!options.length)throw new Error(`${item.question}: click Add result and create at least one dropdown result`)
      const labels=options.map(x=>String(x.label||'').trim())
      if(labels.some(x=>!x))throw new Error(`${item.question}: every dropdown result needs a name`)
      if(new Set(labels.map(x=>x.toLowerCase())).size!==labels.length)throw new Error(`${item.question}: dropdown result names must be unique`)
      options.forEach(row=>{
        const score=Number(row.score)
        if(!Number.isFinite(score)||score<0||score>100)throw new Error(`${item.question}: each dropdown score must be between 0 and 100%`)
      })
    }
  }

  function normalizedItem(item){
    const meta={
      frequency:item.frequency||'Monthly',unit:item.unit||'',measurement:item.measurement||'',evidence_required:false,
      scoring_method:'target_ratio',score_cap_pct:100,source:item.source||'',weight_basis:item.weight_basis||'Configured by HR',
      task_responsibility:(item.task_responsibility||item.question||'Complete assigned KPI task').trim(),score_limit:Number(item.weight||0)
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
      if(!name.trim())throw new Error('Template name is required')
      if(!department)throw new Error('Select a department')
      if(Math.abs(total-100)>0.001)throw new Error(`KRA total must equal 100. Current total: ${total}`)
      if(!kras.length)throw new Error('Add at least one KRA')
      kras.forEach(k=>{
        if(!k.name.trim())throw new Error('Every KRA needs a name')
        if(!k.items.length)throw new Error(`${k.name}: add at least one KPI`)
        const subtotal=Number(k.items.reduce((s,i)=>s+Number(i.weight||0),0).toFixed(2))
        if(Math.abs(subtotal-Number(k.weight))>0.001)throw new Error(`${k.name}: KPI weights must total ${k.weight}. Current total: ${subtotal}`)
        k.items.forEach(i=>validateItem(i,k.name))
      })
      const dep=departments.find(d=>String(d.id)===String(department))
      const payload={
        name:name.trim(),division_id:dep?.parent_division_id?Number(dep.parent_division_id):null,
        department_id:Number(department),designation_id:designation?Number(designation):null,
        kras:kras.map(k=>({name:k.name.trim(),weight:Number(k.weight||0),items:k.items.map(normalizedItem)}))
      }
      if(editId)await api.put(`/kpi/templates/${editId}`,payload);else await api.post('/kpi/templates',payload)
      navigate('/templates')
    }catch(e){setError(getError(e))}
  }

  return<>
    <PageHeader title={editId?'Edit KPI Template':'Create KPI Template'} subtitle="Use Number, Percentage, or create your own dropdown result names." actions={<div style={{display:'flex',gap:'8px'}}><button className="secondary" onClick={()=>navigate('/templates')}><ArrowLeft size={16}/>Back</button><button className="secondary" onClick={balanceAll}><Equal size={16}/>Auto-balance marks</button><button className="primary" onClick={save}><Save size={16}/>{editId?'Save draft changes':'Save draft template'}</button></div>}/>
    <ErrorBox error={error}/>

    <Card>
      <div className="section-heading"><div><h3>Choose Department</h3><p className="muted small-copy">Department is the main hierarchy used to assign KPI templates.</p></div></div>
      <div className="form-grid" style={{gridTemplateColumns:'1fr 1fr'}}>
        <label>Department *<select value={department} onChange={e=>{setDepartment(e.target.value);setDesignation('')}}><option value="">Select department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Role / designation<select value={designation} onChange={e=>setDesignation(e.target.value)} disabled={!department}><option value="">All roles in department</option>{designations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>
    </Card>

    <Card>
      <div className="form-grid"><label>Template name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Customer Support KPI"/></label><label>Department<input value={selectedDepartment?.name||''} disabled/></label><label>Total weight<input value={`${total} / 100`} disabled className={Math.abs(total-100)<0.001?'valid-field':'invalid-field'}/></label></div>
      <div className="helper-strip"><strong>Custom Dropdown:</strong> add as many custom result options/fields as needed for this KPI. Click <strong>+ Add result</strong> or use quick preset scales below.</div>
    </Card>

    <div className="stack">{kras.map((kra,ki)=><Card key={ki}>
      <div className="kra-title"><div className="inline-fields"><input className="title-input" value={kra.name} onChange={e=>updateKra(ki,{name:e.target.value})}/><input className="weight-input" type="number" min="0" max="100" step="0.01" value={kra.weight} onChange={e=>updateKra(ki,{weight:Number(e.target.value)})}/><span>marks</span></div><div className="row-actions"><button className="secondary small" onClick={()=>balanceItems(ki)}><Equal size={14}/>Balance KPIs</button><button className="icon-button danger" onClick={()=>setKras(cur=>cur.filter((_,i)=>i!==ki))}><Trash2 size={15}/></button></div></div>
      <div className="dynamic-kpi-list">{kra.items.map((item,ii)=><div className="dynamic-kpi is-open" key={ii}>
        <div className="dynamic-kpi-head"><strong>KPI {ii+1}: {item.question||'Untitled KPI'}</strong><button className="icon-button danger" onClick={()=>updateKra(ki,{items:kra.items.filter((_,x)=>x!==ii)})}><Trash2 size={14}/></button></div>
        <div className="form-grid four">
          <label className="span-2">KPI name<input value={item.question} onChange={e=>updateItem(ki,ii,{question:e.target.value})} placeholder="Enter KPI name"/></label>
          <label className="span-2">Task responsibility<input value={item.task_responsibility} onChange={e=>updateItem(ki,ii,{task_responsibility:e.target.value})} placeholder="What should the employee complete?"/></label>
          <label>Result entry type<select value={item.input_type} onChange={e=>changeInputType(ki,ii,e.target.value)}><option value="number">Number / Quantity</option><option value="percentage">Percentage</option><option value="choice">Custom Dropdown</option></select></label>
          <label>Weight / marks<input type="number" min="0" max="100" step="0.01" value={item.weight} onChange={e=>updateItem(ki,ii,{weight:Number(e.target.value)})}/></label>

          {['number','percentage'].includes(item.input_type)?<><label>Expected target *<input type="number" min="0" step="0.01" value={item.target_value??''} onChange={e=>updateItem(ki,ii,{target_value:e.target.value})} placeholder={item.input_type==='percentage'?'100':'e.g. 100'}/></label><label>Unit<input value={item.unit} onChange={e=>updateItem(ki,ii,{unit:e.target.value})} placeholder={item.input_type==='percentage'?'%':'tasks / calls / cases'}/></label><label>Scoring direction<select value={item.direction} onChange={e=>updateItem(ki,ii,{direction:e.target.value})}><option value="higher">Higher result is better</option><option value="lower">Lower result is better</option></select></label></>:null}

          {item.input_type==='choice'?<div className="span-2" style={{border:'1px solid #dbeafe',background:'#f8fbff',borderRadius:'10px',padding:'12px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',marginBottom:'10px',flexWrap:'wrap'}}>
              <div><strong>Custom results shown to employee</strong><div className="cell-help">{(item.choice_options||[]).length} option fields added</div></div>
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                <button type="button" className="secondary small" onClick={()=>addOption(ki,ii)}><Plus size={13}/>Add result</button>
                <button type="button" className="secondary small" onClick={()=>addMultipleOptions(ki,ii,5)}>+ Add 5 fields</button>
              </div>
            </div>
            <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap',marginBottom:'10px',fontSize:'0.75rem',color:'#475569',background:'#eff6ff',padding:'6px 10px',borderRadius:'6px'}}>
              <strong>Quick presets:</strong>
              <button type="button" className="text-action" style={{fontSize:'0.75rem'}} onClick={()=>applyPreset(ki,ii,'5star')}>5-Level (100-0%)</button> |
              <button type="button" className="text-action" style={{fontSize:'0.75rem'}} onClick={()=>applyPreset(ki,ii,'3star')}>3-Level (100/50/0)</button> |
              <button type="button" className="text-action" style={{fontSize:'0.75rem'}} onClick={()=>applyPreset(ki,ii,'passfail')}>Pass/Fail</button> |
              <button type="button" className="text-action" style={{fontSize:'0.75rem'}} onClick={()=>applyPreset(ki,ii,'numeric5')}>5 Custom Options</button>
            </div>
            {(item.choice_options||[]).length===0?<div className="helper-strip" style={{margin:0}}>No results added yet. Click <strong>Add result</strong> or choose a quick preset above.</div>:null}
            <div style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) 140px 40px',gap:'8px',alignItems:'end'}}>{(item.choice_options||[]).map((row,oi)=><div key={oi} style={{display:'contents'}}><label>Result / option name<input value={row.label} onChange={e=>updateOption(ki,ii,oi,{label:e.target.value})} placeholder="Type customer or result name"/></label><label>Score %<input type="number" min="0" max="100" step="1" value={row.score} onChange={e=>updateOption(ki,ii,oi,{score:e.target.value})} placeholder="0-100"/></label><button type="button" className="icon-button danger" title="Remove result" onClick={()=>removeOption(ki,ii,oi)}><Trash2 size={14}/></button></div>)}</div>
          </div>:null}

          <label>Frequency<input value={item.frequency} onChange={e=>updateItem(ki,ii,{frequency:e.target.value})} placeholder="Monthly"/></label>
          <label className="span-2">Measurement / guidance<input value={item.measurement} onChange={e=>updateItem(ki,ii,{measurement:e.target.value})} placeholder="Explain what should be measured"/></label>
          <label>Source<input value={item.source} onChange={e=>updateItem(ki,ii,{source:e.target.value})} placeholder="Policy / task system / manager"/></label>
          <label>Weight basis<input value={item.weight_basis} onChange={e=>updateItem(ki,ii,{weight_basis:e.target.value})}/></label>
        </div>
      </div>)}</div>
      <button className="text-action" onClick={()=>updateKra(ki,{items:[...kra.items,newItem(10)]})}><Plus size={15}/>Add KPI parameter</button>
    </Card>)}</div>

    <div className="footer-actions"><button className="secondary" onClick={()=>setKras(cur=>[...cur,{name:'New KRA',weight:0,items:[newItem(0)]}])}><Plus size={16}/>Add KRA</button><button className="primary" onClick={save}><Save size={16}/>{editId?'Save draft changes':'Save draft template'}</button></div>
  </>
}
