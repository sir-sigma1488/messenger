require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const bodyParser = require('body-parser');
const User = require('./models/User');
const Message = require('./models/Message');
const Chat = require('./models/Chat');

const app = express();
const server = http.createServer(app);

const io = socketIO(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatRoutes = require('./routes/chats');
const friendRoutes = require('./routes/friends');
const storyRoutes = require('./routes/stories');

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/stories', storyRoutes);

// Serve frontend static files
app.use(express.static('public'));

// Fallback to frontend for SPA routing
app.get('*', (req, res) => {
  res.sendFile(__dirname + '/../public/index.html');
});

// Socket.io events
const userSockets = new Map(); // userId -> socketId

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('user_online', (userId) => {
    userSockets.set(userId, socket.id);
    User.setOnlineStatus(userId, true);
    io.emit('user_status_changed', { userId, isOnline: true });
  });

  socket.on('send_message', async (data) => {
    try {
      const { chatId, userId, message, messageType = 'text' } = data;
      
      const newMessage = await Message.create(chatId, userId, message, messageType);
      
      // Broadcast to all users in the chat
      io.emit('new_message', {
        chatId,
        messageId: newMessage.id,
        senderId: userId,
        message,
        messageType,
        createdAt: newMessage.created_at
      });

      // Mark other users' messages as read
      io.emit('message_read', { chatId, messageId: newMessage.id });
    } catch (error) {
      console.error('Error sending message:', error);
      socket.emit('error', { message: 'Ошибка отправки сообщения' });
    }
  });

  socket.on('typing', (data) => {
    const { chatId, userId, username } = data;
    io.emit('user_typing', { chatId, userId, username });
  });

  socket.on('stop_typing', (data) => {
    const { chatId, userId } = data;
    io.emit('user_stop_typing', { chatId, userId });
  });

  socket.on('message_read', async (data) => {
    try {
      const { messageId } = data;
      await Message.markAsRead(messageId);
      io.emit('message_marked_read', { messageId });
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  });

  socket.on('edit_message', async (data) => {
    try {
      const { messageId, newMessage } = data;
      await Message.editMessage(messageId, newMessage);
      io.emit('message_edited', { messageId, newMessage });
    } catch (error) {
      console.error('Error editing message:', error);
    }
  });

  socket.on('delete_message', async (data) => {
    try {
      const { messageId } = data;
      await Message.deleteMessage(messageId);
      io.emit('message_deleted', { messageId });
    } catch (error) {
      console.error('Error deleting message:', error);
    }
  });

  socket.on('user_offline', (userId) => {
    userSockets.delete(userId);
    User.setOnlineStatus(userId, false);
    io.emit('user_status_changed', { userId, isOnline: false });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Find and remove the user
    for (const [userId, socketId] of userSockets.entries()) {
      if (socketId === socket.id) {
        userSockets.delete(userId);
        User.setOnlineStatus(userId, false);
        io.emit('user_status_changed', { userId, isOnline: false });
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Котлетка Backend running on port ${PORT}`);
});
