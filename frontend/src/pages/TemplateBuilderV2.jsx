import {useEffect, useMemo, useState} from 'react'
import {ArrowLeft, Equal, Plus, Save, Trash2} from 'lucide-react'
import {useNavigate, useSearchParams} from 'react-router-dom'
import {api, getError} from '../lib/api'
import {Card, ErrorBox, PageHeader} from '../components/UI'

const DEFAULT_OPTIONS = [
  {label:'Excellent', score:100},
  {label:'Good', score:80},
  {label:'Average', score:60},
  {label:'No', score:0},
]

const splitWeight = (total, count) => {
  if (!count) return []
  const base = Math.floor((Number(total || 0) / count) * 100) / 100
  const out = Array(count).fill(base)
  out[count - 1] = Number((Number(total || 0) - base * (count - 1)).toFixed(2))
  return out
}

const mapToOptions = map => {
  const rows = Object.entries(map || {}).map(([label, score]) => ({label, score:Number(score)}))
  return rows.length ? rows : DEFAULT_OPTIONS.map(x => ({...x}))
}

const optionsToMap = rows => Object.fromEntries(
  (rows || [])
    .filter(row => String(row.label || '').trim())
    .map(row => [String(row.label).trim(), Number(row.score || 0)])
)

const newItem = (weight=100) => ({
  question:'',
  task_responsibility:'',
  input_type:'number',
  weight,
  target_value:100,
  direction:'higher',
  frequency:'Monthly',
  unit:'tasks',
  measurement:'',
  scoring_method:'target_ratio',
  choice_options:DEFAULT_OPTIONS.map(x => ({...x})),
  source:'',
  weight_basis:'Configured by HR',
})

export default function TemplateBuilderV2(){
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const editId = params.get('edit')
  const departmentParam = params.get('department')
  const designationParam = params.get('designation')

  const [masters,setMasters] = useState([])
  const [name,setName] = useState('')
  const [department,setDepartment] = useState('')
  const [designation,setDesignation] = useState('')
  const [kras,setKras] = useState([{name:'New KRA',weight:100,items:[newItem(100)]}])
  const [error,setError] = useState('')

  const departments = useMemo(
    () => masters.flatMap(parent => parent.departments.map(dep => ({...dep,parent_division_id:parent.id}))).sort((a,b)=>a.name.localeCompare(b.name)),
    [masters]
  )
  const selectedDepartment = departments.find(d => String(d.id) === String(department))
  const designations = selectedDepartment?.designations || []
  const total = useMemo(() => Number(kras.reduce((sum,kra)=>sum + Number(kra.weight || 0),0).toFixed(2)), [kras])

  useEffect(() => {
    Promise.all([api.get('/admin/masters'),api.get('/kpi/templates')])
      .then(([m,t]) => {
        setMasters(m.data)
        if (departmentParam) setDepartment(String(departmentParam))
        if (designationParam) setDesignation(String(designationParam))

        if (editId) {
          const found = t.data.find(x => String(x.id) === String(editId))
          if (!found) throw new Error('Template not found')
          setName(found.name || '')
          setDepartment(found.department_id ? String(found.department_id) : '')
          setDesignation(found.designation_id ? String(found.designation_id) : '')
          setKras(found.kras.map(k => ({
            name:k.name,
            weight:k.weight,
            items:k.items.map(i => {
              const cfg = i.config || {}
              const meta = cfg.meta || {}
              const supported = ['percentage','number','choice'].includes(i.input_type) ? i.input_type : 'number'
              return {
                question:i.question,
                task_responsibility:meta.task_responsibility || '',
                input_type:supported,
                weight:i.weight,
                target_value:i.target_value ?? (supported === 'percentage' ? 100 : ''),
                direction:i.direction || 'higher',
                frequency:meta.frequency || 'Monthly',
                unit:meta.unit || (supported === 'percentage' ? '%' : 'tasks'),
                measurement:meta.measurement || '',
                scoring_method:meta.scoring_method || 'target_ratio',
                choice_options:mapToOptions(cfg.score_map),
                source:meta.source || '',
                weight_basis:meta.weight_basis || 'Configured by HR',
              }
            })
          })))
        }
      })
      .catch(e => setError(getError(e)))
  }, [editId,departmentParam,designationParam])

  function updateKra(ki,patch){
    setKras(current => current.map((kra,index) => index === ki ? {...kra,...patch} : kra))
  }

  function updateItem(ki,ii,patch){
    setKras(current => current.map((kra,kIndex) => kIndex !== ki ? kra : ({
      ...kra,
      items:kra.items.map((item,iIndex) => iIndex === ii ? {...item,...patch} : item)
    })))
  }

  function changeInputType(ki,ii,inputType){
    const item = kras[ki].items[ii]
    const patch = {input_type:inputType}
    if (inputType === 'percentage') {
      patch.target_value = item.target_value === '' || item.target_value == null ? 100 : item.target_value
      patch.unit = '%'
      patch.direction = 'higher'
    } else if (inputType === 'number') {
      patch.target_value = item.target_value === '' || item.target_value == null ? 100 : item.target_value
      patch.unit = item.unit === '%' ? 'tasks' : (item.unit || 'tasks')
    } else if (inputType === 'choice') {
      patch.target_value = ''
      patch.direction = 'higher'
      patch.unit = ''
      patch.choice_options = item.choice_options?.length ? item.choice_options : DEFAULT_OPTIONS.map(x => ({...x}))
    }
    updateItem(ki,ii,patch)
  }

  function updateChoiceOption(ki,ii,optionIndex,patch){
    const rows = kras[ki].items[ii].choice_options || []
    updateItem(ki,ii,{choice_options:rows.map((row,index)=>index===optionIndex?{...row,...patch}:row)})
  }

  function addChoiceOption(ki,ii){
    const rows = kras[ki].items[ii].choice_options || []
    updateItem(ki,ii,{choice_options:[...rows,{label:'New option',score:0}]})
  }

  function removeChoiceOption(ki,ii,optionIndex){
    const rows = kras[ki].items[ii].choice_options || []
    updateItem(ki,ii,{choice_options:rows.filter((_,index)=>index!==optionIndex)})
  }

  function balanceAll(){
    const kraWeights = splitWeight(100,kras.length)
    setKras(current => current.map((kra,ki) => {
      const itemWeights = splitWeight(kraWeights[ki],kra.items.length)
      return {...kra,weight:kraWeights[ki],items:kra.items.map((item,ii)=>({...item,weight:itemWeights[ii]}))}
    }))
  }

  function balanceItems(ki){
    setKras(current => current.map((kra,index) => {
      if (index !== ki) return kra
      const weights = splitWeight(kra.weight,kra.items.length)
      return {...kra,items:kra.items.map((item,ii)=>({...item,weight:weights[ii]}))}
    }))
  }

  function normalizedItem(item){
    const scoreMap = item.input_type === 'choice' ? optionsToMap(item.choice_options) : {}
    const meta = {
      frequency:item.frequency || 'Monthly',
      unit:item.unit || '',
      measurement:item.measurement || '',
      evidence_required:false,
      scoring_method:'target_ratio',
      score_cap_pct:100,
      source:item.source || '',
      weight_basis:item.weight_basis || 'Configured by HR',
      task_responsibility:(item.task_responsibility || item.question || 'Complete assigned KPI task').trim(),
      score_limit:Number(item.weight || 0),
    }
    return {
      question:item.question.trim(),
      input_type:item.input_type,
      weight:Number(item.weight || 0),
      target_value:item.input_type === 'choice' || item.target_value === '' ? null : Number(item.target_value),
      direction:item.direction,
      options:{score_map:scoreMap,meta},
    }
  }

  function validateItem(item,kraName){
    if (!item.question.trim()) throw new Error(`${kraName}: every KPI needs a name`)
    if (Number(item.weight || 0) <= 0) throw new Error(`${item.question}: weight must be greater than 0`)

    if (['number','percentage'].includes(item.input_type)) {
      const target = Number(item.target_value)
      if (!Number.isFinite(target) || target < 0) throw new Error(`${item.question}: enter a valid expected target`)
    }

    if (item.input_type === 'choice') {
      const options = item.choice_options || []
      if (options.length < 2) throw new Error(`${item.question}: add at least two dropdown options`)
      const labels = options.map(x=>String(x.label||'').trim()).filter(Boolean)
      if (labels.length !== options.length) throw new Error(`${item.question}: every dropdown option needs a label`)
      if (new Set(labels.map(x=>x.toLowerCase())).size !== labels.length) throw new Error(`${item.question}: dropdown option labels must be unique`)
      for (const row of options) {
        const score = Number(row.score)
        if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error(`${item.question}: dropdown score must be between 0 and 100%`)
      }
    }
  }

  async function save(){
    setError('')
    try {
      if (!name.trim()) throw new Error('Template name is required')
      if (!department) throw new Error('Select a department')
      if (Math.abs(total - 100) > 0.001) throw new Error(`KRA total must equal 100. Current total: ${total}`)
      if (!kras.length) throw new Error('Add at least one KRA')

      kras.forEach(kra => {
        if (!kra.name.trim()) throw new Error('Every KRA needs a name')
        if (!kra.items.length) throw new Error(`${kra.name}: add at least one KPI`)
        const subtotal = Number(kra.items.reduce((sum,item)=>sum+Number(item.weight||0),0).toFixed(2))
        if (Math.abs(subtotal - Number(kra.weight)) > 0.001) throw new Error(`${kra.name}: KPI weights must total ${kra.weight}. Current total: ${subtotal}`)
        kra.items.forEach(item => validateItem(item,kra.name))
      })

      const dep = departments.find(d => String(d.id) === String(department))
      const payload = {
        name:name.trim(),
        division_id:dep?.parent_division_id ? Number(dep.parent_division_id) : null,
        department_id:Number(department),
        designation_id:designation ? Number(designation) : null,
        kras:kras.map(kra => ({
          name:kra.name.trim(),
          weight:Number(kra.weight || 0),
          items:kra.items.map(normalizedItem),
        }))
      }

      if (editId) await api.put(`/kpi/templates/${editId}`,payload)
      else await api.post('/kpi/templates',payload)
      navigate('/templates')
    } catch (e) {
      setError(getError(e))
    }
  }

  return <>
    <PageHeader
      title={editId ? 'Edit KPI Template' : 'Create KPI Template'}
      subtitle="Configure how each KPI is answered: Number, Percentage, or a custom Dropdown."
      actions={<div style={{display:'flex',gap:'8px'}}><button className="secondary" onClick={()=>navigate('/templates')}><ArrowLeft size={16}/>Back</button><button className="secondary" onClick={balanceAll}><Equal size={16}/>Auto-balance marks</button></div>}
    />
    <ErrorBox error={error}/>

    <Card>
      <div className="section-heading"><div><h3>Choose Department</h3><p className="muted small-copy">Department is the main hierarchy used to assign KPI templates.</p></div></div>
      <div className="form-grid" style={{gridTemplateColumns:'1fr 1fr'}}>
        <label>Department *<select value={department} onChange={e=>{setDepartment(e.target.value);setDesignation('')}}><option value="">Select department</option>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Role / designation<select value={designation} onChange={e=>setDesignation(e.target.value)} disabled={!department}><option value="">All roles in department</option>{designations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>
      <div className="helper-strip"><strong>Selected scope:</strong> {[selectedDepartment?.name,designations.find(d=>String(d.id)===String(designation))?.name].filter(Boolean).join(' / ') || 'Select department'}</div>
    </Card>

    <Card>
      <div className="form-grid">
        <label>Template name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Software Team KPI"/></label>
        <label>Department<input value={selectedDepartment?.name || ''} disabled/></label>
        <label>Total weight<input value={`${total} / 100`} disabled className={Math.abs(total-100)<0.001?'valid-field':'invalid-field'}/></label>
      </div>
      <div className="helper-strip"><strong>Example:</strong> Result type = Number, Expected target = 100 tasks. If employee completes 10, KPI Input shows Completed 10, Remaining 90, Achievement 10%, and awards 10% of that KPI's marks.</div>
    </Card>

    <div className="stack">
      {kras.map((kra,ki)=><Card key={ki}>
        <div className="kra-title">
          <div className="inline-fields"><input className="title-input" value={kra.name} onChange={e=>updateKra(ki,{name:e.target.value})}/><input className="weight-input" type="number" min="0" max="100" step="0.01" value={kra.weight} onChange={e=>updateKra(ki,{weight:Number(e.target.value)})}/><span>marks</span></div>
          <div className="row-actions"><button className="secondary small" onClick={()=>balanceItems(ki)}><Equal size={14}/>Balance KPIs</button><button className="icon-button danger" onClick={()=>setKras(current=>current.filter((_,i)=>i!==ki))}><Trash2 size={15}/></button></div>
        </div>

        <div className="dynamic-kpi-list">
          {kra.items.map((item,ii)=><div className="dynamic-kpi is-open" key={ii}>
            <div className="dynamic-kpi-head"><strong>KPI {ii+1}: {item.question || 'Untitled KPI'}</strong><button className="icon-button danger" onClick={()=>updateKra(ki,{items:kra.items.filter((_,x)=>x!==ii)})}><Trash2 size={14}/></button></div>
            <div className="form-grid four">
              <label className="span-2">KPI name<input value={item.question} onChange={e=>updateItem(ki,ii,{question:e.target.value})} placeholder="e.g. Assigned development tasks completed"/></label>
              <label className="span-2">Task responsibility<input value={item.task_responsibility} onChange={e=>updateItem(ki,ii,{task_responsibility:e.target.value})} placeholder="What should the employee complete?"/></label>

              <label>Result entry type
                <select value={item.input_type} onChange={e=>changeInputType(ki,ii,e.target.value)}>
                  <option value="number">Number / Quantity</option>
                  <option value="percentage">Percentage</option>
                  <option value="choice">Custom Dropdown</option>
                </select>
              </label>
              <label>Weight / marks<input type="number" min="0" max="100" step="0.01" value={item.weight} onChange={e=>updateItem(ki,ii,{weight:Number(e.target.value)})}/></label>

              {['number','percentage'].includes(item.input_type)?<>
                <label>Expected target *<input type="number" min="0" step="0.01" value={item.target_value ?? ''} onChange={e=>updateItem(ki,ii,{target_value:e.target.value})} placeholder={item.input_type==='percentage'?'100':'e.g. 100'}/></label>
                <label>Unit<input value={item.unit} onChange={e=>updateItem(ki,ii,{unit:e.target.value})} placeholder={item.input_type==='percentage'?'%':'tasks / calls / cases'}/></label>
                <label>Scoring direction<select value={item.direction} onChange={e=>updateItem(ki,ii,{direction:e.target.value})}><option value="higher">Higher result is better</option><option value="lower">Lower result is better</option></select></label>
              </>:null}

              {item.input_type==='choice'?<div className="span-2" style={{border:'1px solid #dbeafe',background:'#f8fbff',borderRadius:'10px',padding:'12px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',marginBottom:'10px'}}><div><strong>Dropdown options shown in KPI Input</strong><div className="cell-help">Set each label and the achievement percentage it gives.</div></div><button type="button" className="secondary small" onClick={()=>addChoiceOption(ki,ii)}><Plus size={13}/>Add option</button></div>
                <div style={{display:'grid',gridTemplateColumns:'minmax(160px,1fr) 140px 40px',gap:'8px',alignItems:'end'}}>
                  {(item.choice_options||[]).map((row,oi)=><div key={oi} style={{display:'contents'}}>
                    <label>Option {oi+1}<input value={row.label} onChange={e=>updateChoiceOption(ki,ii,oi,{label:e.target.value})} placeholder="Excellent"/></label>
                    <label>Score %<input type="number" min="0" max="100" step="1" value={row.score} onChange={e=>updateChoiceOption(ki,ii,oi,{score:e.target.value})}/></label>
                    <button type="button" className="icon-button danger" title="Remove option" onClick={()=>removeChoiceOption(ki,ii,oi)}><Trash2 size={14}/></button>
                  </div>)}
                </div>
              </div>:null}

              <label>Frequency<input value={item.frequency} onChange={e=>updateItem(ki,ii,{frequency:e.target.value})} placeholder="Monthly"/></label>
              <label className="span-2">Measurement / guidance<input value={item.measurement} onChange={e=>updateItem(ki,ii,{measurement:e.target.value})} placeholder="Explain what should be measured or counted"/></label>
              <label>Source<input value={item.source} onChange={e=>updateItem(ki,ii,{source:e.target.value})} placeholder="Policy / task system / manager"/></label>
              <label>Weight basis<input value={item.weight_basis} onChange={e=>updateItem(ki,ii,{weight_basis:e.target.value})}/></label>
            </div>
          </div>)}
        </div>
        <button className="text-action" onClick={()=>updateKra(ki,{items:[...kra.items,newItem(10)]})}><Plus size={15}/>Add KPI parameter</button>
      </Card>)}
    </div>

    <div className="footer-actions">
      <button className="secondary" onClick={()=>setKras(current=>[...current,{name:'New KRA',weight:0,items:[newItem(0)]}])}><Plus size={16}/>Add KRA</button>
      <button className="primary" onClick={save}><Save size={16}/>{editId?'Save draft changes':'Save draft template'}</button>
    </div>
  </>
}
