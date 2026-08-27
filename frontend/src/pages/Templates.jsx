import {useEffect, useMemo, useState} from 'react'
import {Building2, Check, Eye, FileUp, FolderTree, Pencil, Plus, Table, Trash2, Undo2} from 'lucide-react'
import {Link, useNavigate} from 'react-router-dom'
import {api, getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card, ErrorBox, Loader, Modal, PageHeader, Status} from '../components/UI'

export default function Templates(){
  const { user } = useAuth()
  const isAdmin = ['superadmin', 'hr'].includes(user?.role)

  const [rows,setRows]=useState(null),[masters,setMasters]=useState([]),[error,setError]=useState(''),[message,setMessage]=useState('')
  const [showImport,setShowImport]=useState(false),[divisionFilter,setDivisionFilter]=useState(''),[departmentFilter,setDepartmentFilter]=useState('')
  const [viewMode,setViewMode]=useState('hierarchy') // 'hierarchy' | 'table'
  const [previewTemplate,setPreviewTemplate]=useState(null)
  const [importForm,setImportForm]=useState({name:'Imported KPI Template',designation_id:'',file:null})
  const navigate=useNavigate()

  const designations=useMemo(()=>masters.flatMap(d=>d.departments.flatMap(dep=>dep.designations.map(x=>({...x,label:`${d.name} / ${dep.name} / ${x.name}`})))),[masters])
  const divisionOptions=useMemo(()=>masters.map(d=>d.name).sort(),[masters])
  const departmentOptions=useMemo(()=>[...new Set(masters.filter(d=>!divisionFilter||d.name===divisionFilter).flatMap(d=>d.departments.map(dep=>dep.name)))].sort(),[masters,divisionFilter])

  const load=()=>Promise.all([api.get('/kpi/templates'),api.get('/admin/masters')]).then(([r,m])=>{setRows(r.data);setMasters(m.data)}).catch(e=>setError(getError(e)))
  useEffect(()=>{load()},[])
  useEffect(()=>{document.body.classList.add('templates-page');return()=>document.body.classList.remove('templates-page')},[])

  async function publish(id){try{setError('');setMessage('');await api.post(`/kpi/templates/${id}/publish`);setMessage('Template published and ready for assignment.');load()}catch(e){setError(getError(e))}}
  async function newVersion(id){try{setError('');const {data}=await api.post(`/kpi/templates/${id}/new-version`);navigate(`/templates/new?edit=${data.id}`)}catch(e){setError(getError(e))}}
  async function editTarget(t){if(t.status==='draft'){navigate(`/templates/new?edit=${t.id}`);return}await newVersion(t.id)}
  async function unpublish(id){if(!window.confirm('Move this unused published target back to draft?'))return;try{setError('');await api.post(`/kpi/templates/${id}/unpublish`);setMessage('Target unpublished. You can edit it now.');load()}catch(e){setError(getError(e))}}
  async function removeTemplate(id){if(!window.confirm('Remove this template? This is available only when it has no assignments.'))return;try{setError('');await api.delete(`/kpi/templates/${id}`);setMessage('Template removed.');load()}catch(e){setError(getError(e))}}

  async function importFile(){
    if(!importForm.file){setError('Choose an Excel or CSV file first.');return}
    if(!importForm.name.trim()){setError('Enter a template name.');return}
    try{
      setError('');setMessage('');const ext=importForm.file.name.toLowerCase().split('.').pop();let data
      if(ext==='csv'){const csv_text=await importForm.file.text();({data}=await api.post('/kpi/templates/import-csv',{name:importForm.name,designation_id:importForm.designation_id?Number(importForm.designation_id):null,csv_text}))}
      else{const fd=new FormData();fd.append('file',importForm.file);fd.append('name',importForm.name);if(importForm.designation_id)fd.append('designation_id',importForm.designation_id);({data}=await api.post('/kpi/templates/import-excel',fd,{headers:{'Content-Type':'multipart/form-data'}}))}
      setMessage(`Imported ${data.kras.length} KRA(s) as a draft. Review before publishing.`);setShowImport(false);setImportForm({name:'Imported KPI Template',designation_id:'',file:null});load()
    }catch(e){setError(getError(e))}
  }

  const visibleRows=useMemo(()=>(rows||[]).filter(t=>(!divisionFilter||t.division===divisionFilter)&&(!departmentFilter||t.department===departmentFilter)),[rows,divisionFilter,departmentFilter])

  // Group visible templates by Division -> Department for Hierarchy view
  const hierarchyGroups=useMemo(()=>{
    const groups={}
    visibleRows.forEach(t=>{
      const divName=t.division||'General / Organization-wide'
      const depName=t.department||'General Department'
      if(!groups[divName]) groups[divName]={}
      if(!groups[divName][depName]) groups[divName][depName]=[]
      groups[divName][depName].push(t)
    })
    return groups
  },[visibleRows])

  // Lookup IDs for division and department
  const getHierarchyIds=(divName, depName)=>{
    const divObj = masters.find(d => d.name === divName)
    const depObj = divObj?.departments.find(dep => dep.name === depName)
    return { divId: divObj?.id || '', depId: depObj?.id || '' }
  }

  return <>
    <PageHeader title="KPI Templates & Hierarchy" subtitle="Organize task-based targets by Division and Department. View template structures and parameter details." actions={isAdmin ? (<><button className="secondary" onClick={()=>setShowImport(v=>!v)}><FileUp size={16}/>Import</button><Link className="primary" to="/templates/new"><Plus size={16}/>Create simple template</Link></>) : null}/>
    <ErrorBox error={error}/>{message?<div className="success-box">{message}</div>:null}

    <Card style={{padding:'14px 18px',marginBottom:'16px'}}>
      <div style={{display:'flex',alignItems:'center',justify:'space-between',flexWrap:'wrap',gap:'14px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'16px',flexWrap:'wrap'}}>
          <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'0.85rem',fontWeight:600,color:'#334155',margin:0}}>
            Show division
            <select value={divisionFilter} onChange={e=>{setDivisionFilter(e.target.value);if(e.target.value&&!masters.find(d=>d.name===e.target.value)?.departments.some(dep=>dep.name===departmentFilter))setDepartmentFilter('')}} style={{width:'180px',height:'36px',padding:'6px 10px',fontSize:'0.85rem'}}>
              <option value="">All divisions</option>
              {divisionOptions.map(x=><option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'0.85rem',fontWeight:600,color:'#334155',margin:0}}>
            Show department
            <select value={departmentFilter} onChange={e=>setDepartmentFilter(e.target.value)} style={{width:'180px',height:'36px',padding:'6px 10px',fontSize:'0.85rem'}}>
              <option value="">All departments</option>
              {departmentOptions.map(x=><option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'8px',background:'#f8fafc',padding:'4px 8px',borderRadius:'8px',border:'1px solid #e2e8f0'}}>
          <span style={{fontSize:'0.8rem',fontWeight:600,color:'#64748b'}}>View:</span>
          <button className={viewMode==='hierarchy'?'primary small':'secondary small'} onClick={()=>setViewMode('hierarchy')}>
            <FolderTree size={14}/>Hierarchy View
          </button>
          <button className={viewMode==='table'?'primary small':'secondary small'} onClick={()=>setViewMode('table')}>
            <Table size={14}/>Table View
          </button>
        </div>
      </div>
    </Card>

    {showImport?<Card className="import-card"><h3>Import a KPI template</h3><p className="muted small-copy">Use the simple columns: KRA, KPI/task, Target, Measurement/how to complete.</p><div className="form-grid"><label>Template name<input value={importForm.name} onChange={e=>setImportForm({...importForm,name:e.target.value})}/></label><label>Designation<select value={importForm.designation_id} onChange={e=>setImportForm({...importForm,designation_id:e.target.value})}><option value="">Any designation</option>{designations.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label><label>Excel / CSV file<input type="file" accept=".xlsx,.xls,.csv" onChange={e=>setImportForm({...importForm,file:e.target.files?.[0]||null})}/></label></div><div className="footer-actions"><button className="secondary" onClick={()=>setShowImport(false)}>Cancel</button><button className="primary" onClick={importFile}>Import as draft</button></div></Card>:null}

    {!rows?<Loader/>:viewMode==='hierarchy'?(
      <div className="hierarchy-templates-wrap" style={{display:'flex',flexDirection:'column',gap:'20px',marginTop:'16px'}}>
        {Object.keys(hierarchyGroups).length===0?<Card><div className="empty">No KPI templates found for this hierarchy filter.</div></Card>:
          Object.entries(hierarchyGroups).map(([divName,depMap])=>(
            <Card key={divName} className="division-hierarchy-card" style={{borderRadius:'12px',border:'1px solid #e2e8f0',padding:'18px 20px',boxShadow:'0 1px 3px rgba(15,23,42,0.03)'}}>
              <div style={{display:'flex',alignItems:'center',justify:'space-between',borderBottom:'1px solid var(--color-border,#e2e8f0)',paddingBottom:'12px',marginBottom:'16px'}}>
                <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                  <div style={{width:'32px',height:'32px',borderRadius:'8px',background:'#eff6ff',color:'#2563eb',display:'grid',placeItems:'center'}}>
                    <Building2 size={18}/>
                  </div>
                  <h2 style={{margin:0,fontSize:'1.15rem',fontWeight:700,color:'#0f172a'}}>{divName}</h2>
                  <span style={{fontSize:'0.75rem',background:'#f1f5f9',padding:'3px 9px',borderRadius:'12px',color:'#475569',fontWeight:600}}>Division</span>
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
                {Object.entries(depMap).map(([depName,templates])=>{
                  const {divId, depId} = getHierarchyIds(divName, depName)
                  return (
                    <div key={depName} className="department-hierarchy-block" style={{background:'#f8fafc',borderRadius:'10px',padding:'16px 18px',border:'1px solid #e2e8f0'}}>
                      <div style={{display:'flex',alignItems:'center',justify:'space-between',marginBottom:'14px',flexWrap:'wrap',gap:'8px'}}>
                        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                          <FolderTree size={16} style={{color:'#2563eb'}}/>
                          <strong style={{fontSize:'0.95rem',color:'#1e293b'}}>{depName}</strong>
                          <span style={{fontSize:'0.75rem',color:'#64748b',background:'#ffffff',padding:'2px 8px',borderRadius:'10px',border:'1px solid #e2e8f0'}}>
                            {templates.length} template{templates.length>1?'s':''}
                          </span>
                        </div>
                        <Link className="primary small" to={`/templates/new?division=${divId}&department=${depId}`} style={{fontSize:'0.8rem',padding:'5px 10px',borderRadius:'7px',display:'inline-flex',alignItems:'center',gap:'5px'}}>
                          <Plus size={13}/>Add template for {depName}
                        </Link>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))',gap:'14px'}}>
                        {templates.map(t=>{
                          const scope=[t.division,t.department,t.designation].filter(Boolean).join(' / ')||'Everyone';
                          return (
                            <div key={t.id} className="template-item-card" style={{background:'#ffffff',borderRadius:'10px',padding:'14px 16px',border:'1px solid #e2e8f0',display:'flex',flexDirection:'column',justify:'space-between',boxShadow:'0 1px 3px rgba(15,23,42,0.04)'}}>
                              <div>
                                <div style={{display:'flex',justify:'space-between',alignItems:'flex-start',gap:'8px'}}>
                                  <h4 style={{margin:0,fontSize:'0.95rem',fontWeight:700,color:'#0f172a'}}>{t.name}</h4>
                                  <Status value={t.status}/>
                                </div>
                                <div style={{fontSize:'0.78rem',color:'#64748b',marginTop:'6px',lineHeight:'1.4'}}>Scope: <b>{scope}</b></div>
                                <div style={{display:'flex',gap:'12px',fontSize:'0.78rem',color:'#475569',marginTop:'10px',background:'#f8fafc',padding:'6px 10px',borderRadius:'6px',border:'1px solid #e2e8f0'}}>
                                  <span><b>{t.kras.length}</b> sections</span>
                                  <span className={Math.abs(Number(t.total_weight)-100)<0.001?'good-text':'bad-text'}><b>{t.total_weight}</b>/100 marks</span>
                                </div>
                              </div>
                              <div className="row-actions" style={{marginTop:'14px',paddingTop:'10px',borderTop:'1px dashed #e2e8f0',display:'flex',flexWrap:'wrap',gap:'6px',justify:'flex-start'}}>
                                <button className="secondary small" title="Show / view template details" onClick={()=>setPreviewTemplate(t)}>
                                  <Eye size={13}/>View
                                </button>
                                <button className="secondary small" title="Edit template" onClick={()=>editTarget(t)}>
                                  <Pencil size={13}/>{t.status==='active'?'Edit target':'Edit'}
                                </button>
                                {t.status==='draft'?(
                                  <button className="primary small" disabled={!t.validation?.publishable} title="Publish template" onClick={()=>publish(t.id)}>
                                    <Check size={13}/>Publish
                                  </button>
                                ):null}
                                {t.status==='active'?(
                                  <button className="secondary small" title="Unpublish template" onClick={()=>unpublish(t.id)}>
                                    <Undo2 size={13}/>Unpublish
                                  </button>
                                ):null}
                                <button className="icon-button danger" aria-label="Remove template" onClick={()=>removeTemplate(t.id)} style={{width:'28px',height:'28px'}}>
                                  <Trash2 size={13}/>
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          ))
        }
      </div>
    ):(
      <Card><div className="table-wrap"><table><thead><tr><th>Template</th><th>Hierarchy scope</th><th>Sections</th><th>Total marks</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visibleRows.map(t=>{const scope=[t.division,t.department,t.designation].filter(Boolean).join(' / ')||'Everyone';return <tr key={t.id}><td><strong>{t.name}</strong></td><td>{scope}</td><td>{t.kras.length}</td><td className={Math.abs(Number(t.total_weight)-100)<0.001?'good-text':'bad-text'}>{t.total_weight}/100</td><td><Status value={t.status}/></td><td><div className="row-actions"><button className="secondary small" title="View template structure" onClick={()=>setPreviewTemplate(t)}><Eye size={14}/>View</button><button className="secondary small" onClick={()=>editTarget(t)}><Pencil size={14}/>{t.status==='active'?'Edit target':'Edit'}</button>{t.status==='draft'?<button className="primary small" disabled={!t.validation?.publishable} onClick={()=>publish(t.id)}><Check size={14}/>Publish</button>:null}{t.status==='active'?<button className="secondary small" onClick={()=>unpublish(t.id)}><Undo2 size={14}/>Unpublish</button>:null}<button className="icon-button danger" aria-label="Remove template" onClick={()=>removeTemplate(t.id)}><Trash2 size={14}/></button></div></td></tr>})}</tbody></table></div>{!visibleRows.length?<div className="empty">No templates for this hierarchy yet.</div>:null}</Card>
    )}

    {previewTemplate?(
      <Modal title={`Template Structure: ${previewTemplate.name}`} onClose={()=>setPreviewTemplate(null)} className="wide-modal" actions={<><button className="secondary" onClick={()=>setPreviewTemplate(null)}>Close</button><button className="primary" onClick={()=>{const t=previewTemplate;setPreviewTemplate(null);editTarget(t)}}>Edit Template</button></>}>
        <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
          <div className="helper-strip">
            <strong>Hierarchy Scope:</strong> {[previewTemplate.division, previewTemplate.department, previewTemplate.designation].filter(Boolean).join(' / ') || 'Everyone'} | 
            <strong> Status:</strong> <Status value={previewTemplate.status}/> | 
            <strong> Total Marks:</strong> {previewTemplate.total_weight}/100
          </div>
          {previewTemplate.kras.map((kra,kidx)=>(
            <div key={kidx} style={{border:'1px solid var(--color-border,#e2e8f0)',borderRadius:'6px',padding:'12px',background:'var(--color-bg-subtle,#f8fafc)'}}>
              <div style={{display:'flex',justify:'space-between',alignItems:'center',marginBottom:'8px'}}>
                <h4 style={{margin:0,fontWeight:700}}>{kra.name}</h4>
                <span className="weight-chip">{kra.weight} marks</span>
              </div>
              <div className="table-wrap">
                <table style={{fontSize:'0.85rem'}}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>KPI Parameter / Task</th>
                      <th>Input Type</th>
                      <th>Target Value</th>
                      <th>Weight</th>
                      <th>Measurement / Guidance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kra.items.map((item,iidx)=>(
                      <tr key={iidx}>
                        <td>{iidx+1}</td>
                        <td><strong>{item.question}</strong></td>
                        <td><span style={{textTransform:'capitalize'}}>{item.input_type}</span></td>
                        <td>{item.target_value!=null?item.target_value:'—'}</td>
                        <td>{item.weight} marks</td>
                        <td><small>{item.config?.meta?.measurement || 'Employee enters actual measurement during KPI Input'}</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </Modal>
    ):null}
  </>
}
