/* Local prototype rules. Production enforcement must run with authenticated identities on a server. */
(function(root){
  const active=m=>m.status!=='expelled';
  function roster(g,joined){
    const host={id:g.owner==='me'?'me':'host-'+g.id,name:g.mentor,host:true,status:'active'};
    const rows=[host,...g.members.filter(active).map(m=>({...m,host:false}))];
    if(joined.includes(g.id)&&!rows.some(m=>m.id==='me')&&!(g.blocked||[]).includes('me'))rows.push({id:'me',name:'나',host:false,status:'active'});
    return rows.filter((m,i,a)=>a.findIndex(x=>x.id===m.id)===i);
  }
  function majority(g,joined,target,reports){
    const eligible=roster(g,joined).filter(m=>m.id!==target).map(m=>m.id);
    const reporters=[...new Set(reports.map(r=>r.reporterId))].filter(id=>eligible.includes(id));
    const required=Math.floor(eligible.length/2)+1;
    return {eligible:eligible.length,eligibleIds:eligible,reporters:reporters.length,required,reached:eligible.length>0&&reporters.length>=required};
  }
  function openCase(cases,gid,target){return cases.find(c=>c.group===gid&&c.target===target&&c.status==='open')}
  function canCare(g,m,cases){
    if(!m||!active(m))return false;
    if(openCase(cases,g.id,m.id))return true;
    const closed=cases.filter(c=>c.group===g.id&&c.target===m.id&&c.status==='resolved');
    const seen=new Set(closed.flatMap(c=>c.absenceDates||[]));
    return [...new Set(m.absences)].filter(d=>!seen.has(d)).length>=3;
  }
  function submitCare(s,gid,target,actor,reason,at,id){
    const g=s.groups.find(g=>g.id===gid),m=g?.members.find(m=>m.id===target);
    if(!g||!m||target===actor||!roster(g,s.joined).some(m=>m.id===actor)||!canCare(g,m,s.careCases))throw Error('같은 모임에서 공지 없는 불참이 3회 이상인 동료에게만 요청할 수 있어요.');
    if(!reason.trim())throw Error('확인한 내용을 입력해 주세요.');
    let c=openCase(s.careCases,gid,target);
    if(c?.requests.some(r=>r.reporterId===actor))throw Error('이미 안부를 요청했어요. 한 사람의 요청은 한 번만 계산해요.');
    if(!c){c={id,group:gid,target,name:m.name,status:'open',requests:[],absenceDates:[...new Set(m.absences)],at};s.careCases.push(c)}
    c.requests.push({reporterId:actor,reason:reason.trim(),at});
    const count=new Set(c.requests.map(r=>r.reporterId)).size;
    if(count>=3&&!s.aidQueue.some(q=>q.caseId===c.id))s.aidQueue.push({id:'aid-'+c.id,caseId:c.id,group:gid,target,name:m.name,status:'blocked',at,attempts:0,sentAt:null});
    return c;
  }
  function submitConduct(s,gid,target,actor,reason,category,at,id){
    const g=s.groups.find(g=>g.id===gid),m=g?.members.find(m=>m.id===target);
    if(!g||!m||!active(m)||target===actor||!roster(g,s.joined).some(m=>m.id===actor))throw Error('같은 모임의 다른 참여자만 신고할 수 있어요.');
    if(!reason.trim())throw Error('모임장이 확인할 구체적인 내용을 적어 주세요.');
    let c=openCase(s.conductCases,gid,target);
    if(c?.reports.some(r=>r.reporterId===actor))throw Error('이미 신고했어요. 한 사람의 신고는 한 표로 계산해요.');
    if(!c){c={id,group:gid,target,name:m.name,status:'open',reports:[],at};s.conductCases.push(c)}
    c.reports.push({reporterId:actor,reason:reason.trim(),category,at});return c;
  }
  function expel(s,caseId,actor,reason,at){
    const c=s.conductCases.find(c=>c.id===caseId),g=s.groups.find(g=>g.id===c?.group),m=g?.members.find(m=>m.id===c?.target);
    if(!g||g.owner!==actor||actor!=='me'||!m||!active(m)||c.status!=='open')throw Error('현재 모임장만 참여 제한을 결정할 수 있어요.');
    const vote=majority(g,s.joined,c.target,c.reports);
    if(!vote.reached)throw Error('신고 인원이 과반수에 도달하지 않았어요.');
    if(!reason.trim())throw Error('검토 결과와 퇴출 사유를 기록해 주세요.');
    m.status='expelled';g.blocked=[...new Set([...(g.blocked||[]),m.id])];
    if(m.id==='me')s.joined=s.joined.filter(x=>x!==g.id);
    c.status='expelled';c.decision={actor,reason:reason.trim(),at,reporters:vote.reporters,electorate:vote.eligible,required:vote.required};
    s.moderationLog.push({caseId,group:g.id,target:m.id,action:'expelled',...c.decision});return c;
  }
  function restore(s,caseId,actor,reason,at){
    const c=s.conductCases.find(c=>c.id===caseId),g=s.groups.find(g=>g.id===c?.group),m=g?.members.find(m=>m.id===c?.target);
    if(!g||g.owner!==actor||actor!=='me'||!m||c.status!=='expelled')throw Error('현재 모임장만 참여 제한을 해제할 수 있어요.');
    if(!reason.trim())throw Error('제한을 해제하는 이유를 기록해 주세요.');
    m.status='active';g.blocked=(g.blocked||[]).filter(x=>x!==m.id);c.status='restored';
    s.moderationLog.push({caseId,group:g.id,target:m.id,action:'restored',actor,reason:reason.trim(),at});return c;
  }
  function resolveCare(s,caseId,actor,outcome,at){
    const c=s.careCases.find(c=>c.id===caseId),g=s.groups.find(g=>g.id===c?.group);
    if(!c||c.status!=='open'||!g||!roster(g,s.joined).some(m=>m.id===actor)||!(g.owner===actor||c.requests.some(r=>r.reporterId===actor)))throw Error('요청자 또는 모임장만 안부 확인을 완료할 수 있어요.');
    if(!outcome.trim())throw Error('안부를 확인한 내용을 적어 주세요.');
    c.status='resolved';c.outcome=outcome.trim();c.resolvedAt=at;c.resolvedBy=actor;
    s.aidQueue.filter(q=>q.caseId===caseId&&q.status==='blocked').forEach(q=>{q.status='cancelled';q.cancelledAt=at});return c;
  }
  const api={active,roster,majority,openCase,canCare,submitCare,submitConduct,expel,restore,resolveCare};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MoaSafety=api;
})(typeof globalThis!=='undefined'?globalThis:this);
