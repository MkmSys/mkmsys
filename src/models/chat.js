const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Chat = sequelize.define('Chat', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  type: {
    type: DataTypes.ENUM('private', 'group', 'channel'),
    defaultValue: 'private'
  },
  avatar: {
    type: DataTypes.STRING,
    defaultValue: null
  },
  description: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  isEncrypted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  selfDestructTimer: {
    type: DataTypes.INTEGER, // в секундах
    defaultValue: 0
  },
  maxParticipants: {
    type: DataTypes.INTEGER,
    defaultValue: 200000
  },
  settings: {
    type: DataTypes.JSONB,
    defaultValue: {
      allowMedia: true,
      allowVoice: true,
      allowCalls: true,
      allowReactions: true
    }
  }
});

module.exports = Chat;