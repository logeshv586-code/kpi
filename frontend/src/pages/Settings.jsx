import {useEffect, useState} from 'react'
import {CircleAlert, MailCheck, RefreshCcw, Send, TriangleAlert} from 'lucide-react'
import {api, getError} from '../lib/api'
import {useAuth} from '../lib/auth'
import {Card, ErrorBox, Modal, PageHeader} from '../components/UI'

const emptyEmailForm={
  host:'',
  port:587,
  username:'',
  password:'',
  from_email:'',
  from_name:'KPI Performance Management',
  security:'starttls',
  timeout_seconds:15,
  test_email:''
}

export default function Settings(){
  const {user} = useAuth()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [emailForm,setEmailForm]=useState(emptyEmailForm)
  const [emailHealth,setEmailHealth]=useState(null)
  const [emailSource,setEmailSource]=useState('environment')
  const [passwordConfigured,setPasswordConfigured]=useState(false)
  const [emailBusy,setEmailBusy]=useState(false)
  const [emailLoaded,setEmailLoaded]=useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetMode, setResetMode] = useState('full')
  const [resetText, setResetText] = useState('')
  const [resetChecked, setResetChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resetErrors, setResetErrors] = useState({})

  async function loadEmailSettings(){
    try{
      const [{data},{data:liveHealth}]=await Promise.all([
        api.get('/admin/email-settings'),
        api.get('/admin/email-health?live=true')
      ])
      const cfg=data.config||{}
      setEmailSource(cfg.source||'environment')
      setPasswordConfigured(Boolean(cfg.password_configured))
      setEmailHealth(liveHealth||data.health||null)
      setEmailForm({
        host:cfg.host||'',
        port:cfg.port||587,
        username:cfg.username||'',
        password:'',
        from_email:cfg.from_email||'',
        from_name:cfg.from_name||'KPI Performance Management',
        security:cfg.use_ssl?'ssl':cfg.use_tls?'starttls':'none',
        timeout_seconds:cfg.timeout_seconds||15,
        test_email:data.default_test_email||user?.email||''
      })
    }catch(e){
      const detail=e?.response?.data?.detail
      setEmailHealth({ok:false,message:typeof detail==='string'?detail:'Email connection could not be verified. Update the email password and test again.'})
    }finally{
      setEmailLoaded(true)
    }
  }

  useEffect(()=>{loadEmailSettings()},[])

  function updateEmailField(key,value){
    setEmailForm(current=>({...current,[key]:value}))
    setError('')
    setMessage('')
  }

  async function testCurrentEmail(){
    setEmailBusy(true);setError('');setMessage('')
    try{
      const {data}=await api.post('/admin/email-settings/test',{test_email:emailForm.test_email||user?.email})
      setEmailHealth(data)
      setMessage('Connected. SMTP login is working and the test email was sent successfully. KPI email alerts can be sent normally.')
    }catch(e){
      const detail=e?.response?.data?.detail
      const failed={ok:false,message:typeof detail==='string'?detail:getError(e)}
      setEmailHealth(failed)
      setError(failed.message)
    }finally{
      setEmailBusy(false)
    }
  }

  async function saveAndTestEmail(){
    setEmailBusy(true);setError('');setMessage('')
    try{
      const payload={
        enabled:true,
        host:emailForm.host,
        port:Number(emailForm.port),
        username:emailForm.username,
        password:emailForm.password||null,
        from_email:emailForm.from_email,
        from_name:emailForm.from_name,
        use_tls:emailForm.security==='starttls',
        use_ssl:emailForm.security==='ssl',
        timeout_seconds:Number(emailForm.timeout_seconds),
        test_email:emailForm.test_email||user?.email
      }
      const {data}=await api.put('/admin/email-settings',payload)
      setPasswordConfigured(Boolean(data.config?.password_configured))
      setEmailSource(data.config?.source||'settings')
      setEmailForm(current=>({...current,password:''}))
      setEmailHealth(data.health)
      setMessage('Connected. The new email password is valid, the test email was sent, and KPI email alerts are active again.')
    }catch(e){
      const detail=e?.response?.data?.detail
      const failed={ok:false,message:typeof detail==='string'?detail:getError(e)}
      setEmailHealth(failed)
      setError(failed.message)
    }finally{
      setEmailBusy(false)
    }
  }

  async function reset(){
    const errors = {}
    if (!resetChecked) errors.confirm = 'Confirm that you understand the reset.'
    if (resetText !== 'RESET') errors.text = 'Type RESET exactly to continue.'
    if (Object.keys(errors).length) { setResetErrors(errors); setError('Complete the required fields highlighted in red.'); return }
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

  const healthOk=emailHealth?.ok===true
  const healthBad=emailHealth?.ok===false

  return (
    <>
      <PageHeader
        title="Settings & Email Alerts"
        subtitle="Email connection status is checked only on this Settings page. Other KPI pages continue to work normally even when the mail password is disconnected."
      />
      <ErrorBox error={error}/>
      {message ? <div className="success-box">{message}</div> : null}

      <Card style={{marginTop:0}}>
        <div className="section-heading">
          <div>
            <h3>Email Alert Configuration</h3>
            <p className="muted small-copy">If someone changes the mailbox/app password outside this KPI system, this page will detect the SMTP login failure. Enter the new password here, test it, and mail alerts will resume after the connection succeeds.</p>
          </div>
          <div className={healthOk?'status-badge success':healthBad?'status-badge danger':'status-badge'}>
            {healthOk?'Connected · Mail alerts active':healthBad?'Disconnected · Mail alerts not sending':'Checking connection'}
          </div>
        </div>

        {healthBad?<div className="locked-note" style={{marginBottom:'14px'}}><CircleAlert size={16}/><span><strong>Email disconnected.</strong> {emailHealth.message||'The saved email password is no longer valid.'} KPI email alerts are not being sent until the password is corrected and the connection test passes.</span></div>:null}
        {healthOk?<div className="helper-strip" style={{marginBottom:'14px'}}><strong>Email connected.</strong> SMTP authentication is working. KPI email alerts can be sent normally.{emailHealth.checked_at?' Last checked '+new Date(emailHealth.checked_at).toLocaleString()+'.':''}</div>:null}

        {!emailLoaded?<div className="helper-strip">Loading email gateway settings...</div>:<>
          <div className="form-grid">
            <label>SMTP Host <span className="required-mark">*</span><input value={emailForm.host} onChange={e=>updateEmailField('host',e.target.value)} placeholder="smtp.office365.com"/></label>
            <label>SMTP Port <span className="required-mark">*</span><input type="number" min="1" max="65535" value={emailForm.port} onChange={e=>updateEmailField('port',e.target.value)}/></label>
            <label>SMTP Username / Email<input value={emailForm.username} onChange={e=>updateEmailField('username',e.target.value)} placeholder="kpi-alerts@company.com"/></label>
            <label>SMTP / App Password<input type="password" value={emailForm.password} onChange={e=>updateEmailField('password',e.target.value)} autoComplete="new-password" placeholder={passwordConfigured?'Configured — enter only when password changes':'Enter SMTP/app password'}/><span className="cell-help">{passwordConfigured?'Leave blank to keep the currently validated password.':'A password is required when the SMTP account uses authentication.'}</span></label>
            <label>Sender Email <span className="required-mark">*</span><input type="email" value={emailForm.from_email} onChange={e=>updateEmailField('from_email',e.target.value)} placeholder="kpi-alerts@company.com"/></label>
            <label>Sender Name<input value={emailForm.from_name} onChange={e=>updateEmailField('from_name',e.target.value)} placeholder="KPI Performance Management"/></label>
            <label>Connection Security<select value={emailForm.security} onChange={e=>updateEmailField('security',e.target.value)}><option value="starttls">STARTTLS (usually port 587)</option><option value="ssl">SSL/TLS (usually port 465)</option><option value="none">No TLS (internal SMTP only)</option></select></label>
            <label>Connection Timeout (seconds)<input type="number" min="3" max="60" value={emailForm.timeout_seconds} onChange={e=>updateEmailField('timeout_seconds',e.target.value)}/></label>
            <label className="span-2">Test Email Recipient<input type="email" value={emailForm.test_email} onChange={e=>updateEmailField('test_email',e.target.value)} placeholder={user?.email||'admin@company.com'}/><span className="cell-help">A real test email is sent here before a new password/configuration is activated.</span></label>
          </div>
          <div className="helper-strip" style={{marginTop:'12px'}}><strong>Current source:</strong> {emailSource==='settings'?'Validated Settings override':'backend/.env / deployment environment'}. If the provider rotates the password every month, enter the new password and use <b>Save, Test & Activate</b>.</div>
          <div className="responsive-actions" style={{marginTop:'14px'}}>
            <button className="secondary" disabled={emailBusy} onClick={testCurrentEmail}><MailCheck size={16}/>{emailBusy?'Testing...':'Test Connection & Send Email'}</button>
            <button className="primary" disabled={emailBusy||!emailForm.host||!emailForm.from_email} onClick={saveAndTestEmail}><Send size={16}/>{emailBusy?'Validating...':'Update Password, Test & Connect'}</button>
          </div>
        </>}
      </Card>

      {user?.role==='superadmin'?<Card className="danger-zone">
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
      </Card>:null}

      {resetOpen && user?.role==='superadmin' ? (
        <Modal title="Reset System Data" onClose={() => setResetOpen(false)} actions={
          <>
            <button className="secondary" onClick={() => setResetOpen(false)}>Cancel</button>
            <button className="danger-button" disabled={busy} onClick={reset}>
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
            <label className={'confirm-check '+(resetErrors.confirm?'invalid-field':'')}>
              <input aria-invalid={Boolean(resetErrors.confirm)} type="checkbox" checked={resetChecked} onChange={e => {setResetChecked(e.target.checked);setResetErrors(x=>({...x,confirm:''}))}}/> I understand that selected system data and history will be permanently deleted. <span className="required-mark">*</span>
            </label>
            {resetErrors.confirm?<span className="field-error">{resetErrors.confirm}</span>:null}
            <label>
              Type <b>RESET</b> to continue <span className="required-mark">*</span>
              <input className={resetErrors.text?'field-invalid':''} aria-invalid={Boolean(resetErrors.text)} value={resetText} onChange={e => {setResetText(e.target.value);setResetErrors(x=>({...x,text:''}))}} placeholder="RESET"/>
            </label>
            {resetErrors.text?<span className="field-error">{resetErrors.text}</span>:null}
          </div>
        </Modal>
      ) : null}
    </>
  )
}
