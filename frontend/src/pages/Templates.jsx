import {useEffect, useMemo, useState} from 'react'
import {Check, Download, Eye, FileUp, FolderTree, Pencil, Plus, Table, Trash2, Undo2} from 'lucide-react'
import {Link, useNavigate} from 'react-router-dom'
import {api, downloadApiFile, getError, apiPostForm} from '../lib/api'
import {canAccessTab, useAuth} from '../lib/auth'
import {Card, ErrorBox, Loader, Modal, PageHeader, Status} from '../components/UI'

export default function Templates(){
  const {user} = useAuth()
  const isAdmin = canAccessTab(user, 'templates', true)
  const [rows, setRows] = useState(null)
  const [masters, setMasters] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [viewMode, setViewMode] = useState('hierarchy')
  const [previewTemplate, setPreviewTemplate] = useState(null)
  const [importForm, setImportForm] = useState({name: 'Imported KPI Template', designation_id: '', file: null})
  const [importErrors, setImportErrors] = useState({})
  const navigate = useNavigate()

  const departments = useMemo(() => masters.flatMap(d => d.departments.map(dep => ({...dep, parent_division_id: d.id}))), [masters])
  const departmentOptions = useMemo(() => [...new Set(departments.map(d => d.name))].sort(), [departments])
  const designations = useMemo(() => departments.flatMap(dep => dep.designations.map(x => ({...x, label: `${dep.name} / ${x.name}`}))), [departments])

  const load = () => Promise.all([api.get('/kpi/templates'), api.get('/admin/masters')])
    .then(([r, m]) => { setRows(r.data); setMasters(m.data) })
    .catch(e => setError(getError(e)))

  useEffect(() => { load() }, [])
  useEffect(() => {
    document.body.classList.add('templates-page')
    return () => document.body.classList.remove('templates-page')
  }, [])

  async function publish(id){
    try {
      setError(''); setMessage('')
      await api.post(`/kpi/templates/${id}/publish`)
      setMessage('Template published and ready for assignment.')
      load()
    } catch (e) {
      setError(getError(e))
    }
  }

  function editTarget(t){
    navigate(`/templates/new?edit=${t.id}`)
  }

  async function unpublish(id){
    if (!window.confirm('Move this published template back to draft?')) return
    try {
      setError('')
      await api.post(`/kpi/templates/${id}/unpublish`)
      setMessage('Template unpublished. You can edit it now.')
      load()
    } catch (e) {
      setError(getError(e))
    }
  }

  async function removeTemplate(id){
    if (!window.confirm('Are you sure you want to remove this template? Any associated assignment records will also be removed.')) return
    try {
      setError('')
      await api.delete(`/kpi/templates/${id}`)
      setMessage('Template removed successfully.')
      load()
    } catch (e) {
      setError(getError(e))
    }
  }

  async function downloadTemplateSample(){
    try {
      await downloadApiFile('/admin/samples/template', 'KPI_Template_Import_Sample.xlsx')
    } catch (e) {
      setError(getError(e))
    }
  }

  async function importFile(){
    const errors = {}
    if (!importForm.file) errors.file = 'Choose an Excel or CSV file.'
    if (!importForm.name.trim()) errors.name = 'Template name is required.'
    if (Object.keys(errors).length) { setImportErrors(errors); setError('Complete the required fields highlighted in red.'); return }
    try {
      setError(''); setMessage(''); setImportErrors({})
      const ext = importForm.file.name.toLowerCase().split('.').pop()
      let data
      if (ext === 'csv') {
        const csv_text = await importForm.file.text()
        ;({data} = await api.post('/kpi/templates/import-csv', {
          name: importForm.name,
          designation_id: importForm.designation_id ? Number(importForm.designation_id) : null,
          csv_text
        }))
      } else {
        const fd = new FormData()
        fd.append('file', importForm.file)
        fd.append('name', importForm.name)
        if (importForm.designation_id) fd.append('designation_id', importForm.designation_id)
        ;({data} = await apiPostForm('/kpi/templates/import-excel', fd))
      }
      setMessage(`Imported ${data.kras.length} KRA(s) as a draft template. Review before publishing.`)
      setShowImport(false)
      setImportForm({name: 'Imported KPI Template', designation_id: '', file: null}); setImportErrors({})
      load()
    } catch (e) {
      setError(getError(e))
    }
  }

  const visibleRows = useMemo(() => (rows || []).filter(t => !departmentFilter || t.department === departmentFilter), [rows, departmentFilter])
  const departmentGroups = useMemo(() => {
    const groups = {}
    visibleRows.forEach(t => {
      const key = t.department || 'General Department'
      if (!groups[key]) groups[key] = []
      groups[key].push(t)
    })
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  }, [visibleRows])

  function departmentIdByName(name){
    return departments.find(d => d.name === name)?.id || ''
  }

  return (
    <>
      <PageHeader
        title="KPI Templates & Hierarchy"
        subtitle="Department-first KPI hierarchy. Choose a department, then view or edit its KPI templates."
        actions={isAdmin ? (
          <>
            <button className="secondary" onClick={() => setShowImport(v => !v)}><FileUp size={16}/>Import</button>
            <Link className="primary" to="/templates/new"><Plus size={16}/>Create template</Link>
          </>
        ) : null}
      />
      <ErrorBox error={error}/>
      {message ? <div className="success-box">{message}</div> : null}

      <Card style={{padding: '14px 18px', marginBottom: '16px'}}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px'}}>
          <label style={{display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 600, color: '#334155', margin: 0}}>
            Department
            <select value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)} style={{width: '200px', height: '36px', padding: '6px 10px', fontSize: '0.85rem'}}>
              <option value="">All departments</option>
              {departmentOptions.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px', background: '#f8fafc', padding: '4px 8px', borderRadius: '8px', border: '1px solid #e2e8f0'}}>
            <span style={{fontSize: '0.8rem', fontWeight: 600, color: '#64748b'}}>View:</span>
            <button className={viewMode === 'hierarchy' ? 'primary small' : 'secondary small'} onClick={() => setViewMode('hierarchy')}><FolderTree size={14}/>Department View</button>
            <button className={viewMode === 'table' ? 'primary small' : 'secondary small'} onClick={() => setViewMode('table')}><Table size={14}/>Table View</button>
          </div>
        </div>
      </Card>

      {showImport ? (
        <Card className="import-card">
          <h3>Import a KPI template</h3>
          <p className="muted small-copy">Field names: KRA Name, KRA Weight / Marks, KPI Name, Task Responsibility, Result Entry Type, Weight / Marks, Expected Target, Unit, Scoring Direction, Frequency, Measurement / Guidance, Custom Dropdown Results, Source, Weight Basis.</p>
          <button type="button" className="secondary" onClick={downloadTemplateSample} style={{marginBottom: '12px'}}><Download size={16}/>Download current KPI Template Excel format</button>
          <div className="form-grid">
            <label>Template name <span className="required-mark">*</span><input className={importErrors.name?'field-invalid':''} aria-invalid={Boolean(importErrors.name)} value={importForm.name} onChange={e => {setImportForm({...importForm, name: e.target.value});setImportErrors(x=>({...x,name:''}))}}/>{importErrors.name?<span className="field-error">{importErrors.name}</span>:null}</label>
            <label>Designation
              <select value={importForm.designation_id} onChange={e => setImportForm({...importForm, designation_id: e.target.value})}>
                <option value="">Any designation</option>
                {designations.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
            <label>Excel / CSV file <span className="required-mark">*</span><input className={importErrors.file?'field-invalid':''} aria-invalid={Boolean(importErrors.file)} type="file" accept=".xlsx,.xls,.csv" onChange={e => {setImportForm({...importForm, file: e.target.files?.[0] || null});setImportErrors(x=>({...x,file:''}))}}/>{importErrors.file?<span className="field-error">{importErrors.file}</span>:null}</label>
          </div>
          <div className="footer-actions">
            <button className="secondary" onClick={() => setShowImport(false)}>Cancel</button>
            <button className="primary" onClick={importFile}>Import template</button>
          </div>
        </Card>
      ) : null}

      {!rows ? <Loader/> : viewMode === 'hierarchy' ? (
        <div className="hierarchy-templates-wrap" style={{display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px'}}>
          {!departmentGroups.length ? (
            <Card><div className="empty">No KPI templates found for this department.</div></Card>
          ) : (
            departmentGroups.map(([depName, templates]) => (
              <Card key={depName} style={{borderRadius: '12px', padding: '18px 20px'}}>
                <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', marginBottom: '14px'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                    <div style={{width: '34px', height: '34px', borderRadius: '8px', background: '#eff6ff', color: '#2563eb', display: 'grid', placeItems: 'center'}}>
                      <FolderTree size={18}/>
                    </div>
                    <div>
                      <h2 style={{margin: 0, fontSize: '1.12rem'}}>{depName}</h2>
                      <div className="cell-help">{templates.length} template{templates.length === 1 ? '' : 's'}</div>
                    </div>
                    <span style={{fontSize: '0.72rem', background: '#eff6ff', padding: '3px 9px', borderRadius: '12px', color: '#1d4ed8', fontWeight: 700}}>Department</span>
                  </div>
                  {isAdmin ? <Link className="primary small" to={`/templates/new?department=${departmentIdByName(depName)}`}><Plus size={13}/>Add template for {depName}</Link> : null}
                </div>
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: '14px'}}>
                  {templates.map(t => (
                    <div key={t.id} style={{background: '#fff', borderRadius: '10px', padding: '14px 16px', border: '1px solid #e2e8f0'}}>
                      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px'}}>
                        <h4 style={{margin: 0, fontSize: '0.95rem'}}>{t.name}</h4>
                        <Status value={t.status}/>
                      </div>
                      <div style={{fontSize: '0.78rem', color: '#64748b', marginTop: '6px'}}>Scope: <b>{[t.department, t.designation].filter(Boolean).join(' / ') || depName}</b></div>
                      <div style={{display: 'flex', gap: '12px', fontSize: '0.78rem', color: '#475569', marginTop: '10px', background: '#f8fafc', padding: '6px 10px', borderRadius: '6px'}}>
                        <span><b>{t.kras.length}</b> sections</span>
                        <span className={Math.abs(Number(t.total_weight) - 100) < 0.001 ? 'good-text' : 'bad-text'}><b>{t.total_weight}</b>/100 marks</span>
                      </div>
                      <div className="row-actions" style={{marginTop: '14px', paddingTop: '10px', borderTop: '1px dashed #e2e8f0'}}>
                        <button className="secondary small" onClick={() => setPreviewTemplate(t)}><Eye size={13}/>View</button>
                        {isAdmin ? (
                          <>
                            <button className="secondary small" onClick={() => editTarget(t)}><Pencil size={13}/>Edit</button>
                            {t.status === 'draft' ? (
                              <button className="primary small" disabled={!t.validation?.publishable} onClick={() => publish(t.id)}><Check size={13}/>Publish</button>
                            ) : null}
                            {t.status === 'active' ? (
                              <button className="secondary small" onClick={() => unpublish(t.id)}><Undo2 size={13}/>Unpublish</button>
                            ) : null}
                            <button className="icon-button danger" onClick={() => removeTemplate(t.id)}><Trash2 size={13}/></button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))
          )}
        </div>
      ) : (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Template</th>
                  <th>Designation</th>
                  <th>Sections</th>
                  <th>Total marks</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...visibleRows].sort((a, b) => (a.department || '').localeCompare(b.department || '') || (a.name || '').localeCompare(b.name || '')).map(t => (
                  <tr key={t.id}>
                    <td><strong>{t.department || 'General Department'}</strong></td>
                    <td>{t.name}</td>
                    <td>{t.designation || '—'}</td>
                    <td>{t.kras.length}</td>
                    <td>{t.total_weight}/100</td>
                    <td><Status value={t.status}/></td>
                    <td>
                      <div className="row-actions">
                        <button className="secondary small" onClick={() => setPreviewTemplate(t)}><Eye size={14}/>View</button>
                        {isAdmin ? <button className="secondary small" onClick={() => editTarget(t)}><Pencil size={14}/>Edit</button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {previewTemplate ? (
        <Modal title={`Template Structure: ${previewTemplate.name}`} onClose={() => setPreviewTemplate(null)} className="wide-modal" actions={
          <>
            <button className="secondary" onClick={() => setPreviewTemplate(null)}>Close</button>
            {isAdmin ? <button className="primary" onClick={() => { const t = previewTemplate; setPreviewTemplate(null); editTarget(t); }}>Edit Template</button> : null}
          </>
        }>
          <div className="helper-strip">
            <strong>Department:</strong> {previewTemplate.department || 'General Department'} | <strong>Status:</strong> <Status value={previewTemplate.status}/> | <strong>Total Marks:</strong> {previewTemplate.total_weight}/100
          </div>
          {previewTemplate.kras.map((kra, kidx) => (
            <div key={kidx} style={{border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px', background: '#f8fafc', marginTop: '12px'}}>
              <div style={{display: 'flex', justifyContent: 'space-between'}}>
                <h4 style={{margin: 0}}>{kra.name}</h4>
                <span className="weight-chip">{kra.weight} marks</span>
              </div>
              <div className="table-wrap" style={{marginTop: '8px'}}>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>KPI Parameter / Task</th>
                      <th>Input Type</th>
                      <th>Target</th>
                      <th>Weight</th>
                      <th>Measurement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kra.items.map((item, iidx) => (
                      <tr key={iidx}>
                        <td>{iidx + 1}</td>
                        <td><strong>{item.question}</strong></td>
                        <td>{item.input_type}</td>
                        <td>{item.target_value ?? '—'}</td>
                        <td>{item.weight}</td>
                        <td>{item.config?.meta?.measurement || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </Modal>
      ) : null}
    </>
  )
}
