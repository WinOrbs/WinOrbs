const fs = require('fs');
const serverCode = fs.readFileSync('server.js', 'utf8');
const gameCode = fs.readFileSync('public/game.html', 'utf8');

console.log('=== SERVER DEBUG ===');
console.log('startLobby method:', serverCode.includes('startLobby()'));
console.log('startGame method:', serverCode.includes('startGame()'));
console.log('Auto-start in update loop:', serverCode.includes("Object.keys(this.players).length >= 2 && !this.gameStarted"));
console.log("Emite gameStarted event:", serverCode.includes("'gameStarted'"));

console.log('\n=== GAME.HTML DEBUG ===');
console.log('gameStarted event listener:', gameCode.includes("socket.on('gameStarted'"));

console.log('\n=== ISSUE: Auto-start was removed but game never starts without admin ===');
