import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { getPool, transaction } from './db.js';

if(process.env.NODE_ENV==='production')throw new Error('Seed script refuses to run in production.');
if(!process.env.SEED_USERS_JSON)throw new Error('Set SEED_USERS_JSON to a JSON array of at least six test accounts.');
const users=JSON.parse(process.env.SEED_USERS_JSON);
if(!Array.isArray(users)||users.length<6||users.length>12||users.some(u=>!u.username||!u.email||!u.password))throw new Error('Provide between 6 and 12 users with username, email, and password fields.');
const pool=getPool();
try{
  await transaction(async conn=>{
    const ids=[];
    for(const u of users){
      const [existing]=await conn.execute('SELECT id FROM users WHERE email=? OR username=? LIMIT 1',[u.email.toLowerCase(),u.username]);
      if(existing.length){ids.push(existing[0].id);continue;}
      const userId=randomUUID(),passwordHash=await argon2.hash(u.password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
      await conn.execute('INSERT INTO users (id,username,email,password_hash) VALUES (?,?,?,?)',[userId,u.username,u.email.toLowerCase(),passwordHash]);ids.push(userId);
    }
    const [found]=await conn.execute(`SELECT id FROM users WHERE id IN (${ids.map(()=>'?').join(',')})`,ids);if(found.length<6||new Set(ids).size<6)throw new Error('Seed accounts must be distinct.');
    const roomId=randomUUID(),roomCode=randomBytes(12).toString('hex').toUpperCase();
    await conn.execute('INSERT INTO rooms (id,room_code,name,host_user_id,visibility,game_mode,language,max_players,settings_json) VALUES (?,?,?, ?,"public","classic","EN",?,?)',[roomId,roomCode,'Seed Table',ids[0],Math.min(12,users.length),JSON.stringify({allowAbstain:false,revealVotes:false,chatDuringVoting:false,daySeconds:60,nightSeconds:60})]);
    for(const userId of ids)await conn.execute('INSERT INTO room_members (id,room_id,user_id,is_ready) VALUES (?,?,?,TRUE)',[randomUUID(),roomId,userId]);
    console.log(`Created seed room ${roomCode} for ${found.length} configured accounts.`);
  });
}finally{await pool.end();}
