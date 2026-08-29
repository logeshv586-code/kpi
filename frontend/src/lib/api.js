import axios from 'axios'

function getApiBaseURL(){
  const envUrl=import.meta.env.VITE_API_URL?.trim()

  if(envUrl?.startsWith('http')) return envUrl.replace(/\/$/,'')

  if(typeof window!=='undefined'){
    // Dev: Vite proxies /api → 127.0.0.1:8000
    if(import.meta.env.DEV) return '/api'

    // Production on port 80/443/8080: never call :8000 from the browser — use Nginx /api proxy
    const port=window.location.port
    if(envUrl==='/api'||!port||port==='80'||port==='443'||port==='8080') return '/api'

    // UI served on another port (rare): talk to backend on :8000 directly
    const apiPort=import.meta.env.VITE_API_PORT||'8000'
    return `${window.location.protocol}//${window.location.hostname}:${apiPort}/api`
  }

  return '/api'
}

const API_BASE_URL = getApiBaseURL()

export const api = axios.create({baseURL: API_BASE_URL})

api.interceptors.request.use((config) => {
  config.baseURL = getApiBaseURL()
  const token = localStorage.getItem('kpi_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    if (config.headers?.delete) config.headers.delete('Content-Type')
    else delete config.headers['Content-Type']
    config.transformRequest = [(data) => data]
  }
  return config
})

function resolveApiUrl(path){
  const base=String(getApiBaseURL()).replace(/\/$/,'')
  const route=path.startsWith('/')?path:`/${path}`
  return `${base}${route}`
}

function handleUnauthorized(){
  localStorage.removeItem('kpi_token')
  localStorage.removeItem('kpi_user')
  if(location.pathname!='/login') location.href='/login'
}

/** Multipart uploads via XHR so the browser sets the boundary (Axios can break cross-origin uploads). */
export function apiPostForm(path, formData, {onUploadProgress}={}){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest()
    xhr.open('POST', resolveApiUrl(path))
    xhr.timeout=180000
    const token=localStorage.getItem('kpi_token')
    if(token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    if(onUploadProgress){
      xhr.upload.onprogress=(event)=>{
        if(event.lengthComputable) onUploadProgress({loaded:event.loaded,total:event.total})
      }
    }
    xhr.onload=()=>{
      if(xhr.status===0){
        reject(Object.assign(new Error('Network Error'),{response:null,corsBlocked:true}))
        return
      }
      let data={}
      try{data=JSON.parse(xhr.responseText||'{}')}catch{data={detail:xhr.responseText||'Invalid server response'}}
      if(xhr.status===401){handleUnauthorized();reject(Object.assign(new Error('Unauthorized'),{response:{status:401,data}}));return}
      if(xhr.status===404){
        reject(Object.assign(new Error('API route not found — deploy the latest backend and restart uvicorn.'),{response:{status:404,data}}))
        return
      }
      if(xhr.status===413){
        reject(Object.assign(new Error('File too large for Nginx (increase client_max_body_size to 10m).'),{response:{status:413,data}}))
        return
      }
      if(xhr.status===502||xhr.status===503){
        reject(Object.assign(new Error('Nginx cannot reach FastAPI on 127.0.0.1:8000 — start uvicorn on this server.'),{response:{status:xhr.status,data}}))
        return
      }
      if(xhr.status===504){
        reject(Object.assign(new Error('Upload timed out at Nginx — increase proxy_read_timeout.'),{response:{status:504,data}}))
        return
      }
      if(xhr.status>=200&&xhr.status<300){resolve({data});return}
      reject(Object.assign(new Error(typeof data.detail==='string'?data.detail:`Upload failed (HTTP ${xhr.status})`),{response:{status:xhr.status,data}}))
    }
    xhr.onerror=()=>reject(Object.assign(new Error('Network Error'),{response:null,proxyOrBackendDown:true}))
    xhr.ontimeout=()=>reject(Object.assign(new Error('Upload timed out'),{response:null}))
    xhr.send(formData)
  })
}

api.interceptors.response.use(r=>r,err=>{if(err.response?.status===401){handleUnauthorized()}return Promise.reject(err)})

export const getError=(e)=>{
  const detail=e?.response?.data?.detail
  if(Array.isArray(detail)) return detail.map(x=>x.msg||'Invalid value').join(', ')
  if(typeof detail==='string') return detail
  if(e?.message&&!e?.message.includes('Network Error')&&!e?.message.includes('Cannot reach')) return e.message
  if(!e?.response&&String(e?.message||'').toLowerCase().includes('network')) {
    return 'Upload blocked in the browser (often net::ERR_ACCESS_DENIED). Use the same server URL in the address bar (e.g. http://192.168.1.85/), allow local network access in Chrome, try Firefox, or disable extensions/antivirus.'
  }
  return e?.message || 'Something went wrong. Please try again.'
}

export function apiFileUrl(value){
  const url=typeof value==='string'?value:value?.url
  if(!url) return ''
  if(/^https?:\/\//i.test(url)) return url
  const base=String(api.defaults.baseURL||'')
  if(base.startsWith('http')){
    try{return new URL(url,new URL(base).origin).toString()}catch{return url}
  }
  return url
}

export async function downloadApiFile(endpoint, fallbackName='download'){
  const response=await api.get(endpoint,{responseType:'blob'})
  const blobUrl=URL.createObjectURL(response.data)
  const disposition=response.headers['content-disposition']||''
  const match=disposition.match(/filename="?([^";]+)"?/i)
  const a=document.createElement('a')
  a.href=blobUrl;a.download=match?.[1]||fallbackName;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(blobUrl)
}
