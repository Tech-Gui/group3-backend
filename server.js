const dotenv = require("dotenv");
dotenv.config();
// server.js
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const db = require("./db");
const cors = require("cors");
const QRCode = require("qrcode");

const app = express();
app.use(
  cors({
    origin: "http://localhost:3000", // adjust if your frontend is on a different port
    credentials: true,
  })
);
app.use(express.json());

const JWT_SECRET = "my secret";

// User Schema
const UserSchema = new mongoose.Schema({
  studentNumber: { type: String, unique: true, required: true },
  email: { type: String, required: true },
  name: { type: String, required: true },
  surname: { type: String, required: true },
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

const QrCodeTransactionRequestSchema = new mongoose.Schema({
  to: { type: String, required: true },
  amount: { type: Number, required: false },
  type: {
    type: String,
    enum: ["receive"],
    required: true,
  },
  status: {
    type: String,
    enum: ["in_progress", "completed", "cancelled", "failed"],
    required: true,
  },
  timestamp: { type: Date, default: Date.now },
});

const QrCodeTransactionRequest = mongoose.model(
  "QrCodeTransactionRequest",
  QrCodeTransactionRequestSchema
);

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    console.log("No Authorization header provided");
    return res.status(403).json({ error: "No token provided" });
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    console.log("Invalid Authorization header format");
    return res.status(403).json({ error: "Invalid token format" });
  }

  const token = parts[1];

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      console.error("Token verification error:", err);
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Token expired" });
      }
      return res.status(401).json({ error: "Failed to authenticate token" });
    }

    console.log("Token verified successfully for user:", decoded.id);
    req.userId = decoded.id;
    next();
  });
};

// Register new user
app.post("/register", async (req, res) => {
  try {
    const { name, surname, studentNumber, password, email } = req.body;
    const existingUser = await User.findOne({
      $or: [{ studentNumber }, { email: email.toLowerCase() }],
    });
    if (existingUser)
      return res.status(400).json({ error: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      surname,
      studentNumber,
      password: hashedPassword,
      email: email.toLowerCase(),
    });
    await user.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.log({ error });
    res.status(500).json({ error: "Error registering user" });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    const { studentNumber, email, password } = req.body;
    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }
    if (!studentNumber && !email) {
      return res
        .status(400)
        .json({ error: "Student number or email is required" });
    }

    if (studentNumber && email) {
      return res
        .status(400)
        .json({ error: "Please provide only student number or email" });
    }

    if (studentNumber) {
      user = await User.findOne({ studentNumber }).select("+password");
    } else {
      user = await User.findOne({ email: email.toLowerCase() }).select(
        "+password"
      );
    }

    if (!user) return res.status(404).json({ error: "User not found" });
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword)
      return res.status(401).json({ error: "Invalid password" });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1h" });
    console.log("Token generated for user:", user._id);
    res.json({
      token,
      user,
    });
  } catch (error) {
    console.error("Login error:", error);
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

app.post("/gen-receive-qr", verifyToken, async (req, res) => {
  const { amount } = req.body;

  const qrCodeSize = 500;
  try {
    const qrcodeTransactionRequest = new QrCodeTransactionRequest({
      to: req.userId,
      amount,
      type: "receive",
      status: "in_progress",
    });
    const qrcodeRequest = await qrcodeTransactionRequest.save();
    console.log("QR code request created:", qrcodeRequest._id);
    const url = `http://localhost:3001/qr/${qrcodeRequest._id}`;

    const options = {
      errorCorrectionLevel: "H",
      width: qrCodeSize,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    };
    const qrCodeDataURL = await QRCode.toDataURL(url, options);
    res.status(201).json({
      data: qrCodeDataURL,
      message: "QR code generated successfully",
    });
  } catch (err) {
    console.error("Error generating QR code:", err);
    res.status(500).send("Error generating QR code");
  }
});

app.post("/qr/:id", verifyToken, async (req, res) => {
  const transactionId = req.params.id;
  const senderId = req.userId;

  try {
    const transactionRequest = await QrCodeTransactionRequest.findById(
      transactionId
    );

    if (!transactionRequest || transactionRequest.status !== "in_progress") {
      return res
        .status(404)
        .json({ error: "Transaction not found or already completed" });
    }

    console.log({ transactionRequest, senderId });

    const recipient = await User.findOne({
      _id: transactionRequest.to,
    });
    const sender = await User.findById(senderId);

    if (!recipient) {
      return res.status(404).json({ error: "Recipient not found" });
    }

    const amount = transactionRequest.amount || req.body.amount;
    if (!amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    if (sender.balance < amount) {
      return res.status(400).json({ error: "Insufficient funds" });
    }

    sender.balance -= amount;
    recipient.balance += amount;

    await sender.save();
    await recipient.save();

    transactionRequest.status = "completed";
    await transactionRequest.save();

    const transaction = new Transaction({
      from: sender.studentNumber,
      to: recipient.studentNumber,
      amount,
      type: "send",
    });
    await transaction.save();

    res.json({ message: "Transaction completed successfully" });
  } catch (error) {
    console.error("Error completing transaction:", error);
    res.status(500).json({ error: "Error completing transaction" });
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

// Example for the /upload route
app.post("/upload", verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.userId);

    if (!user) {
      console.error(`User not found for ID: ${req.userId}`);
      return res.status(404).json({ error: "User not found" });
    }

    user.balance += amount;
    await user.save();

    const transaction = new Transaction({
      from: "UPLOAD",
      to: user.studentNumber,
      amount,
      type: "upload",
    });
    await transaction.save();

    res.json({
      message: "Money uploaded successfully",
      newBalance: user.balance,
    });
  } catch (error) {
    console.error("Error in /upload route:", error);
    res
      .status(500)
      .json({ error: "Error uploading money", details: error.message });
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
