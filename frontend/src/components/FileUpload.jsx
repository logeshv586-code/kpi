import {useRef,useState} from 'react'
import {FileSpreadsheet,UploadCloud,X} from 'lucide-react'
import {api,getError,apiFileUrl,apiPostForm} from '../lib/api'

export default function FileUpload({label='Upload file',help='PDF, Excel or CSV up to 10 MB',onUploaded,value,disabled=false,compact=false,accept='.pdf,.xlsx,.xls,.csv'}){
  const inputRef=useRef(null)
  const [drag,setDrag]=useState(false),[progress,setProgress]=useState(0),[uploading,setUploading]=useState(false),[error,setError]=useState('')
  async function upload(file){
    if(!file||disabled)return
    setError('');setUploading(true);setProgress(1)
    const fd=new FormData();fd.append('file',file)
    try{
      const {data}=await apiPostForm('/files/upload',fd,{onUploadProgress:e=>{if(e.total)setProgress(Math.round(e.loaded/e.total*100))}})
      setProgress(100);onUploaded?.(data)
    }catch(e){setError(getError(e));setProgress(0)}finally{setUploading(false)}
  }
  const existing=value?.filename?value:null
  return <div className={`file-upload-wrap ${compact?'compact':''}`}>
    {label?<div className="file-upload-label">{label}</div>:null}
    {existing?<div className="file-chip"><FileSpreadsheet size={15}/><a href={apiFileUrl(existing)} target="_blank" rel="noreferrer">{existing.filename}</a><span>{existing.size?`${(existing.size/1024).toFixed(0)} KB`:''}</span>{!disabled?<button type="button" onClick={()=>onUploaded?.(null)} title="Remove"><X size={13}/></button>:null}</div>:<div className={`drop-zone ${drag?'drag':''} ${disabled?'disabled':''}`} onClick={()=>!disabled&&inputRef.current?.click()} onDragOver={e=>{e.preventDefault();if(!disabled)setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);upload(e.dataTransfer.files?.[0])}}><UploadCloud size={compact?18:26}/><div><strong>{compact?'Attach file':'Drop your PDF or Excel file here, or click to browse'}</strong>{!compact?<span>{help}</span>:null}</div><input ref={inputRef} hidden type="file" accept={accept} disabled={disabled} onChange={e=>upload(e.target.files?.[0])}/></div>}
    {uploading||progress>0&&progress<100?<div className="upload-progress"><i style={{width:`${progress}%`}}/><span>{progress}%</span></div>:null}
    {error?<div className="field-error">{error}</div>:null}
  </div>
}
