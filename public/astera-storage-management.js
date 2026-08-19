(() => {
  'use strict';
  const ROUTE = window.location.pathname.replace(/\/+$/, '') || '/';
  if (ROUTE !== '/app/settings/astera-storage') return;

  let mounted = false;
  let busy = false;
  const text = (v) => typeof v === 'string' ? v.trim() : '';
  const create = (tag, cls = '', value) => { const el=document.createElement(tag); if(cls)el.className=cls; if(value!==undefined)el.textContent=value; return el; };
  const button = (label, cls='') => { const el=create('button',cls,label); el.type='button'; return el; };
  const fmtBytes = (value) => { const n=Number(value||0); if(!Number.isFinite(n)||n<0)return '—'; if(n<1024)return `${n} B`; const units=['KB','MB','GB','TB']; let x=n/1024,i=0; while(x>=1024&&i<units.length-1){x/=1024;i+=1;} return `${x.toFixed(x>=10?1:2)} ${units[i]}`; };
  const fmtDate = (value) => { const raw=text(value); if(!raw)return '—'; const d=new Date(raw); return Number.isNaN(d.getTime())?raw:d.toLocaleString(); };

  async function request(url, init={}) {
    const response=await fetch(url,{credentials:'include',headers:{Accept:'application/json',...(init.body?{'Content-Type':'application/json'}:{}),...(init.headers||{})},...init});
    const payload=await response.json().catch(()=>null);
    if(!response.ok){const source=payload&&typeof payload==='object'?(payload.error&&typeof payload.error==='object'?payload.error:payload):null;throw new Error(`${text(source?.message)||`HTTP ${response.status}`}${text(source?.code)?` [${text(source.code)}]`:''}`);}
    return payload;
  }
  const objectsFrom=(payload)=>Array.isArray(payload?.objects)?payload.objects:Array.isArray(payload?.items)?payload.items:[];
  const storageFromCatalog=(payload)=>{const root=payload&&typeof payload==='object'?payload:{}; const account=root.account&&typeof root.account==='object'?root.account:root.data&&typeof root.data==='object'?root.data:root; return account.storage&&typeof account.storage==='object'?account.storage:{};};
  const idOf=(obj)=>text(obj?.object_id||obj?.id);

  function fact(label,value){const row=create('div');row.append(create('dt','',label),create('dd','',value));return row;}

  async function downloadObject(obj,status){
    if(busy)return; busy=true; status.textContent=`${text(obj.file_name)||'File'}をDownloadしています…`;
    try{
      const response=await fetch(`/api/storage/objects/${encodeURIComponent(idOf(obj))}/download`,{credentials:'include',headers:{Accept:'application/octet-stream'}});
      if(!response.ok){const payload=await response.json().catch(()=>null);const source=payload?.error&&typeof payload.error==='object'?payload.error:payload;throw new Error(text(source?.message)||`HTTP ${response.status}`);}
      const blob=await response.blob(); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=text(obj.file_name)||'Astera-storage-file'; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); status.textContent='Downloadを開始しました。';
    }catch(error){status.textContent=`Downloadできませんでした。${error instanceof Error?` ${error.message}`:''}`;}finally{busy=false;}
  }

  function objectCard(obj,status,reload){
    const card=create('article','canon-astera-object');
    const head=create('div','canon-astera-object-head'); const copy=create('div'); copy.append(create('strong','',text(obj.file_name)||'名称不明'),create('small','',`${fmtBytes(obj.file_size)} · ${text(obj.mime_type)||'unknown'}`)); head.append(copy,create('span',`canon-astera-object-state is-${text(obj.status).toLowerCase()}`,text(obj.status)||'unknown'));
    const facts=create('dl','canon-astera-object-facts'); facts.append(fact('暗号化',text(obj.encryption_profile)||'—'),fact('Checksum検証',fmtDate(obj.checksum_verified_at)),fact('Project',text(obj.project_id)||'なし'),fact('作成',fmtDate(obj.created_at)),fact('削除',fmtDate(obj.deleted_at)));
    const actions=create('div','canon-astera-object-actions');
    if(obj.status==='stored'){
      const dl=button('Download'); dl.addEventListener('click',()=>void downloadObject(obj,status));
      const del=button('Delete','is-danger'); del.addEventListener('click',async()=>{if(busy||!window.confirm(`「${text(obj.file_name)||'File'}」を削除します。`))return;busy=true;status.textContent='削除中…';try{await request(`/api/storage/objects/${encodeURIComponent(idOf(obj))}`,{method:'DELETE'});status.textContent='Soft Deleteしました。復元可能状態を確認してください。';await reload();}catch(error){status.textContent=`削除できませんでした。${error instanceof Error?` ${error.message}`:''}`;}finally{busy=false;}}); actions.append(dl,del);
    }else if(obj.status==='soft_deleted'){
      const restore=button('元に戻す'); restore.addEventListener('click',async()=>{if(busy)return;busy=true;status.textContent='復元中…';try{await request(`/api/storage/objects/${encodeURIComponent(idOf(obj))}/undo-delete`,{method:'POST'});status.textContent='Fileを復元しました。';await reload();}catch(error){status.textContent=`復元できませんでした。${error instanceof Error?` ${error.message}`:''}`;}finally{busy=false;}}); actions.append(restore);
    }else if(obj.status==='corrupt'){
      const del=button('破損Fileを削除','is-danger'); del.addEventListener('click',async()=>{if(busy||!window.confirm('破損状態のFileを削除します。'))return;busy=true;try{await request(`/api/storage/objects/${encodeURIComponent(idOf(obj))}`,{method:'DELETE'});status.textContent='破損FileをSoft Deleteしました。';await reload();}catch(error){status.textContent=`削除できませんでした。${error instanceof Error?` ${error.message}`:''}`;}finally{busy=false;}}); actions.append(del);
    }
    card.append(head,facts,actions); return card;
  }

  async function mount(){
    if(mounted)return; const content=document.querySelector('.platform-page-content'); if(!(content instanceof HTMLElement))return; mounted=true; document.documentElement.dataset.canonAsteraStorageManagement='true';
    Array.from(content.querySelectorAll(':scope > .platform-panel')).forEach((panel)=>{if((panel.textContent||'').includes('Storage Entitlement')||(panel.textContent||'').includes('運用原則'))panel.hidden=true;});
    const section=create('section','canon-astera-storage-manager'); section.dataset.canonAsteraStorageManager='true';
    const head=create('header'); const copy=create('div'); copy.append(create('h2','','Astera Storage'),create('p','','容量・状態と保存済みFileを管理します。Private Modeの本文・Resultはここへ保存しません。')); const refresh=button('再読込'); head.append(copy,refresh);
    const status=create('p','canon-astera-storage-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const usageHost=create('div','canon-astera-storage-usage'); const contractHost=create('div','canon-astera-storage-contract'); const objectHost=create('div','canon-astera-storage-objects');
    const capacity=button('容量変更（契約API未接続）');capacity.disabled=true;capacity.setAttribute('aria-disabled','true');capacity.title='容量変更用の契約APIは現Repositoryで確認できません。';
    section.append(head,usageHost,contractHost,capacity,status,objectHost); content.prepend(section);

    const reload=async()=>{
      status.textContent='Storage状態を読み込んでいます…'; objectHost.replaceChildren(create('p','canon-astera-storage-empty','File一覧を読み込んでいます…'));
      try{
        const [usagePayload,objectsPayload,catalogPayload]=await Promise.all([request('/api/storage/usage'),request('/api/storage/objects?include_deleted=1'),request('/api/account/catalog').catch(()=>({}))]);
        usageHost.replaceChildren(); const usage=usagePayload&&typeof usagePayload==='object'?usagePayload:{}; const dl=create('dl','canon-astera-storage-facts'); dl.append(fact('契約容量',fmtBytes(usage.capacity_bytes)),fact('使用量',fmtBytes(usage.used_bytes)),fact('予約量',fmtBytes(usage.reserved_bytes)),fact('削除待ち',fmtBytes(usage.pending_deletion_bytes)),fact('残量',fmtBytes(usage.remaining_bytes)),fact('状態',text(usage.state)||'Unavailable'),fact('保存',usage.write_allowed===true?'書込可能':'Read Only')); usageHost.append(dl);
        const contract=storageFromCatalog(catalogPayload); contractHost.replaceChildren(); const contractDl=create('dl','canon-astera-storage-facts compact'); contractDl.append(fact('次回Credit減算',text(String(contract.next_credit_deduction??contract.next_credit_charge??''))||'Catalog未提供'),fact('Grace',text(String(contract.grace??contract.grace_until??''))||'Catalog未提供'),fact('削除予定',text(String(contract.deletion_scheduled_at??contract.deletion_at??''))||'なし')); contractHost.append(contractDl);
        objectHost.replaceChildren(); const items=objectsFrom(objectsPayload); if(!items.length)objectHost.append(create('p','canon-astera-storage-empty','保存済みFileはありません。')); else items.forEach((obj)=>objectHost.append(objectCard(obj,status,reload)));
        status.textContent='Storage状態を更新しました。';
      }catch(error){usageHost.replaceChildren();contractHost.replaceChildren();objectHost.replaceChildren(create('p','canon-astera-storage-empty is-error',`Storageを読み込めませんでした。${error instanceof Error?` ${error.message}`:''}`));status.textContent='';}
    };
    refresh.addEventListener('click',()=>void reload()); await reload();
  }
  const schedule=()=>queueMicrotask(()=>void mount()); if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule(); new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
})();
