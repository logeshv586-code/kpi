import {useRef,useState} from 'react'
import {Download,File,FileSpreadsheet,FileText,Image as ImageIcon,Plus,UploadCloud,X} from 'lucide-react'
import {apiFileDownloadUrl,apiFileUrl,apiPostForm,getError} from '../lib/api'

function getFileIcon(filename){
  const name=String(filename||'').toLowerCase()
  if(/\.(png|jpe?g|webp|gif|bmp|svg)$/.test(name))return <ImageIcon size={14}/>
  if(/\.(xlsx|xls|csv)$/.test(name))return <FileSpreadsheet size={14}/>
  if(/\.pdf$/.test(name))return <FileText size={14}/>
  return <File size={14}/>
}

export default function FileUpload({
  label='Upload file',
  help='PDF, Excel, CSV, Images or Docs up to 100 MB',
  onUploaded,
  value,
  disabled=false,
  compact=false,
  multiple=false,
  accept='.pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.doc,.docx,.txt,image/*'
}){
  const inputRef=useRef(null)
  const [drag,setDrag]=useState(false),[progress,setProgress]=useState(0),[uploading,setUploading]=useState(false),[error,setError]=useState('')

  const fileList = multiple
    ? (Array.isArray(value) ? value : (value?.filename || value?.file_id ? [value] : []))
    : null
  const singleExisting = !multiple && (value?.filename || value?.file_id) ? value : null

  async function uploadFiles(filesToUpload){
    if(!filesToUpload||!filesToUpload.length||disabled)return
    setError('');setUploading(true);setProgress(1)
    const list=Array.from(filesToUpload)
    const uploadedList=[]
    try{
      for(let i=0;i<list.length;i++){
        const file=list[i]
        const fd=new FormData()
        fd.append('file',file)
        const {data}=await apiPostForm('/files/upload',fd,{
          onUploadProgress:e=>{
            if(e.total){
              const pct=Math.round(((i+(e.loaded/e.total))/list.length)*100)
              setProgress(pct)
            }
          }
        })
        uploadedList.push(data)
      }
      setProgress(100)
      if(multiple){
        const existingIds=new Set((fileList||[]).map(f=>f.file_id))
        const combined=[...(fileList||[]),...uploadedList.filter(f=>!existingIds.has(f.file_id))]
        onUploaded?.(combined)
      }else{
        onUploaded?.(uploadedList[0]||null)
      }
    }catch(e){
      setError(getError(e))
      setProgress(0)
    }finally{
      setUploading(false)
      if(inputRef.current)inputRef.current.value=''
    }
  }

  function removeMultiple(index){
    if(!fileList)return
    const next=fileList.filter((_,i)=>i!==index)
    onUploaded?.(next)
  }

  return <div className={`file-upload-wrap ${compact?'compact':''}`}>
    {label?<div className="file-upload-label">{label}</div>:null}

    {multiple ? (
      fileList && fileList.length > 0 ? (
        <div className="file-chips-list">
          {fileList.map((file,idx)=>{
            const fname = file.filename || (file.file_id ? `Evidence_${file.file_id.slice(0,8)}.pdf` : 'Attached file')
            return (
              <div key={file.file_id||idx} className="file-chip">
                {getFileIcon(fname)}
                <a href={apiFileUrl(file)} target="_blank" rel="noreferrer" title={fname}>
                  {fname}
                </a>
                <span>{file.size?`${(file.size/1024).toFixed(0)} KB`:''}</span>
                <a
                  href={apiFileDownloadUrl(file)}
                  download={fname}
                  className="chip-action-btn"
                  title={`Download ${fname}`}
                  style={{display:'inline-flex',alignItems:'center',color:'#475569',padding:'2px',textDecoration:'none'}}
                >
                  <Download size={13}/>
                </a>
                {!disabled?(
                  <button type="button" onClick={()=>removeMultiple(idx)} title="Remove file">
                    <X size={13}/>
                  </button>
                ):null}
              </div>
            )
          })}
          {!disabled?(
            <button
              type="button"
              className="add-file-trigger"
              onClick={()=>inputRef.current?.click()}
              title="Add more documents"
            >
              <Plus size={13}/> Add file
            </button>
          ):null}
        </div>
      ) : (
        <div
          className={`drop-zone ${drag?'drag':''} ${disabled?'disabled':''}`}
          onClick={()=>!disabled&&inputRef.current?.click()}
          onDragOver={e=>{e.preventDefault();if(!disabled)setDrag(true)}}
          onDragLeave={()=>setDrag(false)}
          onDrop={e=>{e.preventDefault();setDrag(false);uploadFiles(e.dataTransfer.files)}}
        >
          <UploadCloud size={compact?18:26}/>
          <div>
            <strong>{compact?'Attach evidence (optional)':'Drop evidence files here, or click to browse'}</strong>
            {!compact?<span>{help}</span>:null}
          </div>
        </div>
      )
    ) : (
      singleExisting ? (
        (() => {
          const sfname = singleExisting.filename || (singleExisting.file_id ? `Evidence_${singleExisting.file_id.slice(0,8)}.pdf` : 'Attached file')
          return (
            <div className="file-chip">
              {getFileIcon(sfname)}
              <a href={apiFileUrl(singleExisting)} target="_blank" rel="noreferrer" title={sfname}>
                {sfname}
              </a>
              <span>{singleExisting.size?`${(singleExisting.size/1024).toFixed(0)} KB`:''}</span>
              <a
                href={apiFileDownloadUrl(singleExisting)}
                download={sfname}
                className="chip-action-btn"
                title={`Download ${sfname}`}
                style={{display:'inline-flex',alignItems:'center',color:'#475569',padding:'2px',textDecoration:'none'}}
              >
                <Download size={13}/>
              </a>
              {!disabled?(
                <button type="button" onClick={()=>onUploaded?.(null)} title="Remove">
                  <X size={13}/>
                </button>
              ):null}
            </div>
          )
        })()
      ) : (
        <div
          className={`drop-zone ${drag?'drag':''} ${disabled?'disabled':''}`}
          onClick={()=>!disabled&&inputRef.current?.click()}
          onDragOver={e=>{e.preventDefault();if(!disabled)setDrag(true)}}
          onDragLeave={()=>setDrag(false)}
          onDrop={e=>{e.preventDefault();setDrag(false);uploadFiles(e.dataTransfer.files)}}
        >
          <UploadCloud size={compact?18:26}/>
          <div>
            <strong>{compact?'Attach file':'Drop your file here, or click to browse'}</strong>
            {!compact?<span>{help}</span>:null}
          </div>
        </div>
      )
    )}

    <input
      ref={inputRef}
      hidden
      type="file"
      accept={accept}
      multiple={multiple}
      disabled={disabled}
      onChange={e=>uploadFiles(e.target.files)}
    />

    {uploading||(progress>0&&progress<100)?(
      <div className="upload-progress"><i style={{width:`${progress}%`}}/><span>{progress}%</span></div>
    ):null}
    {error?<div className="field-error">{error}</div>:null}
  </div>
}
