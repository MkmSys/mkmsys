const express = require('express');
const router = express.Router();
const { Chat, Message, User, ChatParticipant } = require('../models');
const { Op } = require('sequelize');

// Создать чат
router.post('/', async (req, res) => {
  try {
    const { type, participantIds, name, avatar, settings } = req.body;
    
    // Создаем чат
    const chat = await Chat.create({
      type: type || 'private',
      name,
      avatar,
      settings
    });
    
    // Добавляем создателя как участника
    await ChatParticipant.create({
      chatId: chat.id,
      userId: req.userId,
      role: 'owner',
      permissions: {
        sendMessages: true,
        sendMedia: true,
        addUsers: true,
        removeUsers: true,
        changeChatInfo: true,
        pinMessages: true
      }
    });
    
    // Добавляем других участников
    if (participantIds && participantIds.length > 0) {
      const participants = participantIds.map(userId => ({
        chatId: chat.id,
        userId,
        role: type === 'channel' ? 'viewer' : 'member'
      }));
      
      await ChatParticipant.bulkCreate(participants);
    }
    
    res.status(201).json({ chat });
  } catch (error) {
    console.error('Ошибка создания чата:', error);
    res.status(500).json({ error: 'Ошибка создания чата' });
  }
});

// Получить список чатов пользователя
router.get('/', async (req, res) => {
  try {
    const chats = await ChatParticipant.findAll({
      where: { userId: req.userId },
      include: [
        {
          model: Chat,
          include: [
            {
              model: ChatParticipant,
              as: 'participants',
              include: [User]
            },
            {
              model: Message,
              as: 'lastMessage',
              separate: true,
              order: [['createdAt', 'DESC']],
              limit: 1,
              include: [{
                model: User,
                as: 'sender',
                attributes: ['id', 'firstName', 'lastName', 'avatar']
              }]
            }
          ]
        }
      ],
      order: [[Chat, 'updatedAt', 'DESC']]
    });
    
    res.json({ chats });
  } catch (error) {
    console.error('Ошибка получения чатов:', error);
    res.status(500).json({ error: 'Ошибка получения чатов' });
  }
});

// Получить детали чата
router.get('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    
    const participant = await ChatParticipant.findOne({
      where: { chatId, userId: req.userId },
      include: [
        {
          model: Chat,
          include: [
            {
              model: ChatParticipant,
              as: 'participants',
              include: [User]
            }
          ]
        }
      ]
    });
    
    if (!participant) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    res.json({ chat: participant.Chat });
  } catch (error) {
    console.error('Ошибка получения чата:', error);
    res.status(500).json({ error: 'Ошибка получения чата' });
  }
});

// Получить сообщения чата
router.get('/:chatId/messages', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, before } = req.query;
    
    // Проверяем доступ
    const participant = await ChatParticipant.findOne({
      where: { chatId, userId: req.userId }
    });
    
    if (!participant) {
      return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    // Строим условия запроса
    const where = { chatId };
    if (before) {
      where.createdAt = { [Op.lt]: new Date(before) };
    }
    
    const messages = await Message.findAll({
      where,
      include: [{
        model: User,
        as: 'sender',
        attributes: ['id', 'firstName', 'lastName', 'avatar']
      }],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit)
    });
    
    // Обновляем lastReadMessageId
    if (messages.length > 0) {
      await ChatParticipant.update(
        { lastReadMessageId: messages[0].id },
        { where: { chatId, userId: req.userId } }
      );
    }
    
    res.json({ messages: messages.reverse() });
  } catch (error) {
    console.error('Ошибка получения сообщений:', error);
    res.status(500).json({ error: 'Ошибка получения сообщений' });
  }
});

// Обновить чат
router.put('/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const updates = req.body;
    
    // Проверяем права
    const participant = await ChatParticipant.findOne({
      where: { 
        chatId, 
        userId: req.userId,
        role: { [Op.in]: ['owner', 'admin'] }
      }
    });
    
    if (!participant) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    
    const chat = await Chat.findByPk(chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Чат не найден' });
    }
    
    await chat.update(updates);
    
    res.json({ chat });
  } catch (error) {
    console.error('Ошибка обновления чата:', error);
    res.status(500).json({ error: 'Ошибка обновления чата' });
  }
});

// Покинуть чат
router.delete('/:chatId/leave', async (req, res) => {
  try {
    const { chatId } = req.params;
    
    // Удаляем участника
    await ChatParticipant.destroy({
      where: { chatId, userId: req.userId }
    });
    
    // Проверяем, остались ли участники
    const remainingParticipants = await ChatParticipant.count({
      where: { chatId }
    });
    
    // Если участников не осталось, удаляем чат
    if (remainingParticipants === 0) {
      await Chat.destroy({ where: { id: chatId } });
    }
    
    res.json({ message: 'Вы покинули чат' });
  } catch (error) {
    console.error('Ошибка выхода из чата:', error);
    res.status(500).json({ error: 'Ошибка выхода из чата' });
  }
});

module.exports = router;