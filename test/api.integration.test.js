import test from 'node:test';
import assert from 'node:assert/strict';

const testUrl=process.env.TEST_DATABASE_URL;
const safeTestDatabase=(()=>{try{return !!testUrl&&/(^|[_-])test([_-]|$)/i.test(new URL(testUrl).pathname)}catch{return false}})();

test('HTTP auth, rooms, game privacy, and rule guards (isolated MySQL test database)',{skip:safeTestDatabase?false:'Set TEST_DATABASE_URL to a disposable database whose name includes test, then run migrations.'},async t=>{
  process.env.NODE_ENV='test';process.env.DATABASE_URL=testUrl;process.env.REALTIME_PROVIDER='disabled';process.env.CRON_SECRET='isolated-test-cron-secret';
  const [{default:supertest},appModule,{getPool}]=await Promise.all([import('supertest'),import('../server/app.js'),import('../server/db.js')]);
  const {default:app,advanceExpiredGames}=appModule;
  await getPool().execute('DELETE FROM rate_limit_buckets');
  const suffix=Date.now().toString(36),users=[],rooms=[];
  async function register(name){const agent=supertest.agent(app);const response=await agent.post('/api/auth/register').send({username:`${name}${suffix}`,email:`${name}${suffix}@example.test`,password:'testing-password-2026'});assert.equal(response.status,201);const context={agent,user:response.body.user,csrf:response.body.csrfToken};users.push(context);return context}
  const post=(context,path,body={})=>context.agent.post(path).set('x-csrf-token',context.csrf).send(body);
  try {
    const host=await register('host');
    await t.test('duplicate accounts, incorrect passwords, session, and CSRF are handled',async()=>{
      const duplicate=await host.agent.post('/api/auth/register').send({username:`host${suffix}`,email:`other${suffix}@example.test`,password:'testing-password-2026'});assert.equal(duplicate.status,409);
      const badLogin=await supertest(app).post('/api/auth/login').send({login:host.user.username,password:'wrong-password'});assert.equal(badLogin.status,401);
      const unauth=await supertest(app).get('/api/rooms');assert.equal(unauth.status,401);
      const badCsrf=await host.agent.post('/api/auth/logout').set('x-csrf-token','not-the-session-token').send({});assert.equal(badCsrf.status,403);
      const me=await host.agent.get('/api/auth/me');assert.equal(me.status,200);assert.equal(me.body.user.id,host.user.id);
    });
    await t.test('room access is private, capacity is enforced, and concurrent joins cannot overfill',async()=>{
      const privateKey=`room-create-${suffix}`,privateBody={name:`Private${suffix}`,visibility:'private',password:'private-test-pass',maxPlayers:6},createAttempts=await Promise.all([post(host,'/api/rooms',privateBody).set('Idempotency-Key',privateKey),post(host,'/api/rooms',privateBody).set('Idempotency-Key',privateKey)]);assert.deepEqual(createAttempts.map(r=>r.status).sort(),[200,201]);const privateRoom=createAttempts.find(r=>r.status===201);rooms.push(privateRoom.body.room.id);assert.equal(createAttempts[0].body.room.id,createAttempts[1].body.room.id);
      const outsider=await register('guest');
      const wrong=await post(outsider,`/api/rooms/${privateRoom.body.room.id}/join`,{password:'incorrect'});assert.equal(wrong.status,403);
      const room=await post(host,'/api/rooms',{name:`Public${suffix}`,visibility:'public',maxPlayers:6});assert.equal(room.status,201);rooms.push(room.body.room.id);
      const joiners=[];for(let i=0;i<6;i++)joiners.push(await register(`player${i}`));
      const attempts=await Promise.all(joiners.map(p=>post(p,`/api/rooms/${room.body.room.id}/join`)));
      assert.equal(attempts.filter(r=>r.status===200).length,5);
      assert.equal(attempts.filter(r=>r.status===409).length,1);
      const leaseRoom=await post(host,'/api/rooms',{name:`Lease${suffix}`,visibility:'public',maxPlayers:6});assert.equal(leaseRoom.status,201);rooms.push(leaseRoom.body.room.id);assert.equal((await post(joiners[0],`/api/rooms/${leaseRoom.body.room.id}/join`)).status,200);await joiners[0].agent.get(`/api/rooms/${leaseRoom.body.room.id}`);await getPool().execute('UPDATE room_members SET last_seen_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 90 SECOND) WHERE room_id=? AND user_id=?',[leaseRoom.body.room.id,host.user.id]);const transferred=await joiners[0].agent.get(`/api/rooms/${leaseRoom.body.room.id}`);assert.equal(transferred.status,200);assert.equal(transferred.body.room.host_user_id,joiners[0].user.id);const closed=await post(joiners[0],`/api/rooms/${leaseRoom.body.room.id}/close`);assert.equal(closed.status,200);const closedRoom=await joiners[0].agent.get(`/api/rooms/${leaseRoom.body.room.id}`);assert.equal(closedRoom.body.room.status,'closed');assert.equal(closedRoom.body.members.length,0);await getPool().execute('UPDATE rooms SET updated_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 31 DAY) WHERE id=?',[leaseRoom.body.room.id]);const cleanup=await supertest(app).post('/api/jobs/reconcile').set('authorization','Bearer isolated-test-cron-secret');assert.equal(cleanup.status,200);assert.ok(cleanup.body.cleanedInactiveRooms>=1);const [retainedRoom]=await getPool().execute('SELECT id FROM rooms WHERE id=?',[leaseRoom.body.room.id]);assert.equal(retainedRoom.length,0);
    });
    await t.test('room listing reflects authoritative public rooms, live occupancy, capacity, and lifecycle',async()=>{
      const room=await post(host,'/api/rooms',{name:`Listed${suffix}`,visibility:'public',maxPlayers:6});assert.equal(room.status,201);rooms.push(room.body.room.id);
      const privateRoom=await post(host,'/api/rooms',{name:`Hidden${suffix}`,visibility:'private',password:'private-test-pass',maxPlayers:6});assert.equal(privateRoom.status,201);rooms.push(privateRoom.body.room.id);
      const guest=users[1],joiners=users.filter(player=>player!==host&&player!==guest).slice(0,5);assert.equal(joiners.length,5);
      const first=await host.agent.get('/api/rooms');assert.equal(first.status,200);assert.ok(first.body.rooms.some(r=>r.id===room.body.room.id&&Number(r.player_count)===1));assert.ok(!first.body.rooms.some(r=>r.id===privateRoom.body.room.id));
      for(const player of joiners)assert.equal((await post(player,`/api/rooms/${room.body.room.id}/join`)).status,200)
      const full=await guest.agent.get('/api/rooms');const listed=full.body.rooms.find(r=>r.id===room.body.room.id);assert.ok(listed);assert.equal(Number(listed.player_count),6);assert.equal(Number(listed.max_players),6);assert.equal(listed.status,'waiting');
      assert.equal((await post(guest,`/api/rooms/${room.body.room.id}/join`)).status,409);
      assert.equal((await post(host,`/api/rooms/${room.body.room.id}/close`)).status,200);
      const afterClose=await guest.agent.get('/api/rooms');assert.ok(!afterClose.body.rooms.some(r=>r.id===room.body.room.id));
    });
    await t.test('idle waiting rooms expire while rooms with a recent human heartbeat remain',async()=>{
      const idle=await post(host,'/api/rooms',{name:`Idle${suffix}`,visibility:'public',maxPlayers:6}),active=await post(host,'/api/rooms',{name:`Active${suffix}`,visibility:'public',maxPlayers:6});assert.equal(idle.status,201);assert.equal(active.status,201);rooms.push(idle.body.room.id,active.body.room.id);
      await getPool().execute('UPDATE rooms SET created_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 3 MINUTE) WHERE id IN (?,?)',[idle.body.room.id,active.body.room.id]);await getPool().execute('UPDATE room_members SET last_seen_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 3 MINUTE) WHERE room_id=? AND user_id=?',[idle.body.room.id,host.user.id]);await getPool().execute('UPDATE room_members SET last_seen_at=UTC_TIMESTAMP(3) WHERE room_id=? AND user_id=?',[active.body.room.id,host.user.id]);
      const cleanup=await supertest(app).post('/api/jobs/reconcile').set('authorization','Bearer isolated-test-cron-secret');assert.equal(cleanup.status,200);assert.ok(cleanup.body.cleanedInactiveRooms>=1);const [remaining]=await getPool().execute('SELECT id FROM rooms WHERE id IN (?,?)',[idle.body.room.id,active.body.room.id]);assert.deepEqual(remaining.map(r=>r.id),[active.body.room.id]);
    });
    await t.test('only the host starts after readiness; roles and phases are server-controlled',async()=>{
      const extraPlayer=await register('extra');
      const roomResponse=await post(host,'/api/rooms',{name:`Game${suffix}`,visibility:'public',mode:'custom',maxPlayers:8,settings:{minPlayers:8,customRoles:['mafia','mafia','sheriff','doctor','detective','prostitute','civilian','civilian']}});assert.equal(roomResponse.status,201);rooms.push(roomResponse.body.room.id);const roomId=roomResponse.body.room.id;
      const emptyRoom=await host.agent.get(`/api/rooms/${roomId}`);assert.equal(emptyRoom.status,200,JSON.stringify(emptyRoom.body));assert.equal(emptyRoom.body.members.length,1);assert.equal(emptyRoom.body.members[0].id,host.user.id);const roomSettings=typeof emptyRoom.body.room.settings_json==='string'?JSON.parse(emptyRoom.body.room.settings_json):emptyRoom.body.room.settings_json;assert.equal(roomSettings.daySeconds,60);assert.equal(roomSettings.chatDuringVoting,false);
      const outsider=users.find(u=>u.user.username===`guest${suffix}`);
      const team=[host,...users.filter(u=>u!==host&&u.user.username!==`guest${suffix}`)];assert.equal(team.length,8);assert.ok(team.includes(extraPlayer));
      for(const p of team.slice(1)){const joined=await post(p,`/api/rooms/${roomId}/join`);assert.equal(joined.status,200)}
      const denied=await post(team[1],`/api/rooms/${roomId}/start`);assert.equal(denied.status,403);
      for(const p of team.slice(1)){const ready=await post(p,`/api/rooms/${roomId}/ready`,{ready:true});assert.equal(ready.status,200)}
      const messageKey=`lobby-message-${suffix}`,lobbyChat=await post(host,`/api/rooms/${roomId}/messages`,{message:'Waiting for everyone.',channel:'room'}).set('Idempotency-Key',messageKey);assert.equal(lobbyChat.status,201);const duplicateChat=await post(host,`/api/rooms/${roomId}/messages`,{message:'Waiting for everyone.',channel:'room'}).set('Idempotency-Key',messageKey);assert.equal(duplicateChat.status,200);assert.equal(duplicateChat.body.message.id,lobbyChat.body.message.id);
      const started=await post(host,`/api/rooms/${roomId}/start`);assert.equal(started.status,201);const gameId=started.body.gameId;
      const lateReady=await post(host,`/api/rooms/${roomId}/ready`,{ready:false});assert.equal(lateReady.status,409);
      const state=await host.agent.get(`/api/games/${gameId}/state`);assert.equal(state.status,200);assert.equal(state.body.game.phase,'role_reveal');assert.equal(state.body.game.dayNumber,1);assert.ok(state.body.game.me.role);assert.ok(state.body.game.players.every(p=>!Object.hasOwn(p,'role')));
      const otherState=await team[1].agent.get(`/api/games/${gameId}/state`);assert.equal(otherState.status,200);assert.ok(otherState.body.game.me.role);assert.ok(otherState.body.game.players.every(p=>!Object.hasOwn(p,'role')));
      const vote=await post(host,`/api/games/${gameId}/votes`,{targetUserId:team[1].user.id});assert.equal(vote.status,409);
      const early=await post(host,`/api/games/${gameId}/advance-phase`);assert.equal(early.status,409);
      const role=await team[1].agent.get(`/api/games/${gameId}/role`);assert.equal(role.status,200);
      const nonPlayer=await post(outsider,`/api/games/${gameId}/votes`,{targetUserId:host.user.id});assert.equal(nonPlayer.status,403);

      const pool=getPool(),[roster]=await pool.execute('SELECT user_id,role,team FROM game_players WHERE game_id=?',[gameId]);
      // Keep the accused away from the test's required-role set even when the host was randomly dealt Civilian.
      if(!roster.some(p=>p.role==='civilian'&&p.user_id!==host.user.id)){const detective=roster.find(p=>p.role==='detective'&&p.user_id!==host.user.id);assert.ok(detective);await pool.execute('UPDATE game_players SET role=IF(user_id=? ,"detective","civilian") WHERE game_id=? AND user_id IN (?,?)',[host.user.id,gameId,host.user.id,detective.user_id]);}
      await pool.execute('UPDATE games SET phase_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[gameId]);const automaticTransitions=await advanceExpiredGames();assert.ok(automaticTransitions.some(x=>x.gameId===gameId&&x.phase==='night'));const firstNight=await host.agent.get(`/api/games/${gameId}/state`);assert.equal(firstNight.status,200);assert.equal(firstNight.body.game.phase,'night');
      await pool.execute('UPDATE games SET current_phase="day",day_number=1,phase_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[gameId]);
      const civilian=roster.find(p=>p.role==='civilian'&&p.team==='town'&&p.user_id!==host.user.id)||roster.find(p=>p.role==='detective'&&p.team==='town'&&p.user_id!==host.user.id);assert.ok(civilian,'a non-host Town player is available for the test vote');
      const civilianContext=team.find(p=>p.user.id===civilian.user_id);assert.ok(civilianContext);
      const dayChat=await post(host,`/api/rooms/${roomId}/messages`,{message:'Day one discussion.',channel:'day'});assert.equal(dayChat.status,201);
      const dayMessages=await host.agent.get(`/api/rooms/${roomId}/messages?channel=day`);assert.equal(dayMessages.status,200);assert.ok(dayMessages.body.messages.some(m=>m.message==='Day one discussion.'));

      // This scenario intentionally exercises many requests; reset the shared test IP bucket before the vote flow.
      await pool.execute('DELETE FROM rate_limit_buckets');
      await pool.execute('UPDATE games SET phase_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[gameId]);
      const openVote=await post(host,`/api/games/${gameId}/advance-phase`);assert.equal(openVote.status,200);assert.equal(openVote.body.game.phase,'voting');
      const nextTarget=team.find(p=>p!==host&&p.user.id!==civilian.user_id);assert.ok(nextTarget);
      const firstVote=await post(host,`/api/games/${gameId}/votes`,{targetUserId:civilian.user_id});assert.equal(firstVote.status,200);
      const changedVote=await post(host,`/api/games/${gameId}/votes`,{targetUserId:nextTarget.user.id});assert.equal(changedVote.status,409);assert.equal(changedVote.body.error.code,'vote_locked');
      const skippedVoter=team.find(p=>p!==host&&p!==civilianContext&&p!==nextTarget);for(const voter of team.filter(p=>p!==host&&p.user.id!==civilian.user_id)){const result=await post(voter,`/api/games/${gameId}/votes`,{targetUserId:voter===skippedVoter?null:civilian.user_id});assert.equal(result.status,200)}
      const ownVote=await host.agent.get(`/api/games/${gameId}/state`);assert.equal(ownVote.body.game.me.hasVoted,true);assert.equal(ownVote.body.game.me.voteTargetUserId,civilian.user_id);
      assert.ok(ownVote.body.game.publicVotes.some(v=>v.voterUserId===host.user.id&&v.targetUserId===civilian.user_id));assert.ok(ownVote.body.game.publicVotes.some(v=>v.voterUserId===skippedVoter.user.id&&v.skipped));assert.ok(ownVote.body.game.events.some(e=>e.type==='vote_cast'&&e.message.includes(`${host.user.username} voted for`)));
      const votingChat=await host.agent.get(`/api/rooms/${roomId}/messages?channel=day`);assert.equal(votingChat.status,403);assert.equal(votingChat.body.error.code,'chat_closed');
      const completingVote=await post(civilianContext,`/api/games/${gameId}/votes`,{targetUserId:host.user.id});assert.equal(completingVote.status,200);const verdictSnapshot=await host.agent.get(`/api/games/${gameId}/state`);assert.equal(verdictSnapshot.body.game.phase,'verdict');assert.equal(verdictSnapshot.body.game.verdictTarget.userId,civilian.user_id);
      for(const voter of team.filter(p=>p.user.id!==civilian.user_id)){const ballot=await post(voter,`/api/games/${gameId}/verdict`,{convict:true});assert.equal(ballot.status,200)}
      const nightStart=await host.agent.get(`/api/games/${gameId}/state`);assert.equal(nightStart.status,200);assert.equal(nightStart.body.game.phase,'night');assert.equal(nightStart.body.game.dayNumber,2);const [convicted]=await pool.execute('SELECT player_status FROM game_players WHERE game_id=? AND user_id=?',[gameId,civilian.user_id]);assert.equal(convicted[0].player_status,'eliminated');

      const [alive]=await pool.execute('SELECT user_id,role,team FROM game_players WHERE game_id=? AND player_status="alive"',[gameId]);
      const mafia=alive.find(p=>p.role==='don')||alive.find(p=>p.role==='mafia'),otherMafia=alive.find(p=>p.role==='mafia'&&p.user_id!==mafia.user_id),doctor=alive.find(p=>p.role==='doctor'),sheriff=alive.find(p=>p.role==='sheriff'),detective=alive.find(p=>p.role==='detective'),prostitute=alive.find(p=>p.role==='prostitute');
      assert.ok(mafia&&otherMafia&&doctor&&sheriff&&detective&&prostitute,`Mafia, Doctor, Sheriff, Detective, and Prostitute should be alive after verdict; alive roles: ${alive.map(p=>`${p.role}:${p.user_id}`).join(', ')}`);
      const mafiaContext=team.find(p=>p.user.id===mafia.user_id),otherMafiaContext=team.find(p=>p.user.id===otherMafia.user_id),doctorContext=team.find(p=>p.user.id===doctor.user_id),sheriffContext=team.find(p=>p.user.id===sheriff.user_id),detectiveContext=team.find(p=>p.user.id===detective.user_id),prostituteContext=team.find(p=>p.user.id===prostitute.user_id);
      const townTargets=alive.filter(p=>p.team==='town');
      const protectedTarget=townTargets.find(p=>p.user_id!==doctor.user_id);
      assert.ok(protectedTarget);
      const protect=await post(doctorContext,`/api/games/${gameId}/actions`,{actionType:'protect',targetUserId:protectedTarget.user_id});assert.equal(protect.status,201);
      const changedAction=await post(doctorContext,`/api/games/${gameId}/actions`,{actionType:'protect',targetUserId:protectedTarget.user_id});assert.equal(changedAction.status,409);assert.equal(changedAction.body.error.code,'action_locked');
      const investigate=await post(sheriffContext,`/api/games/${gameId}/actions`,{actionType:'investigate',targetUserId:mafia.user_id});assert.equal(investigate.status,201);
      const kill=await post(mafiaContext,`/api/games/${gameId}/actions`,{actionType:'mafia_kill',targetUserId:protectedTarget.user_id});assert.equal(kill.status,201);
      const changedKill=await post(mafiaContext,`/api/games/${gameId}/actions`,{actionType:'mafia_kill',targetUserId:townTargets.find(p=>p.user_id!==protectedTarget.user_id).user_id});assert.equal(changedKill.status,409);assert.equal(changedKill.body.error.code,'action_locked');
      const reconnectedState=await doctorContext.agent.get(`/api/games/${gameId}/state`);assert.equal(reconnectedState.status,200);assert.equal(reconnectedState.body.game.me.actionSubmitted,true);assert.equal(reconnectedState.body.game.me.actionTargetUserId,protectedTarget.user_id);
      const secondSheriffAction=await post(sheriffContext,`/api/games/${gameId}/actions`,{actionType:'sheriff_shoot',targetUserId:protectedTarget.user_id});assert.equal(secondSheriffAction.status,409);assert.equal(secondSheriffAction.body.error.code,'action_locked');
      const mafiaChat=await post(mafiaContext,`/api/rooms/${roomId}/messages`,{message:'Choose the target.',channel:'mafia'});assert.equal(mafiaChat.status,201);
      const mafiaMessages=await mafiaContext.agent.get(`/api/rooms/${roomId}/messages?channel=mafia`);assert.equal(mafiaMessages.status,200);assert.ok(mafiaMessages.body.messages.some(m=>m.message==='Choose the target.'));
      const townNightChat=await post(host,`/api/rooms/${roomId}/messages`,{message:'This should be blocked.',channel:'day'});assert.equal(townNightChat.status,403);
      const beforeRequiredActions=await host.agent.get(`/api/games/${gameId}/state`);assert.equal(beforeRequiredActions.body.game.phase,'night');
      const teamTarget=alive.find(p=>p.team!=='mafia'&&p.user_id!==otherMafia.user_id);assert.ok(teamTarget);
      const partnerKill=await post(otherMafiaContext,`/api/games/${gameId}/actions`,{actionType:'mafia_kill',targetUserId:protectedTarget.user_id});assert.equal(partnerKill.status,201);
      const detectiveAction=await post(detectiveContext,`/api/games/${gameId}/actions`,{actionType:'investigate',targetUserId:mafia.user_id});assert.equal(detectiveAction.status,201);
      const prostituteAction=await post(prostituteContext,`/api/games/${gameId}/actions`,{actionType:'block',targetUserId:detective.user_id});assert.equal(prostituteAction.status,201);
      const nightEnd=await host.agent.get(`/api/games/${gameId}/state`);assert.equal(nightEnd.status,200);assert.equal(nightEnd.body.game.phase,'day');assert.equal(nightEnd.body.game.dayNumber,2);assert.ok(new Date(nightEnd.body.game.phaseEndsAt)>new Date(nightEnd.body.serverTime));
      const investigations=await sheriffContext.agent.get(`/api/games/${gameId}/investigations`);assert.equal(investigations.status,200);assert.equal(investigations.body.investigations[0].result,'mafia');
      const sheriffState=await sheriffContext.agent.get(`/api/games/${gameId}/state`);assert.equal(sheriffState.status,200);assert.ok(sheriffState.body.game.me.roleResults.some(r=>r.type==='investigation'&&r.result.result==='mafia'));
      const prostituteState=await prostituteContext.agent.get(`/api/games/${gameId}/state`);assert.equal(prostituteState.status,200);assert.ok(prostituteState.body.game.me.roleResults.some(r=>r.type==='block'&&r.result.executed&&r.result.blocked&&r.result.targetUserId===detective.user_id));
      await pool.execute('UPDATE games SET phase_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[gameId]);
      const dayTwoOpen=await post(host,`/api/games/${gameId}/advance-phase`);assert.equal(dayTwoOpen.status,200);assert.equal(dayTwoOpen.body.game.phase,'voting');assert.equal(dayTwoOpen.body.game.dayNumber,2);
      const dayTwoTarget=alive.find(p=>p.user_id!==host.user.id);assert.ok(dayTwoTarget);
      const dayTwoVote=await post(host,`/api/games/${gameId}/votes`,{targetUserId:dayTwoTarget.user_id});assert.equal(dayTwoVote.status,200);
      const changedDayTwoTarget=alive.find(p=>p.user_id!==host.user.id&&p.user_id!==dayTwoTarget.user_id);assert.ok(changedDayTwoTarget);const duplicateDayTwoVote=await post(host,`/api/games/${gameId}/votes`,{targetUserId:changedDayTwoTarget.user_id});assert.equal(duplicateDayTwoVote.status,409);assert.equal(duplicateDayTwoVote.body.error.code,'vote_locked');
      const dayTwoState=await host.agent.get(`/api/games/${gameId}/state`);assert.equal(dayTwoState.body.game.me.hasVoted,true);assert.equal(dayTwoState.body.game.me.voteTargetUserId,dayTwoTarget.user_id);
      await pool.execute('DELETE FROM votes WHERE game_id=? AND day_number=2',[gameId]);await pool.execute('UPDATE games SET phase_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[gameId]);
      const secondNight=await post(host,`/api/games/${gameId}/advance-phase`);assert.equal(secondNight.status,200);assert.equal(secondNight.body.game.phase,'night');assert.equal(secondNight.body.game.dayNumber,3);
      for(const actor of [mafiaContext,otherMafiaContext,sheriffContext,doctorContext,detectiveContext,prostituteContext]){const snapshot=await actor.agent.get(`/api/games/${gameId}/state`);assert.equal(snapshot.status,200);assert.equal(snapshot.body.game.me.actionSubmitted,false,`${actor.user.username} should be able to choose again on night 3`)}
      const [nightThreeRoster]=await pool.execute('SELECT user_id,role,team,player_status FROM game_players WHERE game_id=?',[gameId]);const nextPatient=nightThreeRoster.find(p=>p.team==='town'&&p.player_status==='alive'&&p.user_id!==doctor.user_id&&p.user_id!==protectedTarget.user_id);assert.ok(nextPatient,'Doctor has a different living target on the next night');
      assert.equal((await post(mafiaContext,`/api/games/${gameId}/actions`,{actionType:'mafia_kill',targetUserId:protectedTarget.user_id})).status,201);
      assert.equal((await post(otherMafiaContext,`/api/games/${gameId}/actions`,{actionType:'mafia_kill',targetUserId:protectedTarget.user_id})).status,201);
      assert.equal((await post(sheriffContext,`/api/games/${gameId}/actions`,{actionType:'investigate',targetUserId:mafia.user_id})).status,201);
      assert.equal((await post(doctorContext,`/api/games/${gameId}/actions`,{actionType:'protect',targetUserId:nextPatient.user_id})).status,201);
      assert.equal((await post(detectiveContext,`/api/games/${gameId}/actions`,{actionType:'investigate',targetUserId:mafia.user_id})).status,201);
      assert.equal((await post(prostituteContext,`/api/games/${gameId}/actions`,{actionType:'block',targetUserId:detective.user_id})).status,201);
      const afterSecondNight=await host.agent.get(`/api/games/${gameId}/state`);assert.equal(afterSecondNight.status,200);assert.equal(afterSecondNight.body.game.phase,'day');assert.equal(afterSecondNight.body.game.dayNumber,3);
      await pool.execute('UPDATE games SET current_phase="day",day_number=98,phase_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[gameId]);
      const lateGameVote=await post(host,`/api/games/${gameId}/advance-phase`);assert.equal(lateGameVote.status,200);assert.equal(lateGameVote.body.game.phase,'voting');assert.equal(lateGameVote.body.game.dayNumber,98);
      const eliminatedVote=await post(civilianContext,`/api/games/${gameId}/votes`,{targetUserId:host.user.id});assert.equal(eliminatedVote.status,403);
      const eliminatedChat=await civilianContext.agent.get(`/api/rooms/${roomId}/messages?channel=day`);assert.equal(eliminatedChat.status,403);
      await pool.execute('UPDATE games SET phase_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[gameId]);
      const noVotes=await post(host,`/api/games/${gameId}/advance-phase`);assert.equal(noVotes.status,200);assert.equal(noVotes.body.game.phase,'night');assert.equal(noVotes.body.game.dayNumber,99);assert.equal(noVotes.body.game.eliminatedUserId,null);
      await pool.execute('UPDATE games SET phase_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[gameId]);
      const day99=await post(host,`/api/games/${gameId}/advance-phase`);assert.equal(day99.status,200);assert.equal(day99.body.game.phase,'day');assert.equal(day99.body.game.dayNumber,99);assert.equal(day99.body.game.eliminatedUserId,null);
      await pool.execute('UPDATE games SET phase_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[gameId]);
      const day99Voting=await post(host,`/api/games/${gameId}/advance-phase`);assert.equal(day99Voting.status,200);assert.equal(day99Voting.body.game.phase,'voting');assert.equal(day99Voting.body.game.dayNumber,99);
      await pool.execute('UPDATE games SET phase_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[gameId]);
      const day99Night=await post(host,`/api/games/${gameId}/advance-phase`);assert.equal(day99Night.status,200);assert.equal(day99Night.body.game.phase,'night');assert.equal(day99Night.body.game.dayNumber,100);
      await pool.execute('UPDATE game_players SET player_status="eliminated" WHERE game_id=?',[gameId]);
      await pool.execute('UPDATE game_players SET player_status="alive" WHERE game_id=? AND user_id IN (?,?,?,?,?)',[gameId,mafia.user_id,otherMafia.user_id,doctor.user_id,protectedTarget.user_id,nextPatient.user_id]);
      const repeatedHeal=await post(doctorContext,`/api/games/${gameId}/actions`,{actionType:'protect',targetUserId:nextPatient.user_id});assert.equal(repeatedHeal.status,400);assert.equal(repeatedHeal.body.error.code,'consecutive_protection');
      const secondKill=await post(mafiaContext,`/api/games/${gameId}/actions`,{actionType:'mafia_kill',targetUserId:protectedTarget.user_id});assert.equal(secondKill.status,201);
      const partnerSecondKill=await post(otherMafiaContext,`/api/games/${gameId}/actions`,{actionType:'mafia_kill',targetUserId:protectedTarget.user_id});assert.equal(partnerSecondKill.status,201);
      await pool.execute('UPDATE games SET phase_ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[gameId]);
      const finalNight=await post(host,`/api/games/${gameId}/advance-phase`);assert.equal(finalNight.status,200);assert.equal(finalNight.body.game.phase,'completed');assert.equal(finalNight.body.game.winner,'mafia');
      const results=await host.agent.get(`/api/games/${gameId}/state`);assert.equal(results.status,200);assert.equal(results.body.game.status,'completed');assert.ok(results.body.game.players.every(p=>p.role));
    });
  } finally {
    const pool=getPool();
    await pool.execute('DELETE FROM rate_limit_buckets');
    const ids=users.map(u=>u.user.id),userPlaceholders=ids.map(()=>'?').join(',');
    if(rooms.length){const placeholders=rooms.map(()=>'?').join(',');const gameIds=`SELECT id FROM games WHERE room_id IN (${placeholders})`;await pool.execute(`DELETE FROM match_history WHERE game_id IN (${gameIds})`,rooms);await pool.execute(`DELETE FROM game_actions WHERE game_id IN (${gameIds})`,rooms);await pool.execute(`DELETE FROM game_verdict_votes WHERE game_id IN (${gameIds})`,rooms);await pool.execute(`DELETE FROM votes WHERE game_id IN (${gameIds})`,rooms);await pool.execute(`DELETE FROM game_role_results WHERE game_id IN (${gameIds})`,rooms);await pool.execute(`DELETE FROM game_players WHERE game_id IN (${gameIds})`,rooms);await pool.execute(`DELETE FROM chat_messages WHERE room_id IN (${placeholders})`,rooms);await pool.execute(`DELETE FROM games WHERE room_id IN (${placeholders})`,rooms);await pool.execute(`DELETE FROM rooms WHERE id IN (${placeholders})`,rooms)}
    if(ids.length){await pool.execute(`DELETE FROM game_actions WHERE actor_user_id IN (${userPlaceholders}) OR target_user_id IN (${userPlaceholders})`,[...ids,...ids]);await pool.execute(`DELETE FROM game_verdict_votes WHERE voter_user_id IN (${userPlaceholders}) OR accused_user_id IN (${userPlaceholders})`,[...ids,...ids]);await pool.execute(`DELETE FROM votes WHERE voter_user_id IN (${userPlaceholders}) OR target_user_id IN (${userPlaceholders})`,[...ids,...ids]);await pool.execute(`DELETE FROM game_role_results WHERE user_id IN (${userPlaceholders})`,ids);await pool.execute(`DELETE FROM match_history WHERE user_id IN (${userPlaceholders})`,ids);await pool.execute(`DELETE FROM game_players WHERE user_id IN (${userPlaceholders})`,ids);await pool.execute(`DELETE FROM chat_messages WHERE sender_user_id IN (${userPlaceholders})`,ids);await pool.execute(`DELETE FROM room_members WHERE user_id IN (${userPlaceholders})`,ids);await pool.execute(`DELETE FROM users WHERE id IN (${userPlaceholders})`,ids)}
    await pool.end();
  }
});
