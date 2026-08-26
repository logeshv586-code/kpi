import {useState} from 'react'
import {Eye,EyeOff} from 'lucide-react'
import {useNavigate} from 'react-router-dom'
import {api} from '../lib/api'
import {useAuth} from '../lib/auth'
import {ErrorBox} from '../components/UI'

export default function Login(){
  const [email,setEmail]=useState('admin@kpi.local'),[password,setPassword]=useState('Admin@123'),[error,setError]=useState(''),[loading,setLoading]=useState(false),[show,setShow]=useState(false),[forgot,setForgot]=useState(false)
  const {login}=useAuth(),nav=useNavigate()
  async function submit(e){e.preventDefault();setLoading(true);setError('');try{const {data}=await api.post('/auth/login',{email,password});login(data);nav('/dashboard')}catch{setError('Check your email and password and try again. If you still cannot sign in, contact HR or the system administrator.')}finally{setLoading(false)}}
  return <div className="login-page"><div className="login-card"><div className="brand login-brand"><div className="brand-mark">K</div><div><strong>KPI System</strong><span>Performance Management</span></div></div><h1>Welcome back</h1><p>Sign in to complete, review or manage monthly KPIs.</p><ErrorBox error={error}/>{forgot?<div className="helper-strip">Password reset is managed by HR / Super Admin in this deployment. Contact them to receive a new temporary password.</div>:null}<form onSubmit={submit}><label>Email<input value={email} onChange={e=>setEmail(e.target.value)} type="email" required autoComplete="username"/></label><label>Password<div className="password-field"><input value={password} onChange={e=>setPassword(e.target.value)} type={show?'text':'password'} required autoComplete="current-password"/><button type="button" onClick={()=>setShow(v=>!v)} aria-label={show?'Hide password':'Show password'}>{show?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></label><button className="text-link forgot" type="button" onClick={()=>setForgot(v=>!v)}>Forgot password?</button><button className="primary wide" disabled={loading}>{loading?'Signing in...':'Sign in'}</button></form><div className="demo-note"><strong>Demo:</strong> admin@kpi.local / Admin@123</div></div><div className="login-art"><div><h2>Measure what matters.</h2><p>Targets, achievement, evidence, approvals and history in one simple workflow.</p></div></div></div>
}
