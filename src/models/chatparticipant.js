const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ChatParticipant = sequelize.define('ChatParticipant', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  role: {
    type: DataTypes.ENUM('owner', 'admin', 'member', 'viewer'),
    defaultValue: 'member'
  },
  permissions: {
    type: DataTypes.JSONB,
    defaultValue: {
      sendMessages: true,
      sendMedia: true,
      addUsers: false,
      removeUsers: false,
      changeChatInfo: false,
      pinMessages: false
    }
  },
  nickname: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  joinedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  mutedUntil: {
    type: DataTypes.DATE,
    allowNull: true
  },
  lastReadMessageId: {
    type: DataTypes.UUID,
    allowNull: true
  }
});

module.exports = ChatParticipant;