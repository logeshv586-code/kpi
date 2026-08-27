import {useState} from 'react'
import {RefreshCcw, TriangleAlert} from 'lucide-react'
import {api, getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card, ErrorBox, Modal, PageHeader} from '../components/UI'

export default function Settings(){
  const {user} = useAuth()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [resetMode, setResetMode] = useState('full')
  const [resetText, setResetText] = useState('')
  const [resetChecked, setResetChecked] = useState(false)
  const [busy, setBusy] = useState(false)

  async function reset(){
    if (resetText !== 'RESET' || !resetChecked) return
    setBusy(true); setError(''); setMessage('')
    try {
      const {data} = await api.post('/admin/reset-data', {confirm: 'RESET', mode: resetMode})
      setMessage(data.message)
      setResetOpen(false); setResetText(''); setResetChecked(false)
    } catch (e) {
      setError(getError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Settings & System Data Reset"
        subtitle="Administration controls for Superadmin to reset data and test Excel imports or manual entries from scratch."
      />
      <ErrorBox error={error}/>
      {message ? <div className="success-box">{message}</div> : null}

      <Card className="danger-zone" style={{marginTop: 0}}>
        <div className="danger-head">
          <TriangleAlert size={26}/>
          <div>
            <h3>Superadmin System Data Reset</h3>
            <p>
              Perform a Full System Factory Reset to clear all employees, templates, department hierarchy, and KPI records so you can test Excel imports and manual entries from scratch. Alternatively, clear only monthly KPI transactional data.
            </p>
          </div>
        </div>
        <button className="danger-button" onClick={() => setResetOpen(true)}>
          <RefreshCcw size={16}/> Reset System Data
        </button>
      </Card>

      {resetOpen ? (
        <Modal title="Reset System Data" onClose={() => setResetOpen(false)} actions={
          <>
            <button className="secondary" onClick={() => setResetOpen(false)}>Cancel</button>
            <button className="danger-button" disabled={resetText !== 'RESET' || !resetChecked || busy} onClick={reset}>
              {busy ? 'Resetting...' : 'Execute System Reset'}
            </button>
          </>
        }>
          <div className="danger-confirm">
            <p>Select the reset scope below. <strong>This operation cannot be undone.</strong></p>
            <div style={{display:'grid', gap:'10px', background:'#fff7ed', padding:'14px', borderRadius:'8px', border:'1px solid #fed7aa', margin:'10px 0'}}>
              <label style={{display:'flex', gap:'10px', alignItems:'flex-start', fontWeight:700, cursor:'pointer'}}>
                <input type="radio" name="resetMode" value="full" checked={resetMode === 'full'} onChange={e => setResetMode(e.target.value)}/>
                <div>
                  <div style={{fontSize:'0.9rem', color:'#991b1b'}}>FULL System Factory Reset (Clear All Data)</div>
                  <div style={{fontWeight:400, fontSize:'0.78rem', color:'#7f1d1d', marginTop:'3px', lineHeight:'1.4'}}>
                    Deletes all employees, departments, designations, templates, KRAs, assignments, and evidence files. Only your superadmin login is preserved so you can test Excel imports & manual creation from scratch.
                  </div>
                </div>
              </label>
              <label style={{display:'flex', gap:'10px', alignItems:'flex-start', fontWeight:700, cursor:'pointer'}}>
                <input type="radio" name="resetMode" value="transactional" checked={resetMode === 'transactional'} onChange={e => setResetMode(e.target.value)}/>
                <div>
                  <div style={{fontSize:'0.9rem', color:'#991b1b'}}>Reset Monthly KPI Data Only</div>
                  <div style={{fontWeight:400, fontSize:'0.78rem', color:'#7f1d1d', marginTop:'3px', lineHeight:'1.4'}}>
                    Deletes monthly KPI cycles, assignments, responses, reviews, and uploaded evidence files. Preserves employees, templates, and department hierarchy.
                  </div>
                </div>
              </label>
            </div>
            <label className="confirm-check">
              <input type="checkbox" checked={resetChecked} onChange={e => setResetChecked(e.target.checked)}/> I understand that selected system data and history will be permanently deleted.
            </label>
            <label>
              Type <b>RESET</b> to continue
              <input value={resetText} onChange={e => setResetText(e.target.value)} placeholder="RESET"/>
            </label>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
