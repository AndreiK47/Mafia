let csrfToken=null;
let currentUser=null;
export class ApiError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
export async function request(path,{method='GET',body,headers={}}={}){
  const csrfCookie=document.cookie.split('; ').find(x=>x.startsWith('mafia_csrf='))?.slice('mafia_csrf='.length);
  const token=csrfToken||decodeURIComponent(csrfCookie||'');
  const response=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...(['GET','HEAD'].includes(method)?{}:{'X-CSRF-Token':token}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  let data={};try{data=await response.json()}catch{}
  if(!response.ok)throw new ApiError(response.status,data.error?.code||'request_failed',data.error?.message||'Request failed.');
  if(data.csrfToken)csrfToken=data.csrfToken;
  return data;
}
export async function checkSession(){try{const data=await request('/auth/me');currentUser=data.user;csrfToken=data.csrfToken;return currentUser}catch(error){if(error.status===401){currentUser=null;csrfToken=null;return null}throw error}}
export async function register(details){const data=await request('/auth/register',{method:'POST',body:details});currentUser=data.user;csrfToken=data.csrfToken;return currentUser}
export async function login(details){const data=await request('/auth/login',{method:'POST',body:details});currentUser=data.user;csrfToken=data.csrfToken;return currentUser}
export async function logout(){await request('/auth/logout',{method:'POST',body:{}});currentUser=null;csrfToken=null}
export const getCurrentUser=()=>currentUser;
export const getRooms=filters=>request(`/rooms?${new URLSearchParams(filters)}`);
export const getRoom=id=>request(`/rooms/${encodeURIComponent(id)}`);
export const findRoomByCode=code=>request(`/rooms/code/${encodeURIComponent(code)}`);
export const createRoom=(details,idempotencyKey)=>request('/rooms',{method:'POST',body:details,headers:idempotencyKey?{'Idempotency-Key':idempotencyKey}:{}});
export const joinRoom=(id,password)=>request(`/rooms/${encodeURIComponent(id)}/join`,{method:'POST',body:{password}});
export const setReady=(id,ready)=>request(`/rooms/${encodeURIComponent(id)}/ready`,{method:'POST',body:{ready}});
export const setRoomBots=(id,playerCount)=>request(`/rooms/${encodeURIComponent(id)}/bots`,{method:'POST',body:{playerCount}});
export const startGame=id=>request(`/rooms/${encodeURIComponent(id)}/start`,{method:'POST',body:{}});
export const leaveRoom=id=>request(`/rooms/${encodeURIComponent(id)}/leave`,{method:'POST',body:{}});
export const getGame=id=>{const cursor=sessionStorage.getItem(`mafia-event-cursor:${id}`),query=cursor?`?afterEventSequence=${encodeURIComponent(cursor)}`:'';return request(`/games/${encodeURIComponent(id)}/state${query}`)};
export const getRole=id=>request(`/games/${encodeURIComponent(id)}/role`);
export const nightAction=(id,actionType,targetUserId)=>request(`/games/${encodeURIComponent(id)}/actions`,{method:'POST',body:{actionType,targetUserId},headers:{'Idempotency-Key':`${id}:night:${currentUser?.id}:${Date.now()}`}});
export const submitVote=(id,targetUserId)=>request(`/games/${encodeURIComponent(id)}/votes`,{method:'POST',body:{targetUserId}});
export const submitVerdict=(id,convict)=>request(`/games/${encodeURIComponent(id)}/verdict`,{method:'POST',body:{convict}});
export const advancePhase=id=>request(`/games/${encodeURIComponent(id)}/advance-phase`,{method:'POST',body:{}});
export const getHistory=()=>request('/history');
export const updateProfile=details=>request('/users/me',{method:'PATCH',body:details});
export const getMessages=(roomId,channel='room')=>request(`/rooms/${encodeURIComponent(roomId)}/messages?channel=${channel}`);
export const sendMessage=(roomId,message,channel='room',idempotencyKey)=>request(`/rooms/${encodeURIComponent(roomId)}/messages`,{method:'POST',body:{message,channel},headers:idempotencyKey?{'Idempotency-Key':idempotencyKey}:{}});
