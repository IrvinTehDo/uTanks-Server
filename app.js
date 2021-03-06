const http = require('http');
const socketio = require('socket.io');
const fs = require('fs');
const xxh = require('xxhashjs');

const port = process.env.PORT || process.env.NODE_PORT || 3000;

const rooms = {};
const queue = [];

const roomTimerFuncs = {};

rooms.lobby = {
  roomName: 'lobby',
  players: {},
};

const handler = (req, res) => {
  fs.readFile(`${__dirname}/index.html`, (err, data) => {
    if (err) {
      throw err;
    }
    res.writeHead(200);
    res.end(data);
  });
};

const app = http.createServer(handler);

app.listen(port);

const io = socketio(app);

const roomInit = (roomName, socket) => {
  if (rooms[roomName]) {
    socket.emit('error', `${roomName} already exists!`);
    return false;
  }

  rooms[roomName] = {
    roomName,
    status: 'waiting',
    time: 30,
    players: {},
  };

  roomTimerFuncs[roomName] = setInterval(() => {
    rooms[roomName].time -= 1;
    const curRoomStatus = rooms[roomName].status;
    io.in(roomName).emit('updateTime', rooms[roomName].time, curRoomStatus);
    if (rooms[roomName].time === 0 && curRoomStatus === 'waiting') {
      rooms[roomName].status = 'playing';
      rooms[roomName].time = 60;
    } else if (rooms[roomName].time === 0 && curRoomStatus === 'playing') {
      io.in(roomName).emit('endGame');
      clearInterval(roomTimerFuncs[roomName]);
    }
  }, 1000);

  console.log(`Room ${roomName} created`);
  return true;
};

const roomJoin = (roomName, socket) => {
  if (!rooms[roomName]) {
    socket.emit('error', `${roomName} does not exist`);
    return false;
  }

  socket.leave(socket.roomJoined);
  socket.join(roomName);
  rooms[roomName].players[socket.hash] = socket.player;
  return true;
};

const hashesInQueue = () => {
  const tempQueueHashes = [];

  for (let i = 0; i < queue.length; i++) {
    tempQueueHashes.push(queue[i].hash);
  }

  return tempQueueHashes;
};

const addToQueue = (socket) => {
  queue.push(socket);
  io.sockets.in('lobby').emit('updateQueue', hashesInQueue());
};

const processQueue = () => {
  const roomKeys = Object.keys(rooms);

  if (queue.length <= 3) {
    for (let i = 0; i < roomKeys.length; i++) {
      const playerKey = Object.keys(rooms[roomKeys[i]].players);
      if (playerKey.length <= 7 && rooms[roomKeys[i]].roomName !== 'lobby' && queue.length > 0) {
        queue[0].emit('requestToJoin', rooms[roomKeys[i]].roomName);
        queue.splice(0);
        io.sockets.in('lobby').emit('updateQueue', hashesInQueue());
        break;
      }
    }
  } else if (queue.length > 3) {
    let time = new Date().getTime();
    let hash = xxh.h32(`${time}`, 0x010A020B).toString(16).substr(0, 4);

    while (rooms[hash]) {
      time = new Date().getTime();
      hash = xxh.h32(`${time}`, 0x010A020B).toString(16).substr(0, 4);
    }

    roomInit(hash, queue[0]);

    queue[0].emit('requestToJoin', rooms[hash].roomName);
    queue[1].emit('requestToJoin', rooms[hash].roomName);
    queue[2].emit('requestToJoin', rooms[hash].roomName);
    queue[3].emit('requestToJoin', rooms[hash].roomName);

    queue.splice(0, 4);

    io.sockets.in('lobby').emit('updateQueue', hashesInQueue());
  }
};

io.on('connection', (sock) => {
  const socket = sock;

  const time = new Date().getTime();
  const hash = xxh.h32(`${socket.id}${time}`, 0xCAFEBABE).toString(16);

  socket.hash = hash;

  socket.player = {
    lastUpdate: new Date().getTime(),
    x: 0,
    y: 0,
    directionX: 0,
    directionY: 0,
    heigth: 100,
    width: 100,
    isAlive: false,
  };
  socket.join('lobby');
  socket.roomJoined = 'lobby';
  console.log(`new socket has joined with hash of ${socket.hash}`);
  rooms.lobby.players[socket.hash] = socket.player;
  socket.emit('joined', socket.player, rooms.lobby, socket.hash);
  io.in('lobby').emit('recievePlayerCount', Object.keys(rooms.lobby.players).length);

  socket.on('getPlayerCount', () => {
    socket.emit('recievePlayerCount', Object.keys(rooms.lobby.players).length);
  });

  socket.on('createRoom', (roomName) => {
    if (roomInit(roomName, socket)) {
      if (roomJoin(roomName, socket)) {
        if (socket.roomJoined === 'lobby') {
          delete rooms.lobby.players[socket.hash];
        } else {
          delete rooms[socket.roomJoined].players[socket.hash];
        }
        socket.roomJoined = roomName;
        socket.emit('joined', roomName);
      }
    }
  });

  socket.on('joinRoom', (roomName) => {
    if (roomJoin(roomName, socket, io)) {
      if (socket.roomJoined === 'lobby') {
        delete rooms.lobby.players[socket.hash];
      } else {
        delete rooms[socket.roomJoined].players[socket.hash];
      }
      socket.roomJoined = roomName;

      socket.emit('joined', roomName);
    }
  });

  socket.on('moveToLobby', (roomName) => {
    delete rooms[roomName].players[socket.hash];
    socket.player.roomName = 'lobby';
    rooms.lobby.players[socket.hash] = socket.player;

    socket.join('lobby');
    socket.roomJoined = 'lobby';

    const playerKeys = Object.keys(rooms[roomName].players);
    if (playerKeys.length === 0) {
      delete rooms[roomName];
    }
  });

  socket.on('movementUpdate', (data) => {
    //    console.dir(data);
    socket.player.x = data.x;
    socket.player.y = data.y;
    socket.player.directionX = data.directionX;
    socket.player.directionY = data.directionY;
    //    socket.player = data;
    //    socket.player.lastUpdate = new Date().getTime();
    //
    //    if (!socket.player || !socket.player.alive) {
    //      return;
    //    }
    //
    //    socket.broadcast.to(socket.player.roomName).emit('updatedMovement', socket.player);
    socket.broadcast.to('lobby').emit('updatedMovement', socket.hash, socket.player.x, socket.player.y, socket.player.directionX, socket.player.directionY);
  });

  socket.on('makeBullet', (data) => {
    console.dir(data);
    socket.broadcast.to('lobby').emit('recieveBullet', data.x, data.y, data.facingAngle, data.directionX, data.directionY);
  });

  socket.on('joinQueue', () => {
    addToQueue(socket, io);
  });
  
  socket.on('playerHit', (data) => {
    socket.emit('movePlayer', data.x, data.y);
  });

  socket.on('disconnect', () => {
    socket.leave(socket.roomJoined);
    delete rooms[socket.roomJoined].players[socket.player.hash];
    io.in('lobby').emit('recievePlayerCount', Object.keys(rooms.lobby.players).length);
  });
});

const update = () => {
  processQueue(io);

  setTimeout(update, 20);
};

// update();

console.log(`Listening on port: ${port}`);
