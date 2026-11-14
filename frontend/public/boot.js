(async function(){
 const enabled=window.MOA_RUNTIME?.server===true;
 let revision=0,blocked=false,pending=null,saving=false,timer;
 const label=document.createElement('span');label.className='persistence-status';label.setAttribute('role','status');document.querySelector('footer').append(label);
 function status(text,bad=false){label.textContent=text;label.classList.toggle('sync-error',bad)}
 async function flush(){
  if(saving||blocked||!pending)return;saving=true;
  const snapshot=pending;pending=null;
  try{const r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:snapshot,expectedRevision:revision})});if(r.status===409){blocked=true;throw Error('다른 탭에서 수정됐어요. 새로고침 후 다시 진행해 주세요.')}if(!r.ok)throw Error('서버 저장 실패 · 브라우저 기록은 유지돼요.');const body=await r.json();revision=body.revision;status('개발 서버에 저장됨')}
  catch(e){if(!blocked&&!pending)pending=snapshot;status(e.message,true)}
  finally{saving=false;if(pending&&!blocked)timer=setTimeout(flush,3000)}
 }
 const persistence={mode:enabled?'server':'browser',initialState:null,save(state){if(!enabled||blocked)return;pending=structuredClone(state);status('개발 서버에 저장 중');clearTimeout(timer);timer=setTimeout(flush,350)}};
 window.MoaPersistence=persistence;
 if(enabled){
  document.querySelector('.demo-note').textContent='체험 버전 · 예시 모임 · 단일 사용자 개발 서버';status('개발 서버 기록 불러오는 중');
  try{const r=await fetch('/api/state');if(!r.ok)throw Error('서버 기록을 불러오지 못했어요.');const data=await r.json();revision=data.revision;persistence.initialState=data.state;persistence.ignoreBrowser=true;status('개발 서버 연결됨')}
  catch(e){blocked=true;document.getElementById('main').innerHTML='<div class="wrap"><div class="empty"><h3>서버 기록을 불러오지 못했어요</h3><p>서버 상태를 확인한 뒤 새로고침해 주세요. 기존 기록을 빈 데이터로 덮어쓰지 않았어요.</p></div></div>';status(e.message,true);return}
 }else status('브라우저 저장 모드');
 const script=document.createElement('script');script.src='app.js';script.onerror=()=>status('화면 코드를 불러오지 못했어요.',true);document.body.append(script);
 window.addEventListener('beforeunload',e=>{if(enabled&&(pending||saving)){e.preventDefault();e.returnValue=''}});
})();
