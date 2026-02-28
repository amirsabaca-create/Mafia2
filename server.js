const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Хранилище игр
const games = {};

// Функция генерации ID комнаты
function generateGameId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Распределение ролей для 6 игроков (пример)
function assignRoles(players) {
  const roles = [];
  const count = players.length;
  // Простая схема: 2 мафии, 1 шериф, остальные мирные
  for (let i = 0; i < count; i++) {
    if (i < 2) roles.push('mafia');
    else if (i === 2) roles.push('sheriff');
    else roles.push('civilian');
  }
  // Перемешиваем
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return players.map((p, idx) => ({ ...p, role: roles[idx], alive: true }));
}

io.on('connection', (socket) => {
  console.log('Игрок подключился:', socket.id);

  socket.on('createGame', ({ playerName }) => {
    const gameId = generateGameId();
    games[gameId] = {
      players: [{ id: socket.id, name: playerName, ready: false }],
      phase: 'lobby',
      nightActions: {},
      votes: {},
      dayVotes: {},
      result: null,
      winner: null
    };
    socket.join(gameId);
    socket.emit('gameCreated', { gameId, players: games[gameId].players });
    console.log(`Игра ${gameId} создана`);
  });

  socket.on('joinGame', ({ gameId, playerName }) => {
    const game = games[gameId];
    if (!game) return socket.emit('error', 'Игра не найдена');
    if (game.players.length >= 6) return socket.emit('error', 'Комната заполнена');
    game.players.push({ id: socket.id, name: playerName, ready: false });
    socket.join(gameId);
    io.to(gameId).emit('playersUpdated', game.players);
  });

  socket.on('startGame', (gameId) => {
    const game = games[gameId];
    if (!game) return;
    if (game.players.length < 4) return; // минимум 4 игрока
    game.players = assignRoles(game.players);
    game.phase = 'night';
    game.nightActions = {};
    game.dayVotes = {};
    game.winner = null;
    io.to(gameId).emit('gameStarted', { players: game.players, phase: game.phase });
    // Отправить каждому игроку его роль лично
    game.players.forEach(p => {
      io.to(p.id).emit('yourRole', { role: p.role });
    });
  });

  socket.on('nightAction', ({ gameId, targetId }) => {
    const game = games[gameId];
    if (!game || game.phase !== 'night') return;
    const player = game.players.find(p => p.id === socket.id);
    if (!player || !player.alive) return;
    // Записываем действие
    if (player.role === 'mafia') {
      if (!game.nightActions.mafia) game.nightActions.mafia = [];
      game.nightActions.mafia.push(targetId);
    } else if (player.role === 'sheriff') {
      game.nightActions.sheriff = targetId;
    }
    // Проверяем, все ли мафиози проголосовали
    const mafiaPlayers = game.players.filter(p => p.role === 'mafia' && p.alive);
    const mafiaVotes = game.nightActions.mafia || [];
    if (mafiaPlayers.length === mafiaVotes.length) {
      // Все мафии сделали выбор — определяем убитого
      const voteCounts = {};
      mafiaVotes.forEach(id => voteCounts[id] = (voteCounts[id] || 0) + 1);
      let maxVotes = 0;
      let killedId = null;
      for (const [id, count] of Object.entries(voteCounts)) {
        if (count > maxVotes) {
          maxVotes = count;
          killedId = id;
        }
      }
      game.nightActions.killed = killedId;
    }
    // Если шериф сделал проверку, тоже сохраняем результат (отправим позже)
    if (game.nightActions.sheriff && (mafiaPlayers.length === mafiaVotes.length || mafiaPlayers.length === 0)) {
      // Все действия завершены
      resolveNight(game, gameId);
    }
  });

  function resolveNight(game, gameId) {
    const killedId = game.nightActions.killed;
    if (killedId) {
      const killedPlayer = game.players.find(p => p.id === killedId);
      if (killedPlayer) killedPlayer.alive = false;
    }
    // Отправить шерифу результат проверки
    if (game.nightActions.sheriff) {
      const target = game.players.find(p => p.id === game.nightActions.sheriff);
      const isMafia = target?.role === 'mafia';
      const sheriff = game.players.find(p => p.role === 'sheriff' && p.alive);
      if (sheriff) {
        io.to(sheriff.id).emit('sheriffResult', { targetId: target.id, isMafia });
      }
    }
    // Проверить победу
    const winner = checkWinner(game.players);
    if (winner) {
      game.phase = 'ended';
      game.winner = winner;
      io.to(gameId).emit('gameOver', { winner, players: game.players });
    } else {
      game.phase = 'day';
      game.dayVotes = {};
      io.to(gameId).emit('phaseChanged', { phase: 'day', players: game.players });
    }
    game.nightActions = {};
  }

  socket.on('dayVote', ({ gameId, targetId }) => {
    const game = games[gameId];
    if (!game || game.phase !== 'day') return;
    const player = game.players.find(p => p.id === socket.id);
    if (!player || !player.alive) return;
    game.dayVotes[socket.id] = targetId;
    // Проверить, все ли живые проголосовали
    const alivePlayers = game.players.filter(p => p.alive);
    if (Object.keys(game.dayVotes).length === alivePlayers.length) {
      // Подсчёт голосов
      const votes = {};
      Object.values(game.dayVotes).forEach(id => votes[id] = (votes[id] || 0) + 1);
      let maxVotes = 0;
      let eliminatedId = null;
      for (const [id, count] of Object.entries(votes)) {
        if (count > maxVotes) {
          maxVotes = count;
          eliminatedId = id;
        }
      }
      if (eliminatedId) {
        const eliminated = game.players.find(p => p.id === eliminatedId);
        if (eliminated) eliminated.alive = false;
      }
      // Проверить победу
      const winner = checkWinner(game.players);
      if (winner) {
        game.phase = 'ended';
        game.winner = winner;
        io.to(gameId).emit('gameOver', { winner, players: game.players });
      } else {
        game.phase = 'night';
        game.nightActions = {};
        io.to(gameId).emit('phaseChanged', { phase: 'night', players: game.players });
      }
    }
  });

  function checkWinner(players) {
    const alive = players.filter(p => p.alive);
    const mafiaAlive = alive.filter(p => p.role === 'mafia').length;
    const civiliansAlive = alive.filter(p => p.role !== 'mafia').length;
    if (mafiaAlive === 0) return 'civilians';
    if (mafiaAlive >= civiliansAlive) return 'mafia';
    return null;
  }

  socket.on('disconnect', () => {
    // Удаляем игрока из игр (упрощённо)
    for (const gameId in games) {
      const game = games[gameId];
      const index = game.players.findIndex(p => p.id === socket.id);
      if (index !== -1) {
        game.players.splice(index, 1);
        io.to(gameId).emit('playersUpdated', game.players);
        break;
      }
    }
  });
});

server.listen(3000, () => console.log('Сервер запущен на порту 3000'));
