const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const os = require('os'); // To get local IP

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public')); // Serve static files like HTML/CSS/JS

// Player data (350 players, randomized order, with base prices)
const players = [];
for (let i = 1; i <= 350; i++) {
  players.push({
    id: i,
    name: `Player ${i}`,
    bio: `Short bio for Player ${i}: Age 25, Position Forward, etc.`,
    image: `images/player${i}.jpg`,
    basePrice: 5000,
    currentBid: 5000,
    soldTo: null,
    status: 'upcoming' // upcoming, active, sold, unsold
  });
}
// Shuffle players randomly
players.sort(() => Math.random() - 0.5);

// Houses data
const houses = {
  house1: { id: 'house1', password: 'pass1', purse: 250000, remaining: 250000, boughtPlayers: [] },
  house2: { id: 'house2', password: 'pass2', purse: 250000, remaining: 250000, boughtPlayers: [] },
  house3: { id: 'house3', password: 'pass3', purse: 250000, remaining: 250000, boughtPlayers: [] },
  house4: { id: 'house4', password: 'pass4', purse: 250000, remaining: 250000, boughtPlayers: [] }
};
const admin = { id: 'admin', password: 'adminpass' };

// Current auction state
let currentPlayerIndex = 0;
let currentPlayer = players[currentPlayerIndex];
let timer = 30; // Initial 30 sec
let lockTimer = 0; // 3 sec lock after bid
let lastBidder = null;
let interval;
let auctionStarted = false; // Track if auction has started

io.on('connection', (socket) => {
  // Login
  socket.on('login', (data) => {
    if (houses[data.id] && houses[data.id].password === data.password) {
      socket.houseId = data.id;
      socket.emit('loginSuccess', { house: houses[data.id], currentPlayer });
      // If auction is running, send live update
      if (auctionStarted) {
        socket.emit('auctionUpdate', { currentPlayer, timer, lockTimer });
      }
    } else if (data.id === 'admin' && data.password === admin.password) {
      socket.admin = true;
      socket.emit('adminLoginSuccess', { players });
    } else {
      socket.emit('loginFail');
    }
  });

  // Start auction (admin only)
  socket.on('startAuction', () => {
    if (socket.admin) {
      auctionStarted = true;
      startTimer();
      io.emit('auctionStart', currentPlayer);
    }
  });

  // Place bid
  socket.on('placeBid', () => {
    if (!socket.houseId || lockTimer > 0 || houses[socket.houseId].remaining < currentPlayer.currentBid) return;
    const increment = getIncrement(currentPlayer.currentBid);
    currentPlayer.currentBid += increment;
    houses[socket.houseId].remaining -= increment;
    lastBidder = socket.houseId;
    lockTimer = 3;
    timer = 15;
    io.emit('bidPlaced', { player: currentPlayer, bidder: socket.houseId, lockTimer });
    // Real-time update for remaining amount
    io.to(socket.houseId).emit('updateRemaining', houses[socket.houseId].remaining);
  });

  // Timer logic
  function startTimer() {
    interval = setInterval(() => {
      if (lockTimer > 0) {
        lockTimer--;
        io.emit('lockUpdate', lockTimer);
      } else {
        timer--;
        io.emit('timerUpdate', timer);
        if (timer <= 0) {
          if (lastBidder) {
            currentPlayer.soldTo = lastBidder;
            currentPlayer.status = 'sold';
            houses[lastBidder].boughtPlayers.push({ ...currentPlayer, spent: currentPlayer.currentBid });
            notifyBought(lastBidder); // Notify the buying house to update their list
          } else {
            currentPlayer.status = 'unsold';
          }
          nextPlayer();
        }
      }
    }, 1000);
  }

  function nextPlayer() {
    currentPlayerIndex++;
    if (currentPlayerIndex < players.length) {
      currentPlayer = players[currentPlayerIndex];
      timer = 30;
      lockTimer = 0;
      lastBidder = null;
      io.emit('nextPlayer', currentPlayer);
    } else {
      io.emit('auctionEnd');
      clearInterval(interval);
      auctionStarted = false; // Reset when auction ends
    }
  }

  function notifyBought(houseId) {
    io.to(houseId).emit('playerBought', { houseId, boughtPlayers: houses[houseId].boughtPlayers });
  }

  function getIncrement(price) {
    if (price < 20000) return 1000;
    if (price < 50000) return 5000;
    return 10000;
  }
});

// Improved local IP detection (prioritizes local network IPs, skips VPNs)
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const ip = iface.address;
        // Prioritize common local subnets (192.168.x.x, 10.0.x.x), skip VPN-like IPs (e.g., 10.2.x.x from ProtonVPN)
        if (ip.startsWith('192.168.') || ip.startsWith('10.0.') || ip.startsWith('172.')) {
          return ip;
        }
      }
    }
  }
  return 'localhost'; // Fallback
}

server.listen(8080, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`Server running on http://${localIP}:8080`);
  console.log('Access from other devices on the same network using this URL.');
});