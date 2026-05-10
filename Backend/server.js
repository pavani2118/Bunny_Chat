const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const User = require("./models/User");
const Message = require("./models/Message");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use("/uploads", express.static("uploads"));

const JWT_SECRET = "2118";

// MongoDB connection
mongoose.connect("mongodb://127.0.0.1:27017/chat")
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log(err));

// Middleware
app.use(cors());
app.use(express.json());

// Auth middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
};

// Routes
app.post("/register", async (req, res) => {
  try {
    const { fullName, username, email, country, phone, password } = req.body;
    const exists = await User.findOne({ $or: [{ username }, { email }] });
    if (exists) return res.status(400).json({ message: "Username or Email already used" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ fullName, username, email, country, phone, password: hashed });

    res.json({ message: "Registered successfully", userId: user._id, username: user.username, fullName: user.fullName });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: "Invalid password" });

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET);
    res.json({ token, userId: user._id, username: user.username, fullName: user.fullName });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get profile details by userId
app.get("/profile/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server error" });
  }
});

// NEW: starting new chats
app.get("/users", authMiddleware, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.userId } })
      .select("_id fullName username email")
      .sort({ fullName: 1 });
    res.json(users);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server error" });
  }
});

// NEW: Get chat list with last message
app.get("/chats", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;

    // Get all unique conversations for this user
    const messages = await Message.aggregate([
      {
        $match: {
          $or: [
            { senderId: new mongoose.Types.ObjectId(userId) },
            { receiverId: new mongoose.Types.ObjectId(userId) }
          ]
        }
      },
      {
        $sort: { time: -1 }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ["$senderId", new mongoose.Types.ObjectId(userId)] },
              "$receiverId",
              "$senderId"
            ]
          },
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiverId", new mongoose.Types.ObjectId(userId)] },
                    { $eq: ["$isRead", false] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    // Populate user details
    const chatList = await Promise.all(
      messages.map(async (chat) => {
        const otherUser = await User.findById(chat._id).select("_id fullName username email");
        return {
          user: otherUser,
          lastMessage: chat.lastMessage,
          unreadCount: chat.unreadCount
        };
      })
    );

    // Sort by last message time
    chatList.sort((a, b) => b.lastMessage.time - a.lastMessage.time);

    res.json(chatList);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server error" });
  }
});

// NEW: Get messages between two users
app.get("/messages/:otherUserId", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const otherUserId = req.params.otherUserId;

    // Get all messages between these two users
    const messages = await Message.find({
      $or: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId }
      ]
    }).sort({ time: 1 });

    // Mark messages as read
    await Message.updateMany(
      { senderId: otherUserId, receiverId: userId, isRead: false },
      { $set: { isRead: true } }
    );

    res.json(messages);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Store active users with their socket IDs
const activeUsers = new Map();

// Socket.IO
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // User joins with their userId
  socket.on("user_online", (userId) => {
    activeUsers.set(userId, socket.id);
    console.log(`User ${userId} is online with socket ${socket.id}`);
    
    // Broadcast online status to all users
    io.emit("user_status", { userId, status: "online" });
  });

  // Join a specific chat room
  socket.on("join_chat", (data) => {
    const { userId, otherUserId } = data;
    const roomId = [userId, otherUserId].sort().join("_");
    socket.join(roomId);
    console.log(`User ${userId} joined room ${roomId}`);
  });

  // Send private message
  socket.on("send_message", async (data) => {
    try {
      const { senderId, receiverId, senderName, text } = data;

      // Save message to database
      const msg = await Message.create({
        senderId,
        receiverId,
        senderName,
        text,
      });

      // Create room ID (consistent for both users)
      const roomId = [senderId, receiverId].sort().join("_");

      // Emit to the room
      io.to(roomId).emit("receive_message", msg);

      // Also emit to receiver specifically if they're online
      const receiverSocketId = activeUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("new_message_notification", {
          from: senderId,
          fromName: senderName,
          message: msg
        });
      }
    } catch (err) {
      console.error("Error sending message:", err);
      socket.emit("message_error", { message: "Failed to send message" });
    }
  });

  // Mark messages as read
  socket.on("mark_read", async (data) => {
    try {
      const { userId, otherUserId } = data;
      await Message.updateMany(
        { senderId: otherUserId, receiverId: userId, isRead: false },
        { $set: { isRead: true } }
      );

      // Notify sender that messages were read
      const senderSocketId = activeUsers.get(otherUserId);
      if (senderSocketId) {
        io.to(senderSocketId).emit("messages_read", { readBy: userId });
      }
    } catch (err) {
      console.error("Error marking messages as read:", err);
    }
  });

  // Typing indicator
  socket.on("typing", (data) => {
    const { senderId, receiverId } = data;
    const receiverSocketId = activeUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("user_typing", { userId: senderId });
    }
  });

  socket.on("stop_typing", (data) => {
    const { senderId, receiverId } = data;
    const receiverSocketId = activeUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("user_stop_typing", { userId: senderId });
    }
  });

  socket.on("disconnect", () => {
    // Find and remove user from active users
    let disconnectedUserId = null;
    for (let [userId, socketId] of activeUsers.entries()) {
      if (socketId === socket.id) {
        disconnectedUserId = userId;
        activeUsers.delete(userId);
        break;
      }
    }

    if (disconnectedUserId) {
      io.emit("user_status", { userId: disconnectedUserId, status: "offline" });
      console.log(`User ${disconnectedUserId} disconnected`);
    }
  });
});

// Start server
server.listen(5000, () => console.log("Server running on port 5000"));