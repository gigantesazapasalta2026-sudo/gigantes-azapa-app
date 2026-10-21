/* Copa FUFY 2026: motor único de fixture y tabla, sin credenciales ni datos personales. */
(function(global){
'use strict';
const localTime=new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago',hour:'2-digit',minute:'2-digit',hour12:false});
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function time(m){return m?.starts_at?localTime.format(new Date(m.starts_at)):'Por definir';}
function isFinal(m){return m?.status==='final'&&Number.isInteger(m.home_score)&&Number.isInteger(m.away_score);}
function points(s1,s2){return s1>s2?4:s1===s2?2:0;}
function makeStats(t){return {id:t.id,name:t.name,pj:0,pg:0,pe:0,pp:0,pf:0,pc:0,dif:0,tries:0,ambiguousTries:false,red:0,yellow:0,pts:0};}
function standings(teams,matches){
  const rows=(teams||[]).map(makeStats),byId=new Map(rows.map(r=>[r.id,r]));
  const played=(matches||[]).filter(isFinal);
  for(const m of played){
    const h=byId.get(m.home_team_id),a=byId.get(m.away_team_id);if(!h||!a)continue;
    h.pj++;a.pj++;h.pf+=m.home_score;h.pc+=m.away_score;a.pf+=m.away_score;a.pc+=m.home_score;
    const draw=m.home_score===m.away_score;h.pg+=!draw&&m.home_score>m.away_score?1:0;a.pg+=!draw&&m.away_score>m.home_score?1:0;
    h.pe+=draw?1:0;a.pe+=draw?1:0;h.pp+=!draw&&m.home_score<m.away_score?1:0;a.pp+=!draw&&m.away_score<m.home_score?1:0;
    h.pts+=points(m.home_score,m.away_score);a.pts+=points(m.away_score,m.home_score);
    h.tries+=Number(m.home_tries||0);a.tries+=Number(m.away_tries||0);
    h.ambiguousTries ||= m.home_tries===null||m.home_tries===undefined;
    a.ambiguousTries ||= m.away_tries===null||m.away_tries===undefined;
    h.red+=Number(m.home_red||0);a.red+=Number(m.away_red||0);
    h.yellow+=Number(m.home_yellow||0);a.yellow+=Number(m.away_yellow||0);
  }
  rows.forEach(r=>r.dif=r.pf-r.pc);
  // Bases definitivas 21/10/2026: solo los puntos determinan el orden automaticamente.
  // En empates, diferencia, tries, resultado directo y tarjetas NO desempatan.
  rows.sort((a,b)=>b.pts-a.pts||a.name.localeCompare(b.name,'es'));
  let rank=0,lastPts=null;
  const sorted=rows.map((r,i)=>{if(r.pts!==lastPts){rank=i+1;lastPts=r.pts;}return {...r,pos:rank};});
  const tie=sorted.some((r,i)=>i>0&&r.pts===sorted[i-1].pts);
  return {rows:sorted,played:played.length,total:(matches||[]).length,
    needsTryReview:false,unresolvedTies:tie&&played.length===matches.length&&matches.length>0};
}
function fixtureAudit(teams,matches){
 const ids=new Set(teams.map(t=>t.id)),pairs=new Set(),per=new Map(teams.map(t=>[t.id,0])),issues=[];
 if(teams.length!==4)issues.push('La liga debe tener cuatro equipos.');
 if(matches.length!==6)issues.push('La liga debe tener seis encuentros.');
 for(const m of matches){
  if(!ids.has(m.home_team_id)||!ids.has(m.away_team_id)||m.home_team_id===m.away_team_id){issues.push('Partido con equipo no participante o duplicado.');continue;}
  const pair=[m.home_team_id,m.away_team_id].sort().join('|');
  if(pairs.has(pair))issues.push('Hay cruces duplicados.');else pairs.add(pair);
  per.set(m.home_team_id,(per.get(m.home_team_id)||0)+1);per.set(m.away_team_id,(per.get(m.away_team_id)||0)+1);
 }
 for(const [id,n] of per)if(n!==3)issues.push('Algún equipo no tiene tres partidos.');
 if(matches.length===6&&pairs.size!==6)issues.push('No aparecen todos los cruces.');
 return [...new Set(issues)];
}
global.FUFY_LEAGUE={escape,time,isFinal,standings,fixtureAudit,points};
})(window);
