import {useEffect, useMemo, useState} from 'react'
import {Award, BarChart2, Calendar, Check, ChevronLeft, ChevronRight, Download, TrendingUp, Users} from 'lucide-react'
import {api, getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card, ErrorBox, Loader, Modal, PageHeader, Score} from '../components/UI'

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function getRatingBand(score) {
  if (score >= 90) return 'Outstanding'
  if (score >= 80) return 'Very Good'
  if (score >= 70) return 'Good'
  if (score >= 60) return 'Needs Improvement'
  return 'Improvement Required'
}

function roundOne(value) {
  return Math.round(Number(value || 0) * 10) / 10
}

export default function Reports() {
  const {user} = useAuth()
  const [data, setData] = useState(null)
  const [division, setDivision] = useState('All')
  // Empty selection means the existing overall/all-months view.
  const [selectedMonths, setSelectedMonths] = useState([])
  const [draftMonths, setDraftMonths] = useState([])
  const [error, setError] = useState('')
  const [showMonthModal, setShowMonthModal] = useState(false)
  const [calYear, setCalYear] = useState(2026)

  const isAllMonths = selectedMonths.length === 0
  const selectionLabel = isAllMonths
    ? 'All Months (Overall)'
    : selectedMonths.length === 1
      ? selectedMonths[0]
      : `${selectedMonths.length} months selected`

  const title = ['superadmin','hr'].includes(user?.role)
    ? 'Performance Reports'
    : user?.role === 'manager'
      ? 'Team Performance Reports'
      : 'My Performance Report'

  const subtitle = ['superadmin','hr'].includes(user?.role)
    ? 'Monthly & representative performance summaries with single or multi-month filtering.'
    : user?.role === 'manager'
      ? 'Monthly evaluation scores and progress summaries for your direct reports.'
      : 'Your monthly evaluation scores, rating bands, and performance history.'

  useEffect(() => {
    api.get('/dashboard/monthly-matrix')
      .then(r => setData(r.data))
      .catch(e => setError(getError(e)))
  }, [])

  const divisions = useMemo(() => ['All', ...new Set((data?.rows || []).map(r => r.division).filter(Boolean))], [data])
  const availableMonths = useMemo(() => data?.months || [], [data])

  useEffect(() => {
    if (!availableMonths.length) return
    const years = availableMonths
      .map(label => Number(String(label).match(/(\d{4})/)?.[1]))
      .filter(Number.isFinite)
    if (years.length) setCalYear(Math.max(...years))
  }, [availableMonths])

  function scoreForSelectedMonths(row) {
    if (isAllMonths) return row.overall_average ?? null
    const values = selectedMonths
      .map(month => row.scores?.[month])
      .filter(value => value !== null && value !== undefined && value !== '')
      .map(Number)
      .filter(Number.isFinite)
    if (!values.length) return null
    return roundOne(values.reduce((sum, value) => sum + value, 0) / values.length)
  }

  const rows = useMemo(() => {
    return (data?.rows || [])
      .filter(r => division === 'All' || r.division === division)
      .map(r => {
        const score = isAllMonths ? (r.overall_average ?? null) : (() => {
          const values = selectedMonths
            .map(month => r.scores?.[month])
            .filter(value => value !== null && value !== undefined && value !== '')
            .map(Number)
            .filter(Number.isFinite)
          return values.length ? roundOne(values.reduce((sum, value) => sum + value, 0) / values.length) : null
        })()
        return {
          ...r,
          display_score: score,
          display_band: score != null ? getRatingBand(score) : 'Not Evaluated'
        }
      })
  }, [data, division, selectedMonths, isAllMonths])

  const metrics = useMemo(() => {
    const validRows = rows.filter(r => r.display_score != null)
    if (!validRows.length) return {avg: 0, highCount: 0, total: 0, topDiv: 'N/A'}

    const avg = roundOne(validRows.reduce((sum, r) => sum + Number(r.display_score), 0) / validRows.length)
    const highCount = validRows.filter(r => Number(r.display_score) >= 90).length
    const divScores = {}
    validRows.forEach(r => {
      if (!r.division) return
      if (!divScores[r.division]) divScores[r.division] = {total: 0, count: 0}
      divScores[r.division].total += Number(r.display_score)
      divScores[r.division].count += 1
    })

    let topDiv = 'N/A'
    let topDivAvg = -1
    Object.entries(divScores).forEach(([name, values]) => {
      const value = values.total / values.count
      if (value > topDivAvg) {
        topDivAvg = value
        topDiv = name
      }
    })

    return {avg, highCount, total: validRows.length, topDiv}
  }, [rows])

  function openMonthPicker() {
    setDraftMonths([...selectedMonths])
    setShowMonthModal(true)
  }

  function toggleDraftMonth(label) {
    setDraftMonths(current => current.includes(label)
      ? current.filter(month => month !== label)
      : [...current, label].sort((a, b) => availableMonths.indexOf(a) - availableMonths.indexOf(b)))
  }

  function applyMonthSelection() {
    setSelectedMonths([...draftMonths])
    setShowMonthModal(false)
  }

  function useAllMonths() {
    setDraftMonths([])
    setSelectedMonths([])
    setShowMonthModal(false)
  }

  function exportCsv() {
    if (!data || !rows.length) return
    const head = ['Employee', 'Email', 'Selected Months', 'Division', 'Department', 'Designation', 'Score', 'Rating Band']
    const selectedLabel = isAllMonths ? 'All Months (Overall)' : selectedMonths.join(' | ')
    const lines = [
      head.join(','),
      ...rows.map(r => [
        r.employee,
        r.email || '',
        selectedLabel,
        r.division || '',
        r.department || '',
        r.designation || '',
        r.display_score ?? 'N/A',
        r.display_band
      ].map(x => `"${String(x).replaceAll('"', '""')}"`).join(','))
    ]
    const blob = new Blob([lines.join('\n')], {type: 'text/csv'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const fileSuffix = isAllMonths ? 'all-months' : selectedMonths.join('-').toLowerCase().replace(/\s+/g, '-')
    a.download = `kpi-report-${fileSuffix}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function bandClass(band) {
    if (band === 'Outstanding') return 'status-finalized'
    if (band === 'Very Good' || band === 'Good') return 'status-manager_reviewed'
    if (band === 'Needs Improvement') return 'status-submitted'
    return 'status-draft'
  }

  return <>
    <PageHeader
      title={title}
      subtitle={subtitle}
      actions={
        <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
          <button type="button" onClick={openMonthPicker} className="secondary" style={{whiteSpace:'nowrap'}}>
            <Calendar size={16} style={{color:'#2563eb'}}/>
            <span>{selectionLabel}</span>
          </button>

          {divisions.length > 2 ? (
            <select value={division} onChange={e => setDivision(e.target.value)} style={{maxWidth:'180px'}}>
              {divisions.map(d => <option key={d}>{d}</option>)}
            </select>
          ) : null}

          <button className="secondary" onClick={exportCsv} style={{whiteSpace:'nowrap'}}>
            <Download size={16}/>Export CSV
          </button>
        </div>
      }
    />
    <ErrorBox error={error}/>

    {!data ? <Loader/> : <>
      {!isAllMonths ? (
        <div className="helper-strip" style={{marginBottom:'14px'}}>
          <strong>Selected report months:</strong>&nbsp; {selectedMonths.join(', ')}
          <button className="text-action" type="button" onClick={() => setSelectedMonths([])} style={{marginLeft:'8px'}}>Clear selection / show all months</button>
        </div>
      ) : null}

      <div className="metric-grid compact" style={{marginBottom:'16px'}}>
        <Card>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',color:'#64748b'}}>
            <BarChart2 size={16}/><span>Average Score ({selectionLabel})</span>
          </div>
          <strong className="small-metric">{metrics.avg}</strong>
        </Card>
        <Card>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',color:'#64748b'}}>
            <Award size={16}/><span>High Performers (≥90)</span>
          </div>
          <strong className="small-metric">{metrics.highCount}</strong>
        </Card>
        <Card>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',color:'#64748b'}}>
            <Users size={16}/><span>Evaluated Records</span>
          </div>
          <strong className="small-metric">{metrics.total}</strong>
        </Card>
        <Card>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px',color:'#64748b'}}>
            <TrendingUp size={16}/><span>Top Division</span>
          </div>
          <strong className="small-metric" style={{fontSize:'1rem',wordBreak:'break-word'}}>{metrics.topDiv}</strong>
        </Card>
      </div>

      <Card>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'14px',flexWrap:'wrap',gap:'8px'}}>
          <div style={{fontSize:'0.9rem',fontWeight:700,color:'#1e293b'}}>
            Performance Matrix for: <span style={{color:'#2563eb'}}>{selectionLabel}</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Division</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Evaluation Month(s)</th>
                <th>Score</th>
                <th>Rating Band</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.user_id}>
                  <td><strong>{r.employee}</strong><div className="cell-help">{r.email}</div></td>
                  <td>{r.division || '—'}</td>
                  <td>{r.department || '—'}</td>
                  <td>{r.designation || '—'}</td>
                  <td>
                    <span style={{fontSize:'0.82rem',fontWeight:600,color:'#475569'}}>
                      {isAllMonths ? 'All Months (Overall)' : selectedMonths.join(', ')}
                    </span>
                  </td>
                  <td>{r.display_score != null ? <Score value={r.display_score}/> : <span className="muted">N/A</span>}</td>
                  <td><span className={`status-badge ${bandClass(r.display_band)}`}>{r.display_band}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length ? <div className="empty">No performance data found for this filter.</div> : null}
      </Card>
    </>}

    {showMonthModal ? (
      <Modal
        title="Select one or multiple report months"
        onClose={() => setShowMonthModal(false)}
        actions={
          <>
            <button className="secondary" onClick={() => setShowMonthModal(false)}>Cancel</button>
            <button className="primary" onClick={applyMonthSelection} disabled={!draftMonths.length}>Apply {draftMonths.length} month{draftMonths.length === 1 ? '' : 's'}</button>
          </>
        }
      >
        <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>
          <div className="helper-strip" style={{margin:0}}>
            Select any combination of months. The report will average only the selected months for each employee.
          </div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'#f8fafc',padding:'10px 14px',borderRadius:'8px',border:'1px solid #e2e8f0',gap:'8px',flexWrap:'wrap'}}>
            <button type="button" className={draftMonths.length === 0 ? 'primary small' : 'secondary small'} onClick={useAllMonths}>
              All Months (Overall)
            </button>
            <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
              <button type="button" className="icon-button" onClick={() => setCalYear(y => y - 1)}><ChevronLeft size={16}/></button>
              <strong style={{fontSize:'1rem',color:'#0f172a'}}>{calYear}</strong>
              <button type="button" className="icon-button" onClick={() => setCalYear(y => y + 1)}><ChevronRight size={16}/></button>
            </div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:'10px'}}>
            {monthNames.map(mName => {
              const label = `${mName} ${calYear}`
              const isAvailable = availableMonths.includes(label)
              const isSelected = draftMonths.includes(label)
              return (
                <button
                  key={label}
                  type="button"
                  disabled={!isAvailable}
                  onClick={() => toggleDraftMonth(label)}
                  style={{
                    padding:'12px 8px',
                    borderRadius:'8px',
                    border:isSelected?'2px solid #2563eb':'1px solid #cbd5e1',
                    background:isSelected?'#eff6ff':isAvailable?'#ffffff':'#f8fafc',
                    color:isSelected?'#1d4ed8':isAvailable?'#0f172a':'#94a3b8',
                    fontWeight:isSelected||isAvailable?700:500,
                    display:'flex',
                    flexDirection:'column',
                    alignItems:'center',
                    gap:'4px',
                    opacity:isAvailable?1:0.55
                  }}
                >
                  <span style={{display:'flex',alignItems:'center',gap:'5px'}}>{isSelected?<Check size={14}/>:null}{mName}</span>
                  <span style={{fontSize:'0.65rem'}}>{isSelected?'Selected':isAvailable?'Report Data':'No Data'}</span>
                </button>
              )
            })}
          </div>

          {draftMonths.length ? (
            <div className="helper-strip" style={{margin:0}}><strong>Will apply:</strong>&nbsp; {draftMonths.join(', ')}</div>
          ) : null}
        </div>
      </Modal>
    ) : null}
  </>
}
