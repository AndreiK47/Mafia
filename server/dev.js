import 'dotenv/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import app, { advanceExpiredGames, deleteInactiveWaitingRooms } from './app.js';
import express from 'express';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
app.use('/css',express.static(resolve(root,'css'),{dotfiles:'deny',index:false}));
app.use('/js',express.static(resolve(root,'js'),{dotfiles:'deny',index:false}));
app.use('/images',express.static(resolve(root,'images'),{dotfiles:'deny',index:false}));
app.use('/sounds',express.static(resolve(root,'MAFIA_Sound_Pack'),{dotfiles:'deny',index:false}));
app.get(['/','/rooms','/create-room','/profile','/history','/settings','/how-to-play','/login','/demo','/room/:roomId','/game/:gameId/:phase'],(req,res)=>res.sendFile(resolve(root,'index.html')));
const port=Number(process.env.PORT)||3000;
app.listen(port,()=>console.log(`MAFIA local server listening on http://localhost:${port}`));
const cleanupIdleRooms=()=>deleteInactiveWaitingRooms().catch(error=>console.error('inactive_room_cleanup_failed',error.code||'database_error'));
const cleanupTimer=setInterval(cleanupIdleRooms,60_000);cleanupTimer.unref();cleanupIdleRooms();
const phaseTimer=setInterval(()=>advanceExpiredGames().catch(error=>console.error('phase_reconcile_failed',error.code||'database_error')),1_000);phaseTimer.unref();
