const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const USERS_FILE = 'users.json';
const MESSAGES_FILE = 'messages.json';
const GROUPS_FILE = 'groups.json';
const UPLOADS_DIR = 'uploads';

// Initialize data files if they don't exist
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([]));
}
if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify([]));
}
if (!fs.existsSync(GROUPS_FILE)) {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify([]));
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Helper functions to read/write data
function readUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function readMessages() {
  try {
    const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

function writeMessages(messages) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

function readGroups() {
  try {
    const data = fs.readFileSync(GROUPS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

function writeGroups(groups) {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));
}

// Generate unique 6-character group ID
function generateGroupId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// Store active users (socketId -> username)
const activeUsers = new Map();

// Store active group calls (groupId -> Set of usernames)
const activeGroupCalls = new Map();

// Registration endpoint
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const users = readUsers();
  
  // Check if username already exists
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: 'Username already exists' });
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Add new user
  const newUser = {
    id: Date.now().toString(),
    username,
    password: hashedPassword,
    createdAt: new Date().toISOString(),
    avatar: null,
    displayName: username,
    bio: '',
    blockedUsers: [],
    isDeleted: false
  };

  users.push(newUser);
  writeUsers(users);

  res.json({ success: true, message: 'Registration successful' });
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const users = readUsers();
  const user = users.find(u => u.username === username);

  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const isValidPassword = await bcrypt.compare(password, user.password);

  if (!isValidPassword) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  res.json({ success: true, username: user.username });
});

// Search users endpoint
app.get('/api/users/search', (req, res) => {
  const query = req.query.q || '';
  const currentUser = req.query.from || '';
  const users = readUsers();
  
  // Get current user's blocked users
  const currentUserData = users.find(u => u.username === currentUser);
  const blockedUsers = currentUserData ? (currentUserData.blockedUsers || []) : [];
  
  const filteredUsers = users
    .filter(u => 
      u.username.toLowerCase().includes(query.toLowerCase()) &&
      u.username !== currentUser &&
      !u.isDeleted &&
      !blockedUsers.includes(u.username)
    )
    .map(u => ({ 
      id: u.id, 
      username: u.username,
      displayName: u.displayName || u.username,
      avatar: u.avatar
    }))
    .slice(0, 20); // Limit results

  res.json(filteredUsers);
});

// Get chat history
app.get('/api/messages', (req, res) => {
  const { from, to, groupId, all } = req.query;
  const messages = readMessages();
  const users = readUsers();
  
  let chatMessages;
  if (all === 'true' && from) {
    // Get all messages for a user (for loading contacts)
    chatMessages = messages.filter(m => 
      m.from === from || m.to === from || (m.groupId && readGroups().find(g => g.id === m.groupId && g.members.includes(from)))
    );
  } else if (groupId) {
    // Group messages
    chatMessages = messages.filter(m => m.groupId === groupId);
  } else if (from && to) {
    // Direct messages
    chatMessages = messages.filter(m => 
      (m.from === from && m.to === to) || (m.from === to && m.to === from)
    );
  } else {
    chatMessages = [];
  }

  // Filter out deleted messages and messages from blocked users
  const currentUser = users.find(u => u.username === from);
  const blockedUsers = currentUser ? (currentUser.blockedUsers || []) : [];
  
  chatMessages = chatMessages.filter(m => 
    !m.isDeleted && !blockedUsers.includes(m.from)
  );

  res.json(chatMessages);
});

// Create group
app.post('/api/groups', (req, res) => {
  const { name, createdBy } = req.body;
  
  if (!name || !createdBy) {
    return res.status(400).json({ error: 'Group name and creator are required' });
  }

  const groups = readGroups();
  let groupId;
  let isUnique = false;
  
  // Generate unique ID
  while (!isUnique) {
    groupId = generateGroupId();
    if (!groups.find(g => g.id === groupId)) {
      isUnique = true;
    }
  }

  const newGroup = {
    id: groupId,
    name,
    createdBy,
    members: [createdBy],
    createdAt: new Date().toISOString()
  };

  groups.push(newGroup);
  writeGroups(groups);

  res.json({ success: true, group: newGroup });
});

// Search/Get group by ID
app.get('/api/groups/search', (req, res) => {
  const { q } = req.query;
  const groups = readGroups();
  
  if (q && q.length === 6) {
    // Search by exact ID
    const group = groups.find(g => g.id.toUpperCase() === q.toUpperCase());
    if (group) {
      return res.json([group]);
    }
  }
  
  // Search by name
  const filteredGroups = groups
    .filter(g => g.name.toLowerCase().includes((q || '').toLowerCase()))
    .slice(0, 20);
  
  res.json(filteredGroups);
});

// Join group
app.post('/api/groups/join', (req, res) => {
  const { groupId, username } = req.body;
  
  if (!groupId || !username) {
    return res.status(400).json({ error: 'Group ID and username are required' });
  }

  const groups = readGroups();
  const group = groups.find(g => g.id.toUpperCase() === groupId.toUpperCase());
  
  if (!group) {
    return res.status(404).json({ error: 'Group not found' });
  }

  if (!group.members.includes(username)) {
    group.members.push(username);
    writeGroups(groups);
  }

  res.json({ success: true, group });
});

// Get user's groups
app.get('/api/groups/user/:username', (req, res) => {
  const { username } = req.params;
  const groups = readGroups();
  
  const userGroups = groups.filter(g => g.members.includes(username));
  res.json(userGroups);
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  res.json({
    success: true,
    fileUrl: `/uploads/${req.file.filename}`,
    fileName: req.file.originalname,
    fileType: req.file.mimetype,
    fileSize: req.file.size
  });
});

// Pin/Unpin message
app.post('/api/messages/pin', (req, res) => {
  const { messageId, pinned } = req.body;
  const messages = readMessages();
  
  const message = messages.find(m => m.id === messageId);
  if (!message) {
    return res.status(404).json({ error: 'Message not found' });
  }
  
  message.pinned = pinned;
  writeMessages(messages);
  
  res.json({ success: true, message });
});

// Get pinned messages
app.get('/api/messages/pinned', (req, res) => {
  const { from, to, groupId } = req.query;
  const messages = readMessages();
  
  let chatMessages;
  if (groupId) {
    chatMessages = messages.filter(m => m.groupId === groupId && m.pinned);
  } else if (from && to) {
    chatMessages = messages.filter(m => 
      ((m.from === from && m.to === to) || (m.from === to && m.to === from)) && m.pinned
    );
  } else {
    chatMessages = [];
  }
  
  res.json(chatMessages);
});

// Delete message endpoint
app.delete('/api/messages/:messageId', (req, res) => {
  const { messageId } = req.params;
  const { username } = req.body; // Username of the person deleting
  
  const messages = readMessages();
  const messageIndex = messages.findIndex(m => m.id === messageId);
  
  if (messageIndex === -1) {
    return res.status(404).json({ error: 'Message not found' });
  }
  
  const message = messages[messageIndex];
  
  // Check if user can delete this message (sender or admin)
  if (message.from !== username) {
    return res.status(403).json({ error: 'You can only delete your own messages' });
  }
  
  // Mark message as deleted instead of removing it
  message.isDeleted = true;
  message.deletedAt = new Date().toISOString();
  message.deletedBy = username;
  
  writeMessages(messages);
  
  res.json({ success: true, message: 'Message deleted' });
});

// Block user endpoint
app.post('/api/users/block', (req, res) => {
  const { blocker, blocked } = req.body;
  
  if (!blocker || !blocked) {
    return res.status(400).json({ error: 'Blocker and blocked usernames are required' });
  }
  
  if (blocker === blocked) {
    return res.status(400).json({ error: 'Cannot block yourself' });
  }
  
  const users = readUsers();
  const blockerUser = users.find(u => u.username === blocker);
  const blockedUser = users.find(u => u.username === blocked);
  
  if (!blockerUser || !blockedUser) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  if (!blockerUser.blockedUsers) {
    blockerUser.blockedUsers = [];
  }
  
  if (!blockerUser.blockedUsers.includes(blocked)) {
    blockerUser.blockedUsers.push(blocked);
    writeUsers(users);
  }
  
  res.json({ success: true, message: 'User blocked' });
});

// Unblock user endpoint
app.post('/api/users/unblock', (req, res) => {
  const { blocker, blocked } = req.body;
  
  if (!blocker || !blocked) {
    return res.status(400).json({ error: 'Blocker and blocked usernames are required' });
  }
  
  const users = readUsers();
  const blockerUser = users.find(u => u.username === blocker);
  
  if (!blockerUser) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  if (blockerUser.blockedUsers) {
    blockerUser.blockedUsers = blockerUser.blockedUsers.filter(u => u !== blocked);
    writeUsers(users);
  }
  
  res.json({ success: true, message: 'User unblocked' });
});

// Get blocked users
app.get('/api/users/blocked/:username', (req, res) => {
  const { username } = req.params;
  
  const users = readUsers();
  const user = users.find(u => u.username === username);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json(user.blockedUsers || []);
});

// Update profile endpoint
app.put('/api/users/profile', (req, res) => {
  const { username, displayName, bio } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  const users = readUsers();
  const user = users.find(u => u.username === username);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  if (displayName !== undefined) {
    user.displayName = displayName;
  }
  if (bio !== undefined) {
    user.bio = bio;
  }
  
  writeUsers(users);
  
  res.json({ success: true, user: { 
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    avatar: user.avatar
  }});
});

// Upload avatar endpoint
app.post('/api/users/avatar', upload.single('avatar'), (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  if (!req.file) {
    return res.status(400).json({ error: 'No avatar file uploaded' });
  }
  
  const users = readUsers();
  const user = users.find(u => u.username === username);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  user.avatar = `/uploads/${req.file.filename}`;
  writeUsers(users);
  
  res.json({ success: true, avatar: user.avatar });
});

// Get user profile
app.get('/api/users/profile/:username', (req, res) => {
  const { username } = req.params;
  
  const users = readUsers();
  const user = users.find(u => u.username === username);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    avatar: user.avatar,
    createdAt: user.createdAt
  });
});

// Placeholder avatar endpoint
app.get('/api/placeholder-avatar/:username', (req, res) => {
  const { username } = req.params;
  
  const users = readUsers();
  const user = users.find(u => u.username === username);
  
  if (user && user.avatar) {
    // Redirect to actual avatar
    res.redirect(user.avatar);
  } else {
    // Return a default avatar (you could generate one or use a default image)
    res.status(404).json({ error: 'No avatar found' });
  }
});

// Delete user account
app.delete('/api/users/:username', async (req, res) => {
  const { username } = req.params;
  const { password } = req.body;
  
  const users = readUsers();
  const userIndex = users.findIndex(u => u.username === username);
  
  if (userIndex === -1) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  const user = users[userIndex];
  
  // Verify password
  const isValidPassword = await bcrypt.compare(password, user.password);
  if (!isValidPassword) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  
  // Mark user as deleted instead of removing
  user.isDeleted = true;
  user.deletedAt = new Date().toISOString();
  
  writeUsers(users);
  
  res.json({ success: true, message: 'Account deleted' });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('login', (username) => {
    activeUsers.set(socket.id, username);
    socket.username = username;
    
    // Notify all users about new online user
    io.emit('userOnline', username);
    
    // Send list of online users
    const onlineUsers = Array.from(activeUsers.values());
    socket.emit('onlineUsers', onlineUsers);
  });

  socket.on('sendMessage', (data) => {
    const { to, message, groupId, fileUrl, fileType, fileName, isVideoMessage, isVoiceMessage, duration } = data;
    const from = socket.username;

    if (!from || (!message && !fileUrl && !isVideoMessage && !isVoiceMessage)) {
      return;
    }

    // Check if sender is blocked by recipient (for direct messages)
    if (!groupId && to) {
      const users = readUsers();
      const recipient = users.find(u => u.username === to);
      if (recipient && recipient.blockedUsers && recipient.blockedUsers.includes(from)) {
        socket.emit('messageError', { error: 'You are blocked by this user' });
        return;
      }
    }

    const messageData = {
      id: Date.now().toString(),
      from,
      to: groupId ? null : to,
      groupId: groupId || null,
      message: message || null,
      fileUrl: fileUrl || null,
      fileType: fileType || null,
      fileName: fileName || null,
      isVideoMessage: isVideoMessage || false,
      isVoiceMessage: isVoiceMessage || false,
      duration: duration || null,
      pinned: false,
      isDeleted: false,
      timestamp: new Date().toISOString()
    };

    // Save message
    const messages = readMessages();
    messages.push(messageData);
    writeMessages(messages);

    if (groupId) {
      // Group message - send to all group members (except blocked users)
      const groups = readGroups();
      const group = groups.find(g => g.id === groupId);
      if (group) {
        group.members.forEach(member => {
          if (member !== from) {
            const users = readUsers();
            const memberUser = users.find(u => u.username === member);
            // Don't send to users who have blocked the sender
            if (!memberUser || !memberUser.blockedUsers || !memberUser.blockedUsers.includes(from)) {
              const memberSocket = Array.from(io.sockets.sockets.values())
                .find(s => s.username === member);
              if (memberSocket) {
                memberSocket.emit('newMessage', messageData);
              }
            }
          }
        });
      }
    } else {
      // Direct message - send to recipient if online and not blocked
      const recipientSocket = Array.from(io.sockets.sockets.values())
        .find(s => s.username === to);

      if (recipientSocket) {
        recipientSocket.emit('newMessage', messageData);
      }
    }

    // Also send back to sender for confirmation
    socket.emit('messageSent', messageData);
  });

  // Call signaling events
  socket.on('callOffer', (data) => {
    const { to, offer, type } = data;
    const from = socket.username;
    
    const recipientSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.username === to);
    
    if (recipientSocket) {
      recipientSocket.emit('callOffer', { from, offer, type });
    }
  });

  socket.on('callAnswer', (data) => {
    const { to, answer } = data;
    const from = socket.username;
    
    const recipientSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.username === to);
    
    if (recipientSocket) {
      recipientSocket.emit('callAnswer', { from, answer });
    }
  });

  socket.on('callIceCandidate', (data) => {
    const { to, candidate } = data;
    const from = socket.username;
    
    const recipientSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.username === to);
    
    if (recipientSocket) {
      recipientSocket.emit('callIceCandidate', { from, candidate });
    }
  });

  socket.on('callEnd', (data) => {
    const { to, groupId } = data;
    const from = socket.username;
    
    if (groupId) {
      // Group call end
      const callParticipants = activeGroupCalls.get(groupId);
      if (callParticipants) {
        callParticipants.delete(from);
        if (callParticipants.size === 0) {
          activeGroupCalls.delete(groupId);
        }
        
        // Notify all group members
        const groups = readGroups();
        const group = groups.find(g => g.id === groupId);
        if (group) {
          group.members.forEach(member => {
            const memberSocket = Array.from(io.sockets.sockets.values())
              .find(s => s.username === member);
            if (memberSocket) {
              memberSocket.emit('groupCallEnd', { groupId, from });
            }
          });
        }
      }
    } else {
      // Direct call end
      const recipientSocket = Array.from(io.sockets.sockets.values())
        .find(s => s.username === to);
      
      if (recipientSocket) {
        recipientSocket.emit('callEnd', { from });
      }
    }
  });

  // Group call signaling events
  socket.on('groupCallOffer', (data) => {
    const { groupId, offer, type } = data;
    const from = socket.username;
    
    // Initialize group call if it doesn't exist
    if (!activeGroupCalls.has(groupId)) {
      activeGroupCalls.set(groupId, new Set());
    }
    activeGroupCalls.get(groupId).add(from);
    
    // Broadcast to all group members except sender
    const groups = readGroups();
    const group = groups.find(g => g.id === groupId);
    if (group) {
      group.members.forEach(member => {
        if (member !== from) {
          const memberSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.username === member);
          if (memberSocket) {
            memberSocket.emit('groupCallOffer', { groupId, from, offer, type });
          }
        }
      });
    }
  });

  socket.on('groupCallAnswer', (data) => {
    const { groupId, answer, to } = data;
    const from = socket.username;
    
    // Add user to active call
    if (activeGroupCalls.has(groupId)) {
      activeGroupCalls.get(groupId).add(from);
    }
    
    // Send answer to the specific user who initiated
    const recipientSocket = Array.from(io.sockets.sockets.values())
      .find(s => s.username === to);
    
    if (recipientSocket) {
      recipientSocket.emit('groupCallAnswer', { groupId, from, answer });
    }
    
    // Broadcast to other participants
    const groups = readGroups();
    const group = groups.find(g => g.id === groupId);
    if (group) {
      group.members.forEach(member => {
        if (member !== from && member !== to) {
          const memberSocket = Array.from(io.sockets.sockets.values())
            .find(s => s.username === member);
          if (memberSocket) {
            memberSocket.emit('groupCallParticipantJoined', { groupId, from });
          }
        }
      });
    }
  });

  socket.on('groupCallIceCandidate', (data) => {
    const { groupId, candidate, to } = data;
    const from = socket.username;
    
    // Send to specific participant or broadcast to all
    if (to) {
      const recipientSocket = Array.from(io.sockets.sockets.values())
        .find(s => s.username === to);
      if (recipientSocket) {
        recipientSocket.emit('groupCallIceCandidate', { groupId, from, candidate });
      }
    } else {
      // Broadcast to all group members
      const groups = readGroups();
      const group = groups.find(g => g.id === groupId);
      if (group) {
        group.members.forEach(member => {
          if (member !== from) {
            const memberSocket = Array.from(io.sockets.sockets.values())
              .find(s => s.username === member);
            if (memberSocket) {
              memberSocket.emit('groupCallIceCandidate', { groupId, from, candidate });
            }
          }
        });
      }
    }
  });

  socket.on('getGroupCallParticipants', (data) => {
    const { groupId } = data;
    const participants = activeGroupCalls.get(groupId) || new Set();
    socket.emit('groupCallParticipants', { groupId, participants: Array.from(participants) });
  });

  socket.on('disconnect', () => {
    const username = activeUsers.get(socket.id);
    if (username) {
      activeUsers.delete(socket.id);
      io.emit('userOffline', username);
      
      // Remove user from all active group calls
      activeGroupCalls.forEach((participants, groupId) => {
        if (participants.has(username)) {
          participants.delete(username);
          if (participants.size === 0) {
            activeGroupCalls.delete(groupId);
          } else {
            // Notify remaining participants
            const groups = readGroups();
            const group = groups.find(g => g.id === groupId);
            if (group) {
              group.members.forEach(member => {
                const memberSocket = Array.from(io.sockets.sockets.values())
                  .find(s => s.username === member && s.id !== socket.id);
                if (memberSocket) {
                  memberSocket.emit('groupCallParticipantLeft', { groupId, from: username });
                }
              });
            }
          }
        }
      });
    }
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

