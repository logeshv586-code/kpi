import {useEffect, useMemo, useState} from 'react'
import {ArrowLeft, ChevronDown, Equal, Plus, Save, Trash2} from 'lucide-react'
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
  question:'', task_responsibility:'', input_type:'percentage', weight, score_limit:weight, target_value:100, direction:'higher', frequency:'Monthly', unit:'%',
  measurement:'', evidence_required:evidenceDefault, scoring_method:'target_ratio', score_cap_pct:cap,
  choice_map:choiceText(choices), max_rating:5, source:'', weight_basis:'Configured by HR'
})

const sampleTemplates = {
  software_developer: {
    name: "Software Developer Sample Template",
    kras: [
      {
        name: "Delivery & Sprint Tasks",
        weight: 40,
        items: [
          { question: "Assigned development tasks completed on time", task_responsibility: "Complete all assigned sprint tasks within deadline", input_type: "percentage", weight: 25, score_limit: 25, target_value: 100, direction: "higher", frequency: "Monthly", unit: "%", measurement: "Percentage of sprint tasks completed without delay", evidence_required: false, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "Engineering Policy", weight_basis: "Configured by HR" },
          { question: "Code review and technical documentation", task_responsibility: "Submit pull requests with proper tests and documentation", input_type: "percentage", weight: 15, score_limit: 15, target_value: 100, direction: "higher", frequency: "Monthly", unit: "%", measurement: "PR approval rate and technical notes adherence", evidence_required: false, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "Engineering Policy", weight_basis: "Configured by HR" }
        ]
      },
      {
        name: "Quality & System Stability",
        weight: 40,
        items: [
          { question: "Defects and production bug count", task_responsibility: "Minimize post-release defects and resolve assigned bugs within SLA", input_type: "number", weight: 20, score_limit: 20, target_value: 0, direction: "lower", frequency: "Monthly", unit: "count", measurement: "Number of production bugs reported", evidence_required: true, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "QA Report", weight_basis: "Configured by HR" },
          { question: "Unit test coverage & code quality score", task_responsibility: "Maintain automated test coverage for developed services", input_type: "percentage", weight: 20, score_limit: 20, target_value: 80, direction: "higher", frequency: "Monthly", unit: "%", measurement: "SonarQube / test coverage report %", evidence_required: false, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "SonarQube", weight_basis: "Configured by HR" }
        ]
      },
      {
        name: "Team Collaboration & Learning",
        weight: 20,
        items: [
          { question: "Knowledge sharing & continuous improvement", task_responsibility: "Conduct KT sessions and contribute reusable code modules", input_type: "choice", weight: 20, score_limit: 20, target_value: null, direction: "higher", frequency: "Monthly", unit: "", measurement: "Evaluation by Team Lead / Manager", evidence_required: false, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "Manager Review", weight_basis: "Configured by HR" }
        ]
      }
    ]
  },
  project_manager: {
    name: "Project Manager Sample Template",
    kras: [
      {
        name: "Project Planning & Delivery",
        weight: 50,
        items: [
          { question: "Milestones completed on schedule", task_responsibility: "Ensure all key project milestones are achieved on time", input_type: "percentage", weight: 25, score_limit: 25, target_value: 100, direction: "higher", frequency: "Monthly", unit: "%", measurement: "Milestone completion rate %", evidence_required: true, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "PMO Report", weight_basis: "Configured by HR" },
          { question: "Deliverables completed within timeline", task_responsibility: "Deliver client artifacts without schedule slippage", input_type: "percentage", weight: 25, score_limit: 25, target_value: 100, direction: "higher", frequency: "Monthly", unit: "%", measurement: "On-time deliverable percentage", evidence_required: false, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "PMO Report", weight_basis: "Configured by HR" }
        ]
      },
      {
        name: "Cost Control & Governance",
        weight: 50,
        items: [
          { question: "Projects within approved budget", task_responsibility: "Prevent cost overrun and manage resource allocation", input_type: "percentage", weight: 25, score_limit: 25, target_value: 100, direction: "higher", frequency: "Monthly", unit: "%", measurement: "Budget adherence %", evidence_required: false, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "Finance", weight_basis: "Configured by HR" },
          { question: "Client & stakeholder satisfaction", task_responsibility: "Maintain strong client relationships and resolve escalations", input_type: "choice", weight: 25, score_limit: 25, target_value: null, direction: "higher", frequency: "Monthly", unit: "", measurement: "Client feedback & escalation log", evidence_required: false, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "Client Survey", weight_basis: "Configured by HR" }
        ]
      }
    ]
  },
  finance_manager: {
    name: "Finance Manager Sample Template",
    kras: [
      {
        name: "Billing & Collections",
        weight: 50,
        items: [
          { question: "Invoices raised on time with accuracy", task_responsibility: "Generate customer invoices promptly at milestone triggers", input_type: "percentage", weight: 25, score_limit: 25, target_value: 100, direction: "higher", frequency: "Monthly", unit: "%", measurement: "Invoicing accuracy and timeliness %", evidence_required: true, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "Finance Policy", weight_basis: "Configured by HR" },
          { question: "Collections collected within terms", task_responsibility: "Follow up and collect due payments without overdue aging", input_type: "percentage", weight: 25, score_limit: 25, target_value: 95, direction: "higher", frequency: "Monthly", unit: "%", measurement: "Collection efficiency ratio %", evidence_required: false, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "Receivables Log", weight_basis: "Configured by HR" }
        ]
      },
      {
        name: "Financial Reporting & Audit",
        weight: 50,
        items: [
          { question: "Monthly MIS & financial statements", task_responsibility: "Prepare monthly balance sheet and profit & loss statements", input_type: "percentage", weight: 30, score_limit: 30, target_value: 100, direction: "higher", frequency: "Monthly", unit: "%", measurement: "On-time submission of MIS", evidence_required: true, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "Management Policy", weight_basis: "Configured by HR" },
          { question: "Statutory filings and compliance", task_responsibility: "Ensure GST, TDS, and statutory filings are completed on time", input_type: "percentage", weight: 20, score_limit: 20, target_value: 100, direction: "higher", frequency: "Monthly", unit: "%", measurement: "Zero penalty statutory compliance", evidence_required: false, scoring_method: "target_ratio", score_cap_pct: 100, choice_map: choiceText(defaultChoices), max_rating: 5, source: "Compliance Audit", weight_basis: "Configured by HR" }
        ]
      }
    ]
  }
}

export default function TemplateBuilder() {
  const [params] = useSearchParams()
  const editId = params.get('edit')
  const sampleParam = params.get('sample')
  const divisionParam = params.get('division')
  const departmentParam = params.get('department')
  const designationParam = params.get('designation')

  const [masters, setMasters] = useState([])
  const [name, setName] = useState('')
  const [division, setDivision] = useState('')
  const [department, setDepartment] = useState('')
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

        if (divisionParam) setDivision(divisionParam)
        if (departmentParam) setDepartment(departmentParam)
        if (designationParam) setDesignation(designationParam)

        if (!editId) {
          if (sampleParam && sampleTemplates[sampleParam]) {
            const sampleObj = sampleTemplates[sampleParam]
            setName(sampleObj.name)
            setKras(sampleObj.kras)
          } else {
            setKras([{name:'New KRA',weight:100,items:[newItem(100,defaults.choiceMap,defaults.scoreCap,defaults.evidenceDefault)]}])
          }
        }

        if (editId) {
          const found = t.data.find(x => String(x.id) === String(editId))
          if (!found) throw new Error('Template not found')
          if (found.status !== 'draft') throw new Error('Only draft templates can be edited')
          setName(found.name); setDivision(found.division_id || ''); setDepartment(found.department_id || ''); setDesignation(found.designation_id || ''); setVersion(found.version)
          setKras(found.kras.map(k => ({
            name:k.name, weight:k.weight,
            items:k.items.map(i => {
              const cfg = i.config || {}; const meta = cfg.meta || {}; const map = cfg.score_map || {}
              return {
                question:i.question, task_responsibility:meta.task_responsibility || i.question || 'Complete assigned KPI task', input_type:i.input_type, weight:i.weight, score_limit:Number(meta.score_limit ?? i.weight), target_value:i.target_value,
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
  }, [editId, sampleParam, divisionParam, departmentParam, designationParam])

  const total = useMemo(() => Number(kras.reduce((s,k) => s + Number(k.weight || 0), 0).toFixed(2)), [kras])
  const divisions = masters
  const departments = divisions.filter(d => !division || String(d.id) === String(division)).flatMap(d => d.departments.map(dep => ({...dep, division_name:d.name})))
  const designations = departments.filter(dep => !department || String(dep.id) === String(department)).flatMap(dep => dep.designations.map(x => ({...x, label:`${dep.division_name} / ${dep.name} / ${x.name}`})))

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
      scoring_method:i.scoring_method || 'target_ratio', score_cap_pct:i.score_limit != null ? Math.min(100, Number(i.score_limit) / Math.max(1, Number(i.weight || 0)) * 100) : Number(i.score_cap_pct || 100), source:i.source || '', weight_basis:i.weight_basis || 'Configured by HR', task_responsibility:(i.task_responsibility || i.question || 'Complete assigned KPI task').trim(), score_limit:Number(i.score_limit ?? (i.weight || 0))
    }
    const options = {score_map:scoreMap, meta}
    if (i.input_type === 'rating') options.max = Number(i.max_rating || 5)
    return {
      question:i.question.trim(), input_type:i.input_type, weight:Number(i.weight || 0),
      target_value:i.target_value === '' || ['choice','yesno','rating'].includes(i.input_type) ? null : Number(i.target_value),
      direction:i.direction, options
    }
  }
  function validateScoreMap(item) {
    const scoreLimit=Number(item.score_limit ?? item.weight)
    if (!Number.isFinite(scoreLimit) || scoreLimit < 0 || scoreLimit > Number(item.weight || 0)) throw new Error(`${item.question || 'KPI'}: score must be between 0 and the weight base`)
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
        if (k.items.some(i => !i.question.trim())) throw new Error(`${k.name}: every KPI needs a name`)
        k.items.forEach(validateScoreMap)
      })
      const payload = {name:name.trim(),division_id:division?Number(division):null,department_id:department?Number(department):null,designation_id:designation?Number(designation):null,kras:kras.map(k=>({name:k.name.trim(),weight:Number(k.weight||0),items:k.items.map(normalizeItem)}))}
      if (editId) await api.put(`/kpi/templates/${editId}`, payload); else await api.post('/kpi/templates', payload)
      navigate('/templates')
    } catch (e) { setError(getError(e)) }
  }

  return <>
    <PageHeader 
      title={editId ? 'Edit KPI Template' : 'Create KPI Template'} 
      subtitle="Create a simple task list with only the KPI name, responsibility, weight base, measurement and answer type." 
      actions={
        <div style={{display:'flex',gap:'8px'}}>
          <button className="secondary" onClick={()=>navigate('/templates')}>
            <ArrowLeft size={16}/>Back to Templates
          </button>
          <button className="secondary" onClick={balanceAll}>
            <Equal size={16}/>Auto-balance marks
          </button>
        </div>
      }
    />
    <ErrorBox error={error}/>
    <Card>
      <div className="section-heading"><div><h3>Choose where this KPI applies</h3><p className="muted small-copy">Start with the organization hierarchy. The selected scope controls which employees can receive this template.</p></div></div>
      <div className="form-grid hierarchy-selector-grid">
        <label>Division<select value={division} onChange={e=>{setDivision(e.target.value);setDepartment('');setDesignation('')}}><option value="">All divisions</option>{divisions.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
        <label>Department<select value={department} onChange={e=>{setDepartment(e.target.value);setDesignation('')}}><option value="">All departments</option>{departments.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
        <label>Role / designation<select value={designation} onChange={e=>setDesignation(e.target.value)}><option value="">All roles</option>{designations.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
      </div>
      <div className="helper-strip"><strong>Selected scope:</strong> {[divisions.find(d=>String(d.id)===String(division))?.name, departments.find(d=>String(d.id)===String(department))?.name, designations.find(d=>String(d.id)===String(designation))?.name].filter(Boolean).join(' / ') || 'Everyone'}</div>
    </Card>
    <Card>
      <div className="form-grid">
        <label>Template name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. SVP Projects"/></label>
        <label>Applies to<input value={[divisions.find(d=>String(d.id)===String(division))?.name, departments.find(d=>String(d.id)===String(department))?.name, designations.find(d=>String(d.id)===String(designation))?.name].filter(Boolean).join(' / ') || 'Everyone'} disabled/></label>
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
          <label className="span-2">KPI name<input value={i.question} onChange={e=>updateItem(ki,ii,{question:e.target.value})} placeholder="e.g. Java/Spring Boot development"/></label>
          <label className="span-2">Task responsibility<input value={i.task_responsibility} onChange={e=>updateItem(ki,ii,{task_responsibility:e.target.value})} placeholder="What must the employee complete?"/></label>
          <label>Answer type<select value={['percentage','number','choice'].includes(i.input_type)?i.input_type:'percentage'} onChange={e=>updateItem(ki,ii,{input_type:e.target.value,choice_map:e.target.value==='choice'?choiceText(orgDefaults.choiceMap):i.choice_map})}><option value="percentage">Percentage</option><option value="number">Number</option><option value="choice">Objective</option></select></label>
          <label>Score <span className="field-note">Maximum weight base: {i.weight}</span><input type="number" min="0" max={i.weight} step="0.01" value={i.score_limit} onChange={e=>updateItem(ki,ii,{score_limit:e.target.value})} placeholder="Enter score"/></label>
          <label>Expected target<input type="number" step="0.01" disabled={['choice','yesno','rating'].includes(i.input_type)} value={i.target_value ?? ''} onChange={e=>updateItem(ki,ii,{target_value:e.target.value})} placeholder="Optional"/></label>
          <label>Direction<select disabled={['choice','yesno','rating'].includes(i.input_type)} value={i.direction} onChange={e=>updateItem(ki,ii,{direction:e.target.value})}><option value="higher">Higher is better</option><option value="lower">Lower is better</option></select></label>
          <label>Frequency<input value={i.frequency} onChange={e=>updateItem(ki,ii,{frequency:e.target.value})} placeholder="Monthly / Weekly / Per Release"/></label>
          <label>Unit<input value={i.unit} onChange={e=>updateItem(ki,ii,{unit:e.target.value})} placeholder="%, ₹, days, count"/></label>
          <label>Scoring<select value={i.scoring_method} onChange={e=>updateItem(ki,ii,{scoring_method:e.target.value})}><option value="target_ratio">Target vs actual</option><option value="direct_percentage">Direct percentage</option></select></label>
          <label>Score cap %<input type="number" min="100" max="200" value={i.score_cap_pct} onChange={e=>updateItem(ki,ii,{score_cap_pct:e.target.value})}/></label>
          <label className="span-2">Measurement<input value={i.measurement} onChange={e=>updateItem(ki,ii,{measurement:e.target.value})} placeholder="How will achievement be measured?"/></label>
          {['choice','yesno'].includes(i.input_type)?<label className="span-2">Answer → score mapping<input value={i.choice_map} onChange={e=>updateItem(ki,ii,{choice_map:e.target.value})} placeholder="Excellent:100, Good:80, ..."/></label>:null}
          {i.input_type==='rating'?<label>Maximum rating<input type="number" min="2" max="10" value={i.max_rating} onChange={e=>updateItem(ki,ii,{max_rating:e.target.value})}/></label>:null}
          <label>Evidence<select value={i.evidence_required?'yes':'no'} onChange={e=>updateItem(ki,ii,{evidence_required:e.target.value==='yes'})}><option value="no">Optional</option><option value="yes">Required</option></select></label>
          <label>Source<input value={i.source} onChange={e=>updateItem(ki,ii,{source:e.target.value})} placeholder="Policy / KPI document / HR"/></label>
          <label className="span-2">Weight basis<input value={i.weight_basis} onChange={e=>updateItem(ki,ii,{weight_basis:e.target.value})}/></label>
        </div></div>:null}
      </div>})}</div>
      <button className="text-action" onClick={()=>updateKra(ki,{items:[...k.items,newItem(10,orgDefaults.choiceMap,orgDefaults.scoreCap,orgDefaults.evidenceDefault)]})}><Plus size={15}/>Add KPI parameter</button>
    </Card>)}</div>

    <div className="footer-actions">
      <button className="secondary" onClick={()=>navigate('/templates')}>Back to Templates</button>
      <button className="secondary" onClick={()=>setKras(current=>[...current,{name:'New KRA',weight:0,items:[newItem(0,orgDefaults.choiceMap,orgDefaults.scoreCap,orgDefaults.evidenceDefault)]}])}>
        <Plus size={16}/>Add KRA
      </button>
      <button className="primary" onClick={save}>
        {editId?'Save draft changes':'Save draft template'}
      </button>
    </div>
  </>
}
