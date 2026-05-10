const express = require("express");
const router = express.Router();
const Chat = require("../models/Chat");
const Message = require("../models/Message");
const User = require("../models/User");

// Get chat list with member details
router.get("/chat/list/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    // Find chats the user
    const chats = await Chat.find({ members: userId });

    // Populate member info for each chat
    const chatsWithUserDetails = await Promise.all(
      chats.map(async (chat) => {
        const membersInfo = await User.find(
          { _id: { $in: chat.members } },
          "fullName username"
        );
        return {
          _id: chat._id,
          members: membersInfo,
          lastMessage: chat.lastMessage,
        };
      })
    );

    res.json(chatsWithUserDetails);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get messages by chat ID
router.get("/chat/:chatId/messages", async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const messages = await Message.find({ chatId }).sort({ time: 1 });
    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Send message and update lastMessage in chat
router.post("/message/send", async (req, res) => {
  try {
    const { chatId, senderId, text } = req.body;
    const sender = await User.findById(senderId);
    if (!sender) return res.status(400).json({ message: "Sender not found" });

    const msg = await Message.create({
      chatId,
      senderId,
      senderName: sender.fullName,
      text,
    });

    // Update lastMessage in chat document
    await Chat.findByIdAndUpdate(chatId, { lastMessage: text });

    res.json(msg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// create chat between two users
router.post("/chat/get-or-create", async (req, res) => {
  try {
    const { senderId, receiverId } = req.body;

    // Find existing chat
    let chat = await Chat.findOne({
      members: { $all: [senderId, receiverId], $size: 2 },
    });

    if (!chat) {
      chat = await Chat.create({ members: [senderId, receiverId] });
    }

    // Populate member info before sending back
    const membersInfo = await User.find(
      { _id: { $in: chat.members } },
      "fullName username"
    );

    res.json({
      _id: chat._id,
      members: membersInfo,
      lastMessage: chat.lastMessage,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
