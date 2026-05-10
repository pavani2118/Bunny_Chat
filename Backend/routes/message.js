const express = require("express");
const Message = require("../models/Message");
const Chat = require("../models/Chat");
const router = express.Router();

router.post("/send", async (req, res) => {
  const { chatId, senderId, text } = req.body;

  const message = await Message.create({
    chatId,
    senderId,
    text,
  });

  // update chat list
  await Chat.findByIdAndUpdate(chatId, {
    lastMessage: text,
    lastMessageTime: new Date(),
  });

  res.json(message);
});
router.get("/list/:userId", async (req, res) => {
  const chats = await Chat.find({
    members: req.params.userId,
  }).sort({ lastMessageTime: -1 });

  res.json(chats);
});

router.get("/:chatId/messages", async (req, res) => {
  const messages = await Message.find({
    chatId: req.params.chatId,
  }).sort({ createdAt: 1 });

  res.json(messages);
});

module.exports = router;
