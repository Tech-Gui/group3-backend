// db.js
const mongoose = require("mongoose");

const dbURL = process.env.MONGO_URI;
console.log({ dbURL });

mongoose.connect(dbURL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;

db.on("error", (error) => {
  console.error("MongoDB connection error:", error);
});

db.once("open", () => {
  console.log("Connected to MongoDB");
});

module.exports = db;
