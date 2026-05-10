const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  username: { type: String, required: true, unique: true }, 
  email: { type: String, required: true, unique: true },   
  country: { type: String },
  phone: { type: String },
  password: { type: String, required: true },
});

module.exports = mongoose.model("User", UserSchema);
