import {useEffect, useMemo, useState} from 'react'
import {ChevronDown,Equal,Plus,Save,Trash2} from 'lucide-react'
import {useNavigate, useSearchParams} from 'react-router-dom'
import {api, getError} from '../lib/api'
import {Card, ErrorBox, PageHeader} from '../components/UI'

const defaultChoices = {'Excellent':100, 'Good':80, 'Average':60, 'Poor':40, 'Not achieved':0}
const yesNoChoices = {'Yes':100, 'No':0}
const choiceText = map => Object.entries(map || {}).map(([k,v]) => `${k}:${v}`).join(', ')
const splitWeight = (total, count) => {
  if (!count) return []
  const base = Math.floor((Number(total || 0) / count) * 100) / 100
  const out = Array(count).fill(base)
  out[count - 1] = Number((Number(total || 0) - base * (count - 1)).toFixed(2))
  return out
}
const newItem = (weight=10, choices=defaultChoices, cap=100, evidenceDefault=false) => ({
  question:'', input_type:'percentage', weight, target_value:100, direction:'higher', frequency:'Monthly', unit:'%',
  measurement:'', evidence_required:evidenceDefault, scoring_method:'target_ratio', score_cap_pct:cap,
  choice_map:choiceText(choices), max_rating:5, source:'', weight_basis:'Configured by HR'
})

export default function TemplateBuilder() {
  const [params] = useSearchParams()
  const editId = params.get('edit')
  const [masters, setMasters] = useState([])
  const [name, setName] = useState('')
  const [designation, setDesignation] = useState('')
  const [kras, setKras] = useState([{name:'New KRA', weight:100, items:[newItem(100)]}])
  const [version, setVersion] = useState(1)
  const [orgDefaults, setOrgDefaults] = useState({choiceMap:defaultChoices,scoreCap:100,evidenceDefault:false})
  const [error, setError] = useState('')
  const [expandedKpi, setExpandedKpi] = useState('0-0')
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([api.get('/admin/masters'), api.get('/kpi/templates'), api.get('/admin/settings')])
      .then(([m, t, settings]) => {
        setMasters(m.data)
        const defaults={choiceMap:settings.data.default_choice_map||defaultChoices,scoreCap:settings.data.score_cap_pct||100,evidenceDefault:!!settings.data.require_evidence_by_default}
        setOrgDefaults(defaults)
        if (!editId) setKras([{name:'New KRA',weight:100,items:[newItem(100,defaults.choiceMap,defaults.scoreCap,defaults.evidenceDefault)]}])
        if (editId) {
          const found = t.data.find(x => String(x.id) === String(editId))
          if (!found) throw new Error('Template not found')
          if (found.status !== 'draft') throw new Error('Only draft templates can be edited')
          setName(found.name); setDesignation(found.designation_id || ''); setVersion(found.version)
          setKras(found.kras.map(k => ({
            name:k.name, weight:k.weight,
            items:k.items.map(i => {
              const cfg = i.config || {}; const meta = cfg.meta || {}; const map = cfg.score_map || {}
              return {
                question:i.question, input_type:i.input_type, weight:i.weight, target_value:i.target_value,
                direction:i.direction, frequency:meta.frequency || 'Monthly', unit:meta.unit || (i.input_type==='percentage'?'%':''),
                measurement:meta.measurement || '', evidence_required:!!meta.evidence_required,
                scoring_method:meta.scoring_method || 'target_ratio', score_cap_pct:meta.score_cap_pct || 100,
                choice_map:choiceText(Object.keys(map).length ? map : (i.input_type==='yesno'?yesNoChoices:defaultChoices)),
                max_rating:cfg.max_rating || 5, source:meta.source || '', weight_basis:meta.weight_basis || 'Configured by HR'
              }
            })
          })))
        }
      })
      .catch(e => setError(getError(e)))
  }, [editId])

  const total = useMemo(() => Number(kras.reduce((s,k) => s + Number(k.weight || 0), 0).toFixed(2)), [kras])
  const designations = masters.flatMap(d => d.departments.flatMap(dep => dep.designations.map(x => ({...x, label:`${d.name} / ${dep.name} / ${x.name}`}))))

  function updateKra(idx, patch) { setKras(current => current.map((k,i) => i === idx ? {...k, ...patch} : k)) }
  function updateItem(ki, ii, patch) {
    setKras(current => current.map((k,kIndex) => kIndex !== ki ? k : ({...k,items:k.items.map((x,i) => i === ii ? {...x,...patch} : x)})))
  }
  function parseMap(text, fallback) {
    const map = {}
    String(text || '').split(',').forEach(part => {
      const idx = part.lastIndexOf(':'); if (idx < 1) return
      const label = part.slice(0,idx).trim(); const value = Number(part.slice(idx+1).trim())
      if (label && Number.isFinite(value)) map[label] = value
    })
    return Object.keys(map).length ? map : fallback
  }
  function normalizeItem(i) {
    const scoreMap = i.input_type === 'yesno' ? parseMap(i.choice_map, yesNoChoices) : i.input_type === 'choice' ? parseMap(i.choice_map, orgDefaults.choiceMap) : {}
    const meta = {
      frequency:i.frequency || 'Monthly', unit:i.unit || '', measurement:i.measurement || '', evidence_required:!!i.evidence_required,
      scoring_method:i.scoring_method || 'target_ratio', score_cap_pct:Number(i.score_cap_pct || 100), source:i.source || '', weight_basis:i.weight_basis || 'Configured by HR'
    }
    const options = {score_map:scoreMap, meta}
    if (i.input_type === 'rating') options.max = Number(i.max_rating || 5)
    return {
      question:i.question.trim(), input_type:i.input_type, weight:Number(i.weight || 0),
      target_value:i.target_value === '' || ['choice','yesno','rating'].includes(i.input_type) ? null : Number(i.target_value),
      direction:i.direction, options
    }
  }
  function balanceAll() {
    const kraWeights = splitWeight(100, kras.length)
    setKras(current => current.map((k,idx) => {
      const kw = kraWeights[idx]
      const iw = splitWeight(kw, k.items.length)
      return {...k, weight:kw, items:k.items.map((x,i) => ({...x,weight:iw[i]}))}
    }))
  }
  function balanceItems(ki) {
    setKras(current => current.map((k,idx) => {
      if (idx !== ki) return k
      const weights = splitWeight(k.weight, k.items.length)
      return {...k,items:k.items.map((x,i)=>({...x,weight:weights[i]}))}
    }))
  }

  async function save() {
    setError('')
    try {
      if (!name.trim()) throw new Error('Template name is required')
      if (total > 100.001) throw new Error(`KRA total cannot exceed 100. Current total: ${total}`)
      if (!kras.length) throw new Error('Add at least one KRA')
      kras.forEach(k => {
        if (!k.name.trim()) throw new Error('Every KRA needs a name')
        if (!k.items.length) throw new Error(`${k.name}: add at least one KPI parameter`)
        const subtotal = Number(k.items.reduce((s,i)=>s+Number(i.weight||0),0).toFixed(2))
        if (subtotal > Number(k.weight) + 0.001) throw new Error(`${k.name}: KPI weights (${subtotal}) cannot exceed KRA weight (${k.weight})`)
        if (k.items.some(i => !i.question.trim())) throw new Error(`${k.name}: every KPI parameter needs a name`)
      })
      const payload = {name:name.trim(),designation_id:designation?Number(designation):null,kras:kras.map(k=>({name:k.name.trim(),weight:Number(k.weight||0),items:k.items.map(normalizeItem)}))}
      if (editId) await api.put(`/kpi/templates/${editId}`, payload); else await api.post('/kpi/templates', payload)
      navigate('/templates')
    } catch (e) { setError(getError(e)) }
  }

  return <>
    <PageHeader title={editId ? `Edit KPI Template v${version}` : 'Create KPI Template'} subtitle="Create a simple task list for one department or role: task, completion method, target and actual achievement." actions={<button className="secondary" onClick={balanceAll}><Equal size={16}/>Auto-balance marks</button>}/>
    <ErrorBox error={error}/>
    <Card>
      <div className="form-grid">
        <label>Template name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. SVP Projects"/></label>
        <label>Designation<select value={designation} onChange={e=>setDesignation(e.target.value)}><option value="">Any designation</option>{designations.map(x=><option value={x.id} key={x.id}>{x.label}</option>)}</select></label>
        <label>Total weight<input value={`${total} / 100`} disabled className={Math.abs(total-100)<0.001?'valid-field':'invalid-field'}/></label>
      </div>
      <div className="helper-strip"><strong>Simple setup:</strong> Add a section, write each task, explain how it is completed, then set the expected target. Advanced scoring is optional.</div>
    </Card>

    <div className="stack">{kras.map((k,ki)=><Card key={ki}>
      <div className="kra-title">
        <div className="inline-fields"><input className="title-input" value={k.name} onChange={e=>updateKra(ki,{name:e.target.value})}/><input className="weight-input" type="number" min="0" max="100" step="0.01" value={k.weight} onChange={e=>updateKra(ki,{weight:Number(e.target.value)})}/><span>marks</span></div>
        <div className="row-actions"><button className="secondary small" onClick={()=>balanceItems(ki)}><Equal size={14}/>Balance items</button><button className="icon-button danger" aria-label="Delete KRA" onClick={()=>setKras(current=>current.filter((_,i)=>i!==ki))}><Trash2 size={16}/></button></div>
      </div>
      <div className="dynamic-kpi-list">{k.items.map((i,ii)=>{const itemKey=`${ki}-${ii}`,isOpen=expandedKpi===itemKey;return <div className={`dynamic-kpi ${isOpen?'is-open':''}`} key={ii}>
        <div className="dynamic-kpi-head"><button type="button" className="kpi-expander" onClick={()=>setExpandedKpi(isOpen?'':itemKey)}><span className="kpi-number">KPI {ii+1}</span><span className="kpi-summary">{i.question||'Untitled KPI parameter'}</span><ChevronDown size={16} className={isOpen?'rotate':''}/></button><div className="row-actions"><button type="button" className="secondary small" onClick={save}><Save size={13}/>Save KPI</button><button type="button" className="icon-button danger" aria-label={`Delete KPI ${ii+1}`} onClick={()=>updateKra(ki,{items:k.items.filter((_,x)=>x!==ii)})}><Trash2 size={15}/></button></div></div>
        {isOpen?<div className="kpi-editor"><div className="editor-hint">Edit the fields below, then use <b>Save KPI</b>. Add advanced scoring details only when your KPI needs them.</div><div className="form-grid four">
          <label className="span-2">Task / responsibility<input value={i.question} onChange={e=>updateItem(ki,ii,{question:e.target.value})} placeholder="e.g. Complete Java/Spring Boot development tasks"/></label>
          <label>Answer type<select value={i.input_type} onChange={e=>updateItem(ki,ii,{input_type:e.target.value,choice_map:e.target.value==='yesno'?choiceText(yesNoChoices):e.target.value==='choice'?choiceText(orgDefaults.choiceMap):i.choice_map})}><option value="percentage">Percentage</option><option value="number">Number</option><option value="currency">Currency</option><option value="days">Days / TAT</option><option value="count">Count</option><option value="choice">Objective choice</option><option value="yesno">Yes / No</option><option value="rating">Rating</option></select></label>
          <label>Marks<input type="number" min="0" max="100" step="0.01" value={i.weight} onChange={e=>updateItem(ki,ii,{weight:Number(e.target.value)})}/></label>
          <label>Expected target<input type="number" step="0.01" disabled={['choice','yesno','rating'].includes(i.input_type)} value={i.target_value ?? ''} onChange={e=>updateItem(ki,ii,{target_value:e.target.value})} placeholder="Optional"/></label>
          <label>Direction<select disabled={['choice','yesno','rating'].includes(i.input_type)} value={i.direction} onChange={e=>updateItem(ki,ii,{direction:e.target.value})}><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select></label>
          <label>Frequency<input value={i.frequency} onChange={e=>updateItem(ki,ii,{frequency:e.target.value})} placeholder="Monthly / Weekly / Per Release"/></label>
          <label>Unit<input value={i.unit} onChange={e=>updateItem(ki,ii,{unit:e.target.value})} placeholder="%, ₹, days, count"/></label>
          <label>Scoring<select value={i.scoring_method} onChange={e=>updateItem(ki,ii,{scoring_method:e.target.value})}><option value="target_ratio">Target vs actual</option><option value="direct_percentage">Direct percentage</option></select></label>
          <label>Score cap %<input type="number" min="100" max="200" value={i.score_cap_pct} onChange={e=>updateItem(ki,ii,{score_cap_pct:e.target.value})}/></label>
          <label className="span-2">How is this completed?<input value={i.measurement} onChange={e=>updateItem(ki,ii,{measurement:e.target.value})} placeholder="e.g. Finish assigned stories, test them, and submit before the sprint closes"/></label>
          {['choice','yesno'].includes(i.input_type)?<label className="span-2">Answer → score mapping<input value={i.choice_map} onChange={e=>updateItem(ki,ii,{choice_map:e.target.value})} placeholder="Excellent:100, Good:80, ..."/></label>:null}
          {i.input_type==='rating'?<label>Maximum rating<input type="number" min="2" max="10" value={i.max_rating} onChange={e=>updateItem(ki,ii,{max_rating:e.target.value})}/></label>:null}
          <label>Evidence<select value={i.evidence_required?'yes':'no'} onChange={e=>updateItem(ki,ii,{evidence_required:e.target.value==='yes'})}><option value="no">Optional</option><option value="yes">Required</option></select></label>
          <label>Source<input value={i.source} onChange={e=>updateItem(ki,ii,{source:e.target.value})} placeholder="Policy / KPI document / HR"/></label>
          <label className="span-2">Weight basis<input value={i.weight_basis} onChange={e=>updateItem(ki,ii,{weight_basis:e.target.value})}/></label>
        </div></div>:null}
      </div>})}</div>
      <button className="text-action" onClick={()=>updateKra(ki,{items:[...k.items,newItem(10,orgDefaults.choiceMap,orgDefaults.scoreCap,orgDefaults.evidenceDefault)]})}><Plus size={15}/>Add KPI parameter</button>
    </Card>)}</div>

    <div className="footer-actions"><button className="secondary" onClick={()=>setKras(current=>[...current,{name:'New KRA',weight:0,items:[newItem(0,orgDefaults.choiceMap,orgDefaults.scoreCap,orgDefaults.evidenceDefault)]}])}><Plus size={16}/>Add KRA</button><button className="primary" onClick={save}>{editId?'Save draft changes':'Save draft template'}</button></div>
  </>
}
