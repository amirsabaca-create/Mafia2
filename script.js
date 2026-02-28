const socket = io();

let currentGameId = null;
let myId = null;
let myRole = null;
let players = [];
let currentPhase = 'lobby';

// Элементы DOM
const lobbyScreen = document.getElementById('lobby');
const roomScreen = document.getElementById('room');
const gameScreen = document.getElementById('game');
const roomCodeSpan = document.getElementById('roomCode');
const playerCountSpan = document.getElementById('playerCount');
const playersListDiv = document.getElementById('playersList');
const gamePlayersDiv = document.getElementById('gamePlayers');
const actionLog = document.getElementById('actionLog');
const phaseIcon = document.getElementById('phaseIcon');
const voteMessage = document.getElementById('voteMessage');
const startGameBtn = document.getElementById('startGameBtn');

// Имя игрока
let playerName = '';

document.getElementById('createGame').addEventListener('click', () => {
  playerName = document.getElementById('playerName').value.trim();
  if (!playerName) return alert('Введите имя');
  socket.emit('createGame', { playerName });
});

document.getElementById('joinGame').addEventListener('click', () => {
  document.getElementById('gameIdInput').style.display = 'block';
});

document.getElementById('submitJoin').addEventListener('click', () => {
  const gameId = document.getElementById('gameId').value.trim().toUpperCase();
  playerName = document.getElementById('playerName').value.trim();
  if (!gameId || !playerName) return alert('Введите код и имя');
  socket.emit('joinGame', { gameId, playerName });
});

startGameBtn.addEventListener('click', () => {
  socket.emit('startGame', currentGameId);
});

// Сокет-обработчики
socket.on('gameCreated', ({ gameId, players }) => {
  currentGameId = gameId;
  playersListDiv.innerHTML = players.map(p => `<div class="player-badge">${p.name}</div>`).join('');
  playerCountSpan.innerText = players.length;
  roomCodeSpan.innerText = gameId;
  lobbyScreen.style.display = 'none';
  roomScreen.style.display = 'block';
  if (players[0]?.id === socket.id) {
    startGameBtn.style.display = 'block';
  }
});

socket.on('playersUpdated', (updatedPlayers) => {
  players = updatedPlayers;
  playersListDiv.innerHTML = players.map(p => `<div class="player-badge">${p.name}</div>`).join('');
  playerCountSpan.innerText = players.length;
});

socket.on('gameStarted', ({ players: gamePlayers, phase }) => {
  players = gamePlayers;
  currentPhase = phase;
  roomScreen.style.display = 'none';
  gameScreen.style.display = 'block';
  renderGameBoard();
  actionLog.innerText = phase === 'night' ? '🌙 Ночь. Мафия выбирает жертву.' : '☀️ День. Голосуйте!';
});

socket.on('yourRole', ({ role }) => {
  myRole = role;
  let roleName = '';
  if (role === 'mafia') roleName = 'Мафия';
  else if (role === 'sheriff') roleName = 'Шериф';
  else roleName = 'Мирный';
  alert(`Твоя роль: ${roleName}`);
});

socket.on('phaseChanged', ({ phase, players: updatedPlayers }) => {
  players = updatedPlayers;
  currentPhase = phase;
  phaseIcon.innerText = phase === 'night' ? '🌙' : '☀️';
  renderGameBoard();
  actionLog.innerText = phase === 'night' ? '🌙 Ночь. Действуй.' : '☀️ День. Выбери игрока для голосования.';
  voteMessage.innerText = '';
});

socket.on('sheriffResult', ({ targetId, isMafia }) => {
  const target = players.find(p => p.id === targetId);
  if (target) {
    alert(`Шериф: ${target.name} — ${isMafia ? 'МАФИЯ' : 'НЕ МАФИЯ'}`);
  }
});

socket.on('gameOver', ({ winner, players: updatedPlayers }) => {
  players = updatedPlayers;
  currentPhase = 'ended';
  renderGameBoard();
  actionLog.innerText = winner === 'mafia' ? '🔴 Победила МАФИЯ!' : '🔵 Победили МИРНЫЕ!';
});

// Рендер игрового поля
function renderGameBoard() {
  gamePlayersDiv.innerHTML = '';
  players.forEach(p => {
    const card = document.createElement('div');
    card.className = `player-card ${p.alive ? '' : 'dead'}`;
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="avatar">${p.name.charAt(0)}</div>
      <div class="name">${p.name}</div>
    `;
    card.addEventListener('click', () => {
      if (!p.alive) return;
      if (currentPhase === 'night') {
        if (myRole === 'mafia' && p.role !== 'mafia') {
          socket.emit('nightAction', { gameId: currentGameId, targetId: p.id });
          actionLog.innerText = `Вы выбрали ${p.name}`;
        } else if (myRole === 'sheriff') {
          socket.emit('nightAction', { gameId: currentGameId, targetId: p.id });
          actionLog.innerText = `Проверка ${p.name}...`;
        } else {
          actionLog.innerText = 'Ночью ты ничего не можешь сделать.';
        }
      } else if (currentPhase === 'day') {
        socket.emit('dayVote', { gameId: currentGameId, targetId: p.id });
        voteMessage.innerText = `Вы проголосовали против ${p.name}`;
      }
    });
    gamePlayersDiv.appendChild(card);
  });
}

// Свайпы для смены фазы (только для наглядности, сервер сам меняет)
let touchStartX = 0;
gameScreen.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
});
gameScreen.addEventListener('touchend', (e) => {
  if (!touchStartX) return;
  const diff = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(diff) > 70) {
    // имитация смены фазы (для теста, сервер игнорирует)
    // В реальной игре фазу меняет сервер, но здесь можно оставить для UI
  }
  touchStartX = 0;
});

// Обработка ошибок
socket.on('error', (msg) => alert(msg));
