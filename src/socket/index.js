const jwt = require('jsonwebtoken');
const { User, Chat, Message, ChatParticipant } = require('../models');
const redis = require('redis');

let redisClient;
if (process.env.REDIS_URL) {
  redisClient = redis.createClient({
    url: process.env.REDIS_URL
  });
  redisClient.connect().catch(console.error);
}

const connectedUsers = new Map();

function initSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Требуется аутентификация'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.userId);
      
      if (!user) {
        return next(new Error('Пользователь не найден'));
      }

      socket.userId = user.id;
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Ошибка аутентификации'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Пользователь подключен: ${socket.userId}`);
    
    // Сохраняем подключение
    connectedUsers.set(socket.userId, socket.id);
    
    // Обновляем статус пользователя
    User.update(
      { status: 'online', lastSeen: new Date() },
      { where: { id: socket.userId } }
    );

    // Оповещаем контакты о подключении
    socket.broadcast.emit('user:status', {
      userId: socket.userId,
      status: 'online'
    });

    // Присоединение к комнатам чатов
    socket.on('join:chats', async () => {
      try {
        const userChats = await ChatParticipant.findAll({
          where: { userId: socket.userId },
          include: [Chat]
        });

        userChats.forEach(participant => {
          socket.join(`chat:${participant.Chat.id}`);
        });
      } catch (error) {
        console.error('Ошибка присоединения к чатам:', error);
      }
    });

    // Отправка сообщения
    socket.on('message:send', async (data) => {
      try {
        const { chatId, content, type, fileUrl, metadata } = data;
        
        // Проверяем, является ли пользователь участником чата
        const participant = await ChatParticipant.findOne({
          where: { userId: socket.userId, chatId }
        });

        if (!participant) {
          return socket.emit('error', { message: 'Вы не участник этого чата' });
        }

        // Создаем сообщение
        const message = await Message.create({
          chatId,
          senderId: socket.userId,
          content,
          type,
          fileUrl,
          metadata,
          reactions: {}
        });

        // Получаем полные данные сообщения
        const fullMessage = await Message.findByPk(message.id, {
          include: [{
            model: User,
            as: 'sender',
            attributes: ['id', 'firstName', 'lastName', 'avatar']
          }]
        });

        // Отправляем сообщение всем участникам чата
        io.to(`chat:${chatId}`).emit('message:new', {
          message: fullMessage.toJSON(),
          chatId
        });

        // Обновляем lastRead для отправителя
        await ChatParticipant.update(
          { lastReadMessageId: message.id },
          { where: { userId: socket.userId, chatId } }
        );

        // Отправляем уведомления участникам, кроме отправителя
        const participants = await ChatParticipant.findAll({
          where: { chatId },
          include: [User]
        });

        participants.forEach(async (participant) => {
          if (participant.userId !== socket.userId) {
            // Здесь можно добавить отправку push-уведомлений
            if (connectedUsers.has(participant.userId)) {
              socket.to(connectedUsers.get(participant.userId)).emit('notification', {
                type: 'new_message',
                chatId,
                message: fullMessage.toJSON(),
                unreadCount: 1
              });
            }
          }
        });

      } catch (error) {
        console.error('Ошибка отправки сообщения:', error);
        socket.emit('error', { message: 'Ошибка отправки сообщения' });
      }
    });

    // Редактирование сообщения
    socket.on('message:edit', async (data) => {
      try {
        const { messageId, content } = data;
        
        const message = await Message.findOne({
          where: { id: messageId, senderId: socket.userId }
        });

        if (!message) {
          return socket.emit('error', { message: 'Сообщение не найдено' });
        }

        await message.update({
          content,
          isEdited: true,
          editedAt: new Date()
        });

        io.to(`chat:${message.chatId}`).emit('message:edited', {
          messageId: message.id,
          content,
          editedAt: message.editedAt
        });

      } catch (error) {
        console.error('Ошибка редактирования сообщения:', error);
      }
    });

    // Удаление сообщения
    socket.on('message:delete', async (data) => {
      try {
        const { messageId, forAll } = data;
        
        const message = await Message.findOne({
          where: { id: messageId }
        });

        if (!message) {
          return socket.emit('error', { message: 'Сообщение не найдено' });
        }

        if (forAll && message.senderId === socket.userId) {
          // Удаление для всех
          await message.update({ isDeleted: true, deletedForAll: true });
          io.to(`chat:${message.chatId}`).emit('message:deleted', {
            messageId: message.id,
            deletedForAll: true
          });
        } else {
          // Удаление только для себя
          // Здесь можно реализовать логику мягкого удаления
          socket.emit('message:deleted:personal', { messageId });
        }

      } catch (error) {
        console.error('Ошибка удаления сообщения:', error);
      }
    });

    // Реакции на сообщения
    socket.on('message:react', async (data) => {
      try {
        const { messageId, reaction } = data;
        
        const message = await Message.findByPk(messageId);
        if (!message) return;

        const reactions = message.reactions || {};
        if (!reactions[reaction]) {
          reactions[reaction] = [];
        }

        // Добавляем или удаляем реакцию
        const userIndex = reactions[reaction].indexOf(socket.userId);
        if (userIndex > -1) {
          reactions[reaction].splice(userIndex, 1);
          if (reactions[reaction].length === 0) {
            delete reactions[reaction];
          }
        } else {
          reactions[reaction].push(socket.userId);
        }

        await message.update({ reactions });
        
        io.to(`chat:${message.chatId}`).emit('message:reaction', {
          messageId,
          reactions,
          userId: socket.userId
        });

      } catch (error) {
        console.error('Ошибка реакции:', error);
      }
    });

    // Набор текста
    socket.on('typing:start', async (data) => {
      const { chatId } = data;
      socket.to(`chat:${chatId}`).emit('typing', {
        userId: socket.userId,
        chatId,
        isTyping: true
      });
    });

    socket.on('typing:stop', async (data) => {
      const { chatId } = data;
      socket.to(`chat:${chatId}`).emit('typing', {
        userId: socket.userId,
        chatId,
        isTyping: false
      });
    });

    // Звонки
    socket.on('call:start', async (data) => {
      const { chatId, type, participants } = data;
      
      // Создаем комнату для звонка
      const callId = `call:${Date.now()}`;
      socket.join(callId);
      
      // Приглашаем участников
      participants.forEach(userId => {
        const userSocketId = connectedUsers.get(userId);
        if (userSocketId) {
          socket.to(userSocketId).emit('call:incoming', {
            callId,
            chatId,
            caller: socket.userId,
            type
          });
        }
      });
    });

    // Отключение
    socket.on('disconnect', async () => {
      console.log(`🔌 Пользователь отключен: ${socket.userId}`);
      
      connectedUsers.delete(socket.userId);
      
      // Обновляем статус пользователя
      await User.update(
        { status: 'offline', lastSeen: new Date() },
        { where: { id: socket.userId } }
      );

      // Оповещаем контакты
      socket.broadcast.emit('user:status', {
        userId: socket.userId,
        status: 'offline'
      });
    });
  });
}

module.exports = { initSocket, connectedUsers };