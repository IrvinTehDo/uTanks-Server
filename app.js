const http = require('http');
const socketio = require('socket.io');
const fs = require('fs');
const xxh = require('xxhashjs');
const port = process.env.PORT || process.env.NODE_PORT || 55555;

const app = http.createServer();

app.listen(port);

const io = socketio(app);

const players = {};

io.on('connection', (sock) => {
    const socket = sock
    socket.player = {
      hash: xxh.h32(`${socket.id}${new Date().getTime()}`, 0xCAFEBABE).toString(16),
      lastUpdate: new Date().getTime(),
      roomName: 'lobby',
      someWord: 'string',
    };

    players[socket.player.hash] = socket.player;
    console.log(`new socket has joined with hash of ${socket.player.hash}`);
    socket.join('lobby');

    socket.on('getPlayerCount', () => {
      socket.emit('recievePlayerCount', Object.keys(players).length);
    });

    io.in('lobby').emit('recievePlayerCount', Object.keys(players).length);

    socket.on('disconnect', () => {
      socket.leave('lobby');
      delete players[socket.player.hash];
      io.in('lobby').emit('recievePlayerCount', Object.keys(players).length);
    });
});

console.log(`Listening on port: ${port}`);
