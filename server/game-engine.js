import { randomInt } from 'node:crypto';

export const ROLE_RULES = Object.freeze({
  civilian:{id:'civilian',name:'Civilian',team:'town',ability:null,phase:null,targetRule:'none'},
  mafia:{id:'mafia',name:'Mafia',team:'mafia',ability:'mafia_kill',phase:'night',targetRule:'living_non_teammate'},
  don:{id:'don',name:'Don',team:'mafia',ability:'mafia_kill',phase:'night',targetRule:'living_non_teammate'},
  sheriff:{id:'sheriff',name:'Sheriff',team:'town',ability:'investigate',alternateAbility:'sheriff_shoot',shootPenaltyAgainstTeams:['town'],phase:'night',targetRule:'living_other_player'},
  doctor:{id:'doctor',name:'Doctor',team:'town',ability:'protect',phase:'night',targetRule:'any_living_player'},
  detective:{id:'detective',name:'Detective',team:'town',ability:'investigate',phase:'night',targetRule:'living_other_player'},
  jailor:{id:'jailor',name:'Jailor',team:'town',ability:'detain',phase:'night',targetRule:'living_other_player'},
  prostitute:{id:'prostitute',name:'Prostitute',team:'town',ability:'block',phase:'night',targetRule:'living_other_player'},
  vagabond:{id:'vagabond',name:'Vagabond',team:'town',ability:'observe',phase:'night',targetRule:'living_other_player'},
  maniac:{id:'maniac',name:'Maniac',team:'solo',ability:'maniac_kill',phase:'night',targetRule:'living_other_player'},
});

export function secureShuffle(input){const a=[...input];for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
export function assignRoles(userIds,mode='classic',customRoles=null){
  if(!Array.isArray(userIds)||userIds.length<6||userIds.length>12)throw new Error('A game requires 6–12 players.');let roles;
  if(mode==='custom'&&Array.isArray(customRoles)){if(customRoles.length!==userIds.length||customRoles.some(r=>!ROLE_RULES[r]))throw new Error('Custom roles must be valid and match the player count.');roles=[...customRoles];if(!roles.some(r=>ROLE_RULES[r].team==='mafia')||!roles.some(r=>ROLE_RULES[r].team==='town'))throw new Error('Custom games need both teams.');}
  else{const count=Math.max(1,Math.floor(userIds.length/3));roles=Array(count).fill('mafia');if(userIds.length>=8)roles[0]='don';for(const special of ['sheriff','doctor','detective','jailor','prostitute','vagabond'])if(roles.length+1<userIds.length)roles.push(special);while(roles.length<userIds.length)roles.push('civilian')}
  if(roles.filter(r=>r==='don').length>1||roles.filter(r=>r==='sheriff').length>1)throw new Error('A game can have at most one Don and one Sheriff.');return secureShuffle(roles).map((role,i)=>({userId:userIds[i],role,team:ROLE_RULES[role].team,seat:i+1}));
}
const roleAllows=(role,type)=>ROLE_RULES[role]?.ability===type||ROLE_RULES[role]?.alternateAbility===type;
export function validateNightAction({actor,target,phase,day,idempotencyUsed=false,actionType}){
  if(idempotencyUsed)throw new Error('Action already submitted for this phase.');if(phase!=='night')throw new Error('Actions are only accepted during night.');if(!actor||actor.status!=='alive')throw new Error('Only living players may act.');
  const type=actionType||ROLE_RULES[actor.role]?.ability;if(!roleAllows(actor.role,type))throw new Error('Your role cannot perform that action.');if(!target||target.status!=='alive')throw new Error('Target must be alive.');
  const rule=ROLE_RULES[actor.role];if(target.userId===actor.userId&&rule.targetRule!=='any_living_player')throw new Error('You cannot target yourself.');if(rule.targetRule==='living_non_teammate'&&target.team===actor.team)throw new Error('You cannot target a teammate.');return {day,phase,actionType:type};
}
export function countVotes(votes,aliveUserIds){const alive=new Set(aliveUserIds),counts=new Map();let ballots=0,skips=0;for(const vote of votes){if(!alive.has(vote.voterUserId))continue;if(vote.targetUserId===null){ballots++;skips++;continue}if(!alive.has(vote.targetUserId)||vote.targetUserId===vote.voterUserId)continue;ballots++;counts.set(vote.targetUserId,(counts.get(vote.targetUserId)||0)+1)}if(!ballots)return{eliminatedUserId:null,tied:false,noMajority:false,skipWon:false,counts,skips,ballots};const max=Math.max(skips,...counts.values()),leaders=[...counts].filter(([,n])=>n===max).map(([id])=>id);if(skips===max)leaders.push(null);const tied=leaders.length>1,skipWon=!tied&&leaders[0]===null;return{eliminatedUserId:!tied&&!skipWon?leaders[0]:null,tied,noMajority:false,skipWon,counts,skips,ballots}}

// Resolve from the same beginning-of-night snapshot; effects never depend on DB row order.
export function resolveNightActions(actions,players,{chooseTie=leaders=>leaders[randomInt(leaders.length)]}={}){
  const byId=new Map(players.map(p=>[p.userId,p])),alive=new Set(players.filter(p=>p.status==='alive').map(p=>p.userId));
  const sorted=[...actions].sort((a,b)=>String(a.actorUserId).localeCompare(String(b.actorUserId))||String(a.actionType).localeCompare(String(b.actionType))||String(a.targetUserId).localeCompare(String(b.targetUserId))),seenActors=new Set();
  const valid=sorted.filter(a=>{if(!alive.has(a.actorUserId)||!alive.has(a.targetUserId)||!roleAllows(byId.get(a.actorUserId)?.role,a.actionType)||seenActors.has(a.actorUserId))return false;seenActors.add(a.actorUserId);return true});
  const detention=valid.filter(a=>a.actionType==='detain'),detainedIds=new Set(detention.map(a=>a.targetUserId));
  const blocks=valid.filter(a=>a.actionType==='block'&&!detainedIds.has(a.actorUserId)),blockedIds=new Set([...detainedIds,...blocks.map(a=>a.targetUserId)]);
  const eligible=valid.filter(a=>!blockedIds.has(a.actorUserId)&&!detainedIds.has(a.actorUserId));
  const protectedIds=new Set(eligible.filter(a=>a.actionType==='protect').map(a=>a.targetUserId));
  const dons=players.filter(p=>alive.has(p.userId)&&p.role==='don'),don=dons[0]||null,mafiaActions=eligible.filter(a=>a.actionType==='mafia_kill'&&byId.get(a.actorUserId)?.team==='mafia');
  let finalMafiaAction=null;
  if(don){finalMafiaAction=mafiaActions.find(a=>a.actorUserId===don.userId)||null;}
  else if(mafiaActions.length){const counts=new Map();for(const a of mafiaActions)counts.set(a.targetUserId,(counts.get(a.targetUserId)||0)+1);const max=Math.max(...counts.values()),leaders=[...counts].filter(([,n])=>n===max).map(([id])=>id);finalMafiaAction=mafiaActions.find(a=>a.targetUserId===chooseTie(leaders))||null;}
  const investigations=eligible.filter(a=>a.actionType==='investigate').map(a=>({actorUserId:a.actorUserId,targetUserId:a.targetUserId,targetUsername:byId.get(a.targetUserId)?.username,result:byId.get(a.targetUserId)?.team==='mafia'?'mafia':'not_mafia'}));
  const attacks=[];if(finalMafiaAction)attacks.push({actorUserId:finalMafiaAction.actorUserId,targetUserId:finalMafiaAction.targetUserId,source:'mafia'});
  for(const a of eligible)if(a.actionType==='sheriff_shoot'||a.actionType==='maniac_kill')attacks.push({actorUserId:a.actorUserId,targetUserId:a.targetUserId,source:a.actionType==='sheriff_shoot'?'sheriff':'maniac'});
  const victims=new Set(),sheriffPenalties=[];for(const attack of attacks){if(!protectedIds.has(attack.targetUserId)&&!detainedIds.has(attack.targetUserId))victims.add(attack.targetUserId);if(attack.source==='sheriff'&&ROLE_RULES.sheriff.shootPenaltyAgainstTeams.includes(byId.get(attack.targetUserId)?.team))sheriffPenalties.push(attack.actorUserId)}for(const id of sheriffPenalties)victims.add(id);
  const visits=eligible.filter(a=>['investigate','sheriff_shoot','protect','detain','block','observe','maniac_kill'].includes(a.actionType)).map(a=>({actorUserId:a.actorUserId,targetUserId:a.targetUserId}));if(finalMafiaAction)visits.push({actorUserId:finalMafiaAction.actorUserId,targetUserId:finalMafiaAction.targetUserId});
  const observations=eligible.filter(a=>a.actionType==='observe').map(a=>({actorUserId:a.actorUserId,targetUserId:a.targetUserId,targetUsername:byId.get(a.targetUserId)?.username,visitors:visits.filter(v=>v.targetUserId===a.targetUserId).map(v=>({userId:v.actorUserId,username:byId.get(v.actorUserId)?.username}))}));
  const blockResults=valid.filter(a=>a.actionType==='block').map(a=>({actorUserId:a.actorUserId,targetUserId:a.targetUserId,targetUsername:byId.get(a.targetUserId)?.username,executed:eligible.some(other=>other.actorUserId===a.actorUserId&&other.actionType==='block'),blocked:eligible.some(other=>other.actorUserId===a.actorUserId&&other.actionType==='block')&&valid.some(other=>other.actorUserId===a.targetUserId)}));
  return{eliminatedUserIds:[...victims],eliminatedUserId:[...victims][0]??null,investigations,observations,blockResults,protectedUserIds:[...protectedIds],mafiaAttack:finalMafiaAction?{actorUserId:finalMafiaAction.actorUserId,targetUserId:finalMafiaAction.targetUserId}:null,sheriffPenalties};
}
export function getPublicGameState(game,players,viewerId){const mine=players.find(p=>p.userId===viewerId);if(!mine)throw new Error('Only game members can view game state.');const reveal=game.status==='completed';return{id:game.id,roomId:game.roomId,hostUserId:game.hostUserId,status:game.status,phase:game.currentPhase,dayNumber:game.dayNumber,phaseStartedAt:game.phaseStartedAt,phaseEndsAt:game.phaseEndsAt,winnerTeam:game.winnerTeam,revision:Number(game.revision||0),me:{userId:mine.userId,role:mine.role,team:mine.team,status:mine.status,...(mine.team==='mafia'?{mafiaTeammates:players.filter(p=>p.team==='mafia'&&p.userId!==mine.userId).map(p=>({userId:p.userId,username:p.username}))}:{})},players:players.map(p=>({userId:p.userId,username:p.username,avatar:p.avatar,seat:p.seat,status:p.status,...(p.isBot?{isBot:true}:{}),...(reveal||p.status==='eliminated'?{role:p.role,team:p.team}:{})}))}}
export function getWinner(players){const alive=players.filter(p=>p.status==='alive'),mafia=alive.filter(p=>p.team==='mafia').length,town=alive.filter(p=>p.team==='town').length,maniacs=alive.filter(p=>p.team==='solo'&&p.role==='maniac').length;if(maniacs===1&&alive.length===1)return'solo';if(mafia===0&&maniacs===0)return'town';if(mafia>=town&&mafia>0)return'mafia';return null}
