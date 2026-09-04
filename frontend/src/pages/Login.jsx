import {useState, useEffect} from 'react'
import {Eye, EyeOff, RotateCw, ShieldCheck} from 'lucide-react'
import {useNavigate} from 'react-router-dom'
import {api} from '../lib/api'
import {useAuth} from '../lib/auth'
import {ErrorBox} from '../components/UI'

export default function Login(){
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [captchaId, setCaptchaId] = useState('')
  const [captchaSvg, setCaptchaSvg] = useState('')
  const [captchaCode, setCaptchaCode] = useState('')
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [show, setShow] = useState(false)
  const [forgot, setForgot] = useState(false)
  const {login} = useAuth(), nav = useNavigate()

  const fetchCaptcha = async () => {
    setCaptchaLoading(true)
    try {
      const { data } = await api.get('/auth/captcha')
      setCaptchaId(data.captcha_id)
      setCaptchaSvg(data.svg)
      setCaptchaCode('')
    } catch (err) {
      console.error('Failed to load captcha', err)
    } finally {
      setCaptchaLoading(false)
    }
  }

  useEffect(() => {
    fetchCaptcha()
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!captchaCode.trim()) {
      setError('Please enter the security verification code.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data } = await api.post('/auth/login', {
        email,
        password,
        captcha_id: captchaId,
        captcha_code: captchaCode.trim()
      })
      login(data)
      const target = ['superadmin', 'hr'].includes(data.user?.role) ? '/reports' : '/kpi-input'
      nav(target)
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (typeof detail === 'string') {
        setError(detail)
      } else {
        setError('Check your email and password and try again. If you still cannot sign in, contact HR or the system administrator.')
      }
      fetchCaptcha()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand login-brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>KPI System</strong>
            <span>Performance Management</span>
          </div>
        </div>
        <h1>Welcome back</h1>
        <p>Sign in to complete, review or manage monthly KPIs.</p>
        <ErrorBox error={error} />
        {forgot ? (
          <div className="helper-strip">
            Use the temporary password provided by HR or your administrator, then change it after signing in.
          </div>
        ) : null}
        <form onSubmit={submit} autoComplete="off">
          <label>
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              autoComplete="username"
              placeholder="name@company.com"
            />
          </label>
          <label>
            Password
            <div className="password-field">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={show ? 'text' : 'password'}
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          <div className="captcha-section">
            <div className="captcha-header">
              <span className="captcha-label">
                <ShieldCheck size={14} color="#2563eb" /> Security Verification
              </span>
              <span className="captcha-subtext">Case-insensitive</span>
            </div>
            <div className="captcha-row">
              <div
                className="captcha-display"
                title="Visual verification code"
                dangerouslySetInnerHTML={{ __html: captchaSvg || '<span style="font-size:11px;color:#94a3b8;padding:8px">Loading captcha...</span>' }}
              />
              <button
                type="button"
                className="captcha-refresh-btn"
                onClick={fetchCaptcha}
                disabled={captchaLoading}
                title="Click to refresh captcha code"
                aria-label="Refresh captcha"
              >
                <RotateCw size={16} className={captchaLoading ? 'spin-anim' : ''} />
              </button>
            </div>
            <input
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value)}
              type="text"
              placeholder="Enter the 5 characters above"
              required
              autoComplete="off"
              spellCheck="false"
              maxLength={6}
              className="captcha-input"
            />
          </div>

          <button className="text-link forgot" type="button" onClick={() => setForgot((v) => !v)}>
            Forgot password?
          </button>
          <button className="primary wide" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
      <div className="login-art">
        <div>
          <h2>Measure what matters.</h2>
          <p>Targets, achievement, evidence, approvals and history in one simple workflow.</p>
        </div>
      </div>
    </div>
  )
}
