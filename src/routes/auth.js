const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { authenticate } = require('../middleware/auth');

// Регистрация
router.post('/register', async (req, res) => {
  try {
    const { phone, password, firstName, lastName, email } = req.body;
    
    // Проверяем существование пользователя
    const existingUser = await User.findOne({ where: { phone } });
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким номером уже существует' });
    }
    
    // Создаем пользователя
    const user = await User.create({
      phone,
      password,
      firstName,
      lastName,
      email
    });
    
    // Генерируем токен
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    res.status(201).json({
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        theme: user.theme
      },
      token
    });
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

// Вход по номеру телефона
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    
    const user = await User.findOne({ where: { phone } });
    if (!user) {
      return res.status(401).json({ error: 'Неверный номер телефона или пароль' });
    }
    
    const isValidPassword = await user.validatePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Неверный номер телефона или пароль' });
    }
    
    // Обновляем статус
    await user.update({ lastSeen: new Date() });
    
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    res.json({
      user: {
        id: user.id,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        theme: user.theme,
        status: user.status
      },
      token
    });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

// Проверка токена
router.get('/verify', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.userId, {
      attributes: { exclude: ['password'] }
    });
    
    res.json({ user });
  } catch (error) {
    console.error('Ошибка проверки токена:', error);
    res.status(500).json({ error: 'Ошибка проверки токена' });
  }
});

// Выход
router.post('/logout', authenticate, async (req, res) => {
  try {
    await User.update(
      { status: 'offline', lastSeen: new Date() },
      { where: { id: req.userId } }
    );
    
    res.json({ message: 'Вы успешно вышли' });
  } catch (error) {
    console.error('Ошибка выхода:', error);
    res.status(500).json({ error: 'Ошибка выхода' });
  }
});

module.exports = router;