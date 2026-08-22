(() => {
  'use strict';

  let mainMenu = null;
  let folderPicker = null;
  let mainOpen = false;
  let pickerOpen = false;
  let mainAnchor = null;
  let menuMode = 'page';
  let currentResultId = '';
  let organizationReady = false;
  let resultReady = false;
  let state = { pinned: false, archived: false, projectId: '' };

  const locale = () => (document.documentElement.lang || navigator.language || 'ja').toLowerCase().startsWith('en') ? 'en' : 'ja';
  const copy = () => locale() === 'en'
    ? { organize:'Organize', pin:'Pin', unpin:'Unpin', archive:'Archive', unarchive:'Unarchive', moveFolder:'Move to folder', removeFolder:'Remove from folder', pageMove:'Move page', pageRemove:'Remove page', folderDelete:'Delete folder', pageDelete:'Delete page', createFolder:'Create folder', folderName:'Folder name', create:'Create', cancel:'Cancel', unavailable:'Organization data is not ready', failed:'Could not update organization', pageDeleteConfirm:'Delete this page?', folderDeleteConfirm:'Delete this folder? Pages inside it will be moved out of the folder.' }
    : { organize:'整理', pin:'ピン留め', unpin:'ピン留めを解除', archive:'アーカイブ', unarchive:'アーカイブ解除', moveFolder:'フォルダーに移動', removeFolder:'フォルダーから削除', pageMove:'ページの移動', pageRemove:'ページを外す', folderDelete:'フォルダーの削除', pageDelete:'ページの削除', createFolder:'フォルダーを作成', folderName:'フォルダー名', create:'作成', cancel:'キャンセル', unavailable:'整理機能のD1反映待ち', failed:'整理状態を更新できませんでした', pageDeleteConfirm:'このページを削除しますか？', folderDeleteConfirm:'このフォルダーを削除しますか？ フォルダー内のページは未所属へ戻ります。' };

  function resultIdFromPath(){ const m=location.pathname.match(/^\/app\/results\/([^/?#]+)$/); return m?decodeURIComponent(m[1]):''; }
  function csrfToken(){ const meta=document.querySelector('meta[name="csrf-token"]'); if(meta instanceof HTMLMetaElement&&meta.content.trim())return meta.content.trim(); const cookie=document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('csrf_token=')); return cookie?decodeURIComponent(cookie.slice('csrf_token='.length)):''; }
  async function requestJson(url,options={}){ const method=options.method||'GET'; const headers={Accept:'application/json',...(options.headers||{})}; if(options.body!==undefined)headers['Content-Type']='application/json'; const csrf=csrfToken(); if(csrf&&method!=='GET')headers['X-CSRF-Token']=csrf; const response=await fetch(url,{method,credentials:'include',cache:'no-store',headers,body:options.body===undefined?undefined:JSON.stringify(options.body)}); const payload=await response.json().catch(()=>null); if(!response.ok){const error=new Error(payload?.error?.message||`HTTP_${response.status}`); error.code=payload?.error?.code||`HTTP_${response.status}`; throw error;} return payload; }
  async function loadProjects(){ const payload=await requestJson('/api/projects?status=active'); const source=Array.isArray(payload?.projects)?payload.projects:Array.isArray(payload?.items)?payload.items:[]; return source.flatMap(item=>{if(!item||typeof item!=='object')return[]; const id=String(item.project_id||item.id||'').trim(); return id?[{id,name:String(item.name||item.title||id).trim()}]:[];}); }
  function createdProject(payload){ const root=payload&&typeof payload==='object'?payload:{}; const project=root.project&&typeof root.project==='object'?root.project:root; const id=String(project.project_id||project.id||'').trim(); return id?{id,name:String(project.name||id).trim()}:null; }
  function resultProjectId(payload){ const root=payload&&typeof payload==='object'?payload:{}; const result=root.result&&typeof root.result==='object'?root.result:root.data&&typeof root.data==='object'?root.data:root; return typeof result.project_id==='string'?result.project_id:''; }
  function inferMenuMode(trigger){ return trigger instanceof Element && trigger.closest('.sidebar-project-section') ? 'folder' : 'page'; }
  function setPopoverPosition(root,trigger){ root.style.left=''; root.style.right=''; root.style.top=''; const anchor=trigger instanceof HTMLElement?trigger:document.querySelector('.platform-header-organize'); const margin=8; const rect=anchor instanceof HTMLElement?anchor.getBoundingClientRect():null; requestAnimationFrame(()=>{if(root.hidden)return; const width=root.offsetWidth||300; const height=root.offsetHeight||260; const left=rect?Math.max(margin,Math.min(innerWidth-width-margin,rect.right-width)):Math.max(margin,innerWidth-width-12); const preferred=rect?rect.bottom+6:58; const top=Math.max(margin,Math.min(innerHeight-height-margin,preferred)); root.style.left=`${Math.round(left)}px`; root.style.top=`${Math.round(top)}px`;}); }

  function ensureMainMenu(){
    if(mainMenu?.root?.isConnected)return mainMenu;
    const root=document.createElement('div'); root.className='result-organization-popover'; root.setAttribute('role','menu'); root.setAttribute('aria-label',copy().organize); root.hidden=true;
    const pin=document.createElement('button'); pin.type='button'; pin.className='result-organization-popover-action';
    const archive=document.createElement('button'); archive.type='button'; archive.className='result-organization-popover-action';
    const moveFolder=document.createElement('button'); moveFolder.type='button'; moveFolder.className='result-organization-popover-action';
    const removeFolder=document.createElement('button'); removeFolder.type='button'; removeFolder.className='result-organization-popover-action';
    const destructive=document.createElement('button'); destructive.type='button'; destructive.className='result-organization-popover-action is-danger';
    const status=document.createElement('div'); status.className='result-organization-popover-status'; status.setAttribute('role','status'); status.hidden=true;
    root.append(pin,archive,moveFolder,removeFolder,destructive,status); document.body.append(root);
    pin.addEventListener('click',async()=>{if(currentResultId&&organizationReady)await patchOrganization({pinned:!state.pinned});});
    archive.addEventListener('click',async()=>{if(currentResultId&&organizationReady)await patchOrganization({archived:!state.archived});});
    moveFolder.addEventListener('click',()=>{if(!currentResultId||!resultReady)return; const anchor=mainAnchor; closeMainMenu(); openFolderPicker(anchor,false);});
    removeFolder.addEventListener('click',async()=>{if(currentResultId&&resultReady&&state.projectId)await setProject(null);});
    destructive.addEventListener('click',async()=>{
      if(!currentResultId||!resultReady)return;
      if(menuMode==='folder'){
        if(!state.projectId||!confirm(copy().folderDeleteConfirm))return;
        setBusy(true); clearStatus();
        try{
          const deletedProjectId=state.projectId;
          await requestJson(`/api/projects/${encodeURIComponent(deletedProjectId)}`,{method:'DELETE'});
          state.projectId='';
          dispatchEvent(new CustomEvent('astera:folders-changed',{detail:{projectId:deletedProjectId,state:'deleted'}}));
          dispatchEvent(new CustomEvent('astera:result-organization-changed',{detail:{resultId:currentResultId,...state}}));
          closeAll();
          location.reload();
        }catch{showStatus(copy().failed); setBusy(false); renderMainMenu();}
        return;
      }
      if(!confirm(copy().pageDeleteConfirm))return;
      setBusy(true); clearStatus();
      try{await requestJson(`/api/results/${encodeURIComponent(currentResultId)}`,{method:'DELETE',body:{}}); closeAll(); location.reload();}
      catch{showStatus(copy().failed); setBusy(false); renderMainMenu();}
    });
    mainMenu={root,pin,archive,moveFolder,removeFolder,destructive,status}; return mainMenu;
  }

  function ensureFolderPicker(){
    if(folderPicker?.root?.isConnected)return folderPicker;
    const root=document.createElement('div'); root.className='result-folder-picker-popover'; root.setAttribute('role','dialog'); root.setAttribute('aria-label',copy().moveFolder); root.hidden=true;
    const createToggle=document.createElement('button'); createToggle.type='button'; createToggle.className='result-folder-picker-create'; createToggle.textContent=`＋ ${copy().createFolder}`;
    const createForm=document.createElement('form'); createForm.className='result-folder-create-form'; createForm.hidden=true;
    const input=document.createElement('input'); input.type='text'; input.maxLength=120; input.autocomplete='off'; input.placeholder=copy().folderName; input.setAttribute('aria-label',copy().folderName);
    const createSubmit=document.createElement('button'); createSubmit.type='submit'; createSubmit.textContent=copy().create;
    const createCancel=document.createElement('button'); createCancel.type='button'; createCancel.textContent=copy().cancel;
    createForm.append(input,createSubmit,createCancel);
    const list=document.createElement('div'); list.className='result-folder-picker-list';
    const status=document.createElement('div'); status.className='result-folder-picker-status'; status.setAttribute('role','status'); status.hidden=true;
    root.append(createToggle,createForm,list,status); document.body.append(root);
    createToggle.addEventListener('click',()=>{createForm.hidden=false; input.value=''; requestAnimationFrame(()=>input.focus());});
    createCancel.addEventListener('click',()=>{createForm.hidden=true; input.value=''; createToggle.focus();});
    createForm.addEventListener('submit',async event=>{event.preventDefault(); const name=input.value.trim(); if(!name)return; createSubmit.disabled=true; status.hidden=true; status.textContent=''; try{const payload=await requestJson('/api/projects',{method:'POST',body:{name,description:''}}); const project=createdProject(payload); dispatchEvent(new CustomEvent('astera:folders-changed',{detail:project||{}})); createForm.hidden=true; input.value=''; await renderFolderList(folderPicker?.createOnly===true); if(folderPicker?.createOnly===true)closeFolderPicker();}catch{status.textContent=copy().failed; status.hidden=false;}finally{createSubmit.disabled=false;}});
    folderPicker={root,createToggle,createForm,input,createSubmit,list,status,createOnly:false,anchor:null}; return folderPicker;
  }

  function clearStatus(){const ui=ensureMainMenu(); ui.status.textContent=''; ui.status.hidden=true;}
  function showStatus(message){const ui=ensureMainMenu(); ui.status.textContent=message; ui.status.hidden=!message;}
  function setBusy(busy){const ui=ensureMainMenu(); ui.pin.disabled=busy||!organizationReady; ui.archive.disabled=busy||!organizationReady; ui.moveFolder.disabled=busy||!resultReady; ui.removeFolder.disabled=busy||!resultReady||!state.projectId; ui.destructive.disabled=busy||!resultReady||(menuMode==='folder'&&!state.projectId);}
  function renderMainMenu(){const ui=ensureMainMenu(); ui.root.setAttribute('aria-label',copy().organize); ui.pin.textContent=state.pinned?copy().unpin:copy().pin; ui.archive.textContent=state.archived?copy().unarchive:copy().archive; ui.moveFolder.textContent=menuMode==='folder'?copy().pageMove:copy().moveFolder; ui.removeFolder.textContent=menuMode==='folder'?copy().pageRemove:copy().removeFolder; ui.destructive.textContent=menuMode==='folder'?copy().folderDelete:copy().pageDelete; setBusy(false);}
  async function setProject(projectId){const ui=ensureMainMenu(); setBusy(true); clearStatus(); try{await requestJson(`/api/results/${encodeURIComponent(currentResultId)}`,{method:'PATCH',body:{project_id:projectId}}); state.projectId=projectId||''; dispatchEvent(new CustomEvent('astera:result-organization-changed',{detail:{resultId:currentResultId,...state}}));}catch{showStatus(copy().failed);}finally{setBusy(false); renderMainMenu();}}
  async function patchOrganization(body){const ui=ensureMainMenu(); setBusy(true); clearStatus(); try{const payload=await requestJson(`/api/results/${encodeURIComponent(currentResultId)}/organization`,{method:'PATCH',body}); state.pinned=payload?.pinned===true; state.archived=payload?.archived===true; if(typeof payload?.project_id==='string')state.projectId=payload.project_id; dispatchEvent(new CustomEvent('astera:result-organization-changed',{detail:{resultId:currentResultId,...state}}));}catch(error){showStatus(error?.code==='RESULT_ORGANIZATION_MIGRATION_REQUIRED'?copy().unavailable:copy().failed);}finally{setBusy(false); renderMainMenu();}}
  async function loadMainState(){currentResultId=resultIdFromPath(); organizationReady=false; resultReady=false; state={pinned:false,archived:false,projectId:''}; clearStatus(); renderMainMenu(); if(!currentResultId)return; const [orgRes,resultRes]=await Promise.allSettled([requestJson(`/api/results/${encodeURIComponent(currentResultId)}/organization`),requestJson(`/api/results/${encodeURIComponent(currentResultId)}`)]); if(resultRes.status==='fulfilled'){resultReady=true; state.projectId=resultProjectId(resultRes.value);} if(orgRes.status==='fulfilled'){organizationReady=true; state.pinned=orgRes.value?.pinned===true; state.archived=orgRes.value?.archived===true; if(typeof orgRes.value?.project_id==='string')state.projectId=orgRes.value.project_id;}else{const error=orgRes.reason; if(currentResultId)showStatus(error?.code==='RESULT_ORGANIZATION_MIGRATION_REQUIRED'?copy().unavailable:copy().failed);} renderMainMenu();}
  async function renderFolderList(createOnly=false){const ui=ensureFolderPicker(); ui.list.replaceChildren(); ui.status.textContent=''; ui.status.hidden=true; let projects=[]; try{projects=await loadProjects();}catch{ui.status.textContent=copy().failed; ui.status.hidden=false; return;} if(createOnly)return; for(const project of projects){const button=document.createElement('button'); button.type='button'; button.className='result-folder-picker-item'; button.dataset.projectId=project.id; button.textContent=project.name; if(project.id===state.projectId)button.setAttribute('aria-current','true'); button.addEventListener('click',async()=>{if(!currentResultId||!resultReady)return; button.disabled=true; await setProject(project.id); closeFolderPicker();}); ui.list.append(button);}}
  function openMainMenu(trigger,mode){const ui=ensureMainMenu(); closeFolderPicker(); mainAnchor=trigger instanceof HTMLElement?trigger:document.querySelector('.platform-header-organize'); menuMode=mode||inferMenuMode(mainAnchor); ui.root.hidden=false; mainOpen=true; setPopoverPosition(ui.root,mainAnchor); void loadMainState();}
  function closeMainMenu(){const ui=ensureMainMenu(); ui.root.hidden=true; clearStatus(); mainOpen=false;}
  function openFolderPicker(trigger,createOnly=false){const ui=ensureFolderPicker(); closeMainMenu(); currentResultId=resultIdFromPath(); ui.createOnly=createOnly; ui.anchor=trigger instanceof HTMLElement?trigger:document.querySelector('.platform-header-organize'); ui.root.hidden=false; ui.createForm.hidden=!createOnly; ui.input.value=''; ui.status.hidden=true; ui.status.textContent=''; pickerOpen=true; setPopoverPosition(ui.root,ui.anchor); void renderFolderList(createOnly).then(()=>{if(createOnly&&pickerOpen)requestAnimationFrame(()=>ui.input.focus());});}
  function closeFolderPicker(){const ui=ensureFolderPicker(); ui.root.hidden=true; ui.createForm.hidden=true; ui.input.value=''; ui.status.hidden=true; ui.status.textContent=''; pickerOpen=false;}
  function closeAll(){closeMainMenu(); closeFolderPicker();}
  function toggleMainMenu(trigger,mode){if(mainOpen)closeMainMenu(); else openMainMenu(trigger,mode);}

  window.AsteraResultOrganization={open:(trigger,mode)=>openMainMenu(trigger,mode),close:closeAll,openFolderPicker:trigger=>openFolderPicker(trigger,false),openCreateFolder:trigger=>openFolderPicker(trigger,true)};
  document.addEventListener('click',event=>{const target=event.target; if(!(target instanceof Element))return; const trigger=target.closest('.platform-header-organize'); if(trigger){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();toggleMainMenu(trigger,'page');return;} if(mainOpen&&!target.closest('.result-organization-popover'))closeMainMenu(); if(pickerOpen&&!target.closest('.result-folder-picker-popover'))closeFolderPicker();},true);
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return; if(pickerOpen){event.preventDefault(); const anchor=folderPicker?.anchor; closeFolderPicker(); anchor?.focus?.(); return;} if(mainOpen){event.preventDefault(); const anchor=mainAnchor; closeMainMenu(); anchor?.focus?.();}});
  addEventListener('popstate',closeAll); addEventListener('resize',closeAll);
})();