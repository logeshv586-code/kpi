import {NavLink, useNavigate} from 'react-router-dom'
import {BarChart3, FileInput, FileSpreadsheet, HelpCircle, KeyRound, LogOut, Settings as SettingsIcon, Users, Menu, X} from 'lucide-react'
import {canAccessTab, useAuth} from '../lib/auth'
import {useState} from 'react'
import {api, getError} from '../lib/api'
import {ErrorBox, Modal} from './UI'

const coreNavigation = [
  ['/reports', BarChart3, 'Reports'],
  ['/employees', Users, 'Employees Directory'],
  ['/templates', FileSpreadsheet, 'KPI Templates'],
  ['/kpi-input', FileInput, 'KPI Input'],
  ['/settings', SettingsIcon, 'Settings & Reset Data']
]
export default function Layout({children}) {
  const {user, logout} = useAuth()
  const nav = useNavigate()
  const navigation = coreNavigation.filter(([to]) => canAccessTab(user, to.slice(1)))
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [passwords, setPasswords] = useState({current_password: '', new_password: '', confirm_password: ''})
  const [passwordError, setPasswordError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordFieldErrors, setPasswordFieldErrors] = useState({})
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  function help() {
    localStorage.removeItem('kpi_guide_dismissed')
    nav('/kpi-input?guide=1')
  }

  async function changePassword() {
    try {
      setPasswordError('')
      const fieldErrors = {}
      if (!passwords.current_password) fieldErrors.current_password = 'Current password is required.'
      if (!passwords.new_password) fieldErrors.new_password = 'New password is required.'
      if (!passwords.confirm_password) fieldErrors.confirm_password = 'Please confirm your new password.'
      if (Object.keys(fieldErrors).length) {
        setPasswordFieldErrors(fieldErrors)
        setPasswordError('Complete the required fields highlighted in red.')
        return
      }
      if (passwords.new_password !== passwords.confirm_password) throw new Error('New password and confirmation do not match.')
      await api.post('/auth/change-password', {current_password: passwords.current_password, new_password: passwords.new_password})
      setPasswordMessage('Password changed. Use the new password the next time you sign in.')
      setPasswords({current_password: '', new_password: '', confirm_password: ''})
    } catch (error) {
      setPasswordError(getError(error))
    }
  }

  return (
    <div className="app-shell">
      {mobileMenuOpen && <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>KPI System</strong>
            <span>Performance Management</span>
          </div>
        </div>
        <div className="nav-section">
          <div className="nav-label">Workspace</div>
          {navigation.map(([to, Icon, label]) => (
            <NavLink key={to} to={to} className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setMobileMenuOpen(false)}>
              <Icon size={18}/>
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button className="help-button" onClick={help}>
            <HelpCircle size={16}/>
            <span>Help & guide</span>
          </button>
          <button className="help-button" onClick={() => { setPasswordError(''); setPasswordMessage(''); setPasswordFieldErrors({}); setPasswordOpen(true) }}>
            <KeyRound size={16}/>
            <span>Change password</span>
          </button>
          <div className="user-mini">
            <div className="avatar">{user?.name?.slice(0, 1)}</div>
            <div>
              <strong>{user?.name}</strong>
              <span>{user?.designation || user?.role}</span>
              {user?.department ? <small>{user.department}</small> : null}
            </div>
          </div>
          <button className="link-button" onClick={() => { logout(); nav('/login') }}>
            <LogOut size={16}/> Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="hamburger" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              <Menu size={20}/>
            </button>
            <div className="crumb">Monthly KPI Performance Management</div>
          </div>
          <div className="top-context">
            <span>{user?.department || 'Organization'}</span>
            <div className="avatar small">{user?.name?.slice(0, 1)}</div>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
      {passwordOpen ? <Modal title="Change password" onClose={() => setPasswordOpen(false)} actions={<><button className="secondary" onClick={() => setPasswordOpen(false)}>Cancel</button><button className="primary" onClick={changePassword}>Save password</button></>}>
        <p className="small-copy muted">Enter your temporary/current password, then choose the password you will use for future sign-ins.</p>
        <ErrorBox error={passwordError}/>
        {passwordMessage ? <div className="helper-strip">{passwordMessage}</div> : null}
        <div className="form-grid" style={{gridTemplateColumns: '1fr'}}>
          <label>Current password <span className="required-mark">*</span><input className={passwordFieldErrors.current_password?'field-invalid':''} aria-invalid={Boolean(passwordFieldErrors.current_password)} type="password" value={passwords.current_password} onChange={e => { setPasswords({...passwords, current_password: e.target.value}); setPasswordFieldErrors(x=>({...x,current_password:''})) }} autoComplete="current-password"/>{passwordFieldErrors.current_password?<span className="field-error">{passwordFieldErrors.current_password}</span>:null}</label>
          <label>New password <span className="required-mark">*</span><input className={passwordFieldErrors.new_password?'field-invalid':''} aria-invalid={Boolean(passwordFieldErrors.new_password)} type="password" value={passwords.new_password} onChange={e => { setPasswords({...passwords, new_password: e.target.value}); setPasswordFieldErrors(x=>({...x,new_password:''})) }} autoComplete="new-password"/>{passwordFieldErrors.new_password?<span className="field-error">{passwordFieldErrors.new_password}</span>:null}</label>
          <label>Confirm new password <span className="required-mark">*</span><input className={passwordFieldErrors.confirm_password?'field-invalid':''} aria-invalid={Boolean(passwordFieldErrors.confirm_password)} type="password" value={passwords.confirm_password} onChange={e => { setPasswords({...passwords, confirm_password: e.target.value}); setPasswordFieldErrors(x=>({...x,confirm_password:''})) }} autoComplete="new-password"/>{passwordFieldErrors.confirm_password?<span className="field-error">{passwordFieldErrors.confirm_password}</span>:null}</label>
        </div>
      </Modal> : null}
    </div>
  )
}
