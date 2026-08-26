export function PageHeader({title,subtitle,actions}){return <div className="page-header"><div><h1>{title}</h1>{subtitle?<p>{subtitle}</p>:null}</div>{actions?<div className="actions">{actions}</div>:null}</div>}
export function Card({children,className=''}){return <div className={`card ${className}`}>{children}</div>}
export function Status({value}){const v=(value||'').replaceAll('_',' ');return <span className={`status status-${value}`}>{v}</span>}
export function Empty({text='No data available'}){return <div className="empty">{text}</div>}
export function Loader(){return <div className="loader">Loading...</div>}
export function Score({value}){const n=Number(value||0);return <span className={`score ${n>=90?'excellent':n>=80?'good':n>=70?'ok':'low'}`}>{n.toFixed(1)}</span>}
export function ErrorBox({error}){return error?<div className="error-box">{error}</div>:null}
export function Tooltip({text}){return <span className="tooltip" tabIndex="0">?<span>{text}</span></span>}
export function Modal({title,children,onClose,actions,className=''}){return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose?.()}}><div className={`modal ${className}`} role="dialog" aria-modal="true"><div className="modal-head"><h3>{title}</h3><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div><div className="modal-body">{children}</div>{actions?<div className="modal-actions">{actions}</div>:null}</div></div>}
