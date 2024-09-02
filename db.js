// db.js
const mongoose = require("mongoose");

const dbURL =
  "mongodb+srv://roselightservices34:H3chl1oByfD7FFEl@roselight.yl9t6cm.mongodb.net/?retryWrites=true&w=majority&appName=roselight";

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
