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

// server.js
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const db = require("./db");

const app = express();
app.use(express.json());

const JWT_SECRET = "your_jwt_secret";

// User Schema
const UserSchema = new mongoose.Schema({
  studentNumber: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
});

const User = mongoose.model("User", UserSchema);

// Transaction Schema
const TransactionSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  amount: { type: Number, required: true },
  type: {
    type: String,
    enum: ["send", "receive", "withdraw", "upload"],
    required: true,
  },
  timestamp: { type: Date, default: Date.now },
});

const Transaction = mongoose.model("Transaction", TransactionSchema);

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.status(403).json({ error: "No token provided" });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(500).json({ error: "Failed to authenticate token" });
    req.userId = decoded.id;
    next();
  });
};

// Register new user
app.post("/register", async (req, res) => {
  try {
    const { studentNumber, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ studentNumber, password: hashedPassword });
    await user.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error registering user" });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    const { studentNumber, password } = req.body;
    const user = await User.findOne({ studentNumber });
    if (!user) return res.status(404).json({ error: "User not found" });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword)
      return res.status(401).json({ error: "Invalid password" });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1h" });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: "Error logging in" });
  }
});

// Get balance
app.get("/balance", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    res.json({ balance: user.balance });
  } catch (error) {
    res.status(500).json({ error: "Error fetching balance" });
  }
});

// Send money
app.post("/send", verifyToken, async (req, res) => {
  try {
    const { toStudentNumber, amount } = req.body;
    const sender = await User.findById(req.userId);
    const recipient = await User.findOne({ studentNumber: toStudentNumber });

    if (!recipient)
      return res.status(404).json({ error: "Recipient not found" });
    if (sender.balance < amount)
      return res.status(400).json({ error: "Insufficient funds" });

    sender.balance -= amount;
    recipient.balance += amount;

    await sender.save();
    await recipient.save();

    const transaction = new Transaction({
      from: sender.studentNumber,
      to: recipient.studentNumber,
      amount,
      type: "send",
    });
    await transaction.save();

    res.json({ message: "Money sent successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error sending money" });
  }
});

// Withdraw money
app.post("/withdraw", verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.userId);

    if (user.balance < amount)
      return res.status(400).json({ error: "Insufficient funds" });

    user.balance -= amount;
    await user.save();

    const transaction = new Transaction({
      from: user.studentNumber,
      to: "WITHDRAW",
      amount,
      type: "withdraw",
    });
    await transaction.save();

    res.json({ message: "Money withdrawn successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error withdrawing money" });
  }
});

// Upload money
app.post("/upload", verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.userId);

    user.balance += amount;
    await user.save();

    const transaction = new Transaction({
      from: "UPLOAD",
      to: user.studentNumber,
      amount,
      type: "upload",
    });
    await transaction.save();

    res.json({ message: "Money uploaded successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error uploading money" });
  }
});

// Get transaction history
app.get("/transactions", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    const transactions = await Transaction.find({
      $or: [{ from: user.studentNumber }, { to: user.studentNumber }],
    }).sort({ timestamp: -1 });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: "Error fetching transactions" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
