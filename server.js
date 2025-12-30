const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// === ПАМЯТЬ (для демо) ===
let users = [];
let messages = {}; // chatId → [messages]
let userChats = {}; // userId → [chatId]

const JWT_SECRET = 'fave-messenger-secret-key-2025';

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
const getChatInfo = (chatId, userId) => {
  const [id1, id2] = chatId.split('-');
  if (id1 && id2 && id1 !== id2) {
    const other = users.find(u => u.id === (id1 === userId ? id2 : id1));
    return {
      id: chatId,
      type: 'dm',
      name: other?.username || 'Неизвестно',
      avatar: other?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(other?.username || '?')}&background=9c88ff&color=fff&size=100`,
      lastMessage: messages[chatId]?.slice(-1)[0]?.text || 'Нет сообщений'
    };
  } else {
    const meta = messages[chatId]?.find(m => m.type === 'meta');
    return {
      id: chatId,
      type: meta?.chatType || 'group',
      name: meta?.name || 'Без названия',
      avatar: meta?.avatar || 'https://via.placeholder.com/100/6a4c93/fff?text=G',
      lastMessage: messages[chatId]?.filter(m => !m.type).slice(-1)[0]?.text || 'Нет сообщений'
    };
  }
};

// === API ===

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: 'Логин ≥3, пароль ≥6' });
  }
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Пользователь существует' });
  }
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=6a4c93&color=fff&size=100`;
  const user = { id: uuidv4(), username, passwordHash, avatar };
  users.push(user);
  userChats[user.id] = [];
  res.status(201).json({ message: 'OK' });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Неверный логин/пароль' });
  }
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username, avatar: user.avatar });
});

app.get('/api/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  const results = users
    .filter(u => u.username.toLowerCase().includes(q.toLowerCase()))
    .map(u => ({ id: u.id, username: u.username, avatar: u.avatar }));
  res.json(results);
});

app.get('/api/chats', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Нет токена' });
  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.id;
    const chatList = (userChats[userId] || []).map(cid => getChatInfo(cid, userId));
    res.json(chatList);
  } catch (e) {
    res.status(401).json({ error: 'Неверный токен' });
  }
});

app.post('/api/chat/create', (req, res) => {
  const { type, name, participants, creatorId } = req.body;
  if (!['dm', 'group', 'channel'].includes(type)) {
    return res.status(400).json({ error: 'Неверный тип' });
  }
  let chatId = type === 'dm' && participants.length === 2
    ? participants.sort().join('-')
    : uuidv4();
  if (!messages[chatId]) messages[chatId] = [];
  if (type !== 'dm') {
    messages[chatId].push({
      type: 'meta',
      chatType: type,
      name,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6a4c93&color=fff&size=100`,
      creatorId
    });
  }
  participants.forEach(uid => {
    userChats[uid] = userChats[uid] || [];
    if (!userChats[uid].includes(chatId)) userChats[uid].push(chatId);
  });
  res.json({ id: chatId, ...getChatInfo(chatId, creatorId) });
});

// === SOCKET.IO ===

const sockets = {}; // userId → socketId

io.on('connection', (socket) => {
  console.log('🔌 Новое соединение');

  socket.on('auth', (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = users.find(u => u.id === decoded.id);
      if (!user) throw new Error();
      sockets[user.id] = socket.id;
      socket.join(user.id);
      socket.emit('auth_success', { username: user.username });
    } catch {
      socket.emit('auth_error', { error: 'Invalid token' });
    }
  });

  socket.on('send_message', ({ chatId, text, fromUserId }) => {
    const msg = { id: uuidv4(), chatId, senderId: fromUserId, text, timestamp: new Date().toISOString() };
    messages[chatId] = messages[chatId] || [];
    messages[chatId].push(msg);
    const chat = userChats[fromUserId]?.find(cid => cid === chatId);
    if (chat) {
      // Отправляем всем участникам
      const [id1, id2] = chatId.split('-');
      const recipients = id1 && id2 ? [id1, id2] : Object.keys(userChats).filter(uid => userChats[uid].includes(chatId));
      recipients.forEach(uid => {
        if (sockets[uid]) io.to(sockets[uid]).emit('new_message', msg);
      });
    }
  });

  socket.on('disconnect', () => {
    const userId = Object.keys(sockets).find(k => sockets[k] === socket.id);
    if (userId) delete sockets[userId];
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
});