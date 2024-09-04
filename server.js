const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const cors = require("cors");
const qrcode = require("qrcode");
const shortid = require("shortid");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = "my secret";

// User (Student) Schema
const UserSchema = new mongoose.Schema({
  studentNumber: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  surname: { type: String, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
});

const User = mongoose.model("User", UserSchema);

// Merchant Schema
const MerchantSchema = new mongoose.Schema({
  merchantId: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
});

const Merchant = mongoose.model("Merchant", MerchantSchema);

// Transaction Schema
const TransactionSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  amount: { type: Number, required: true },
  type: {
    type: String,
    enum: ["send", "receive", "withdraw", "upload", "merchant_payment"],
    required: true,
  },
  timestamp: { type: Date, default: Date.now },
});

const Transaction = mongoose.model("Transaction", TransactionSchema);

// Pending Payment Schema
const PendingPaymentSchema = new mongoose.Schema({
  paymentId: { type: String, unique: true, required: true },
  merchantId: { type: String, required: true },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ["pending", "completed", "cancelled"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now, expires: "1h" }, // Automatically delete after 1 hour
});

const PendingPayment = mongoose.model("PendingPayment", PendingPaymentSchema);

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(403).json({ error: "No token provided" });

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(403).json({ error: "Invalid token format" });
  }

  const token = parts[1];

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(401).json({ error: "Failed to authenticate token" });
    req.userId = decoded.id;
    req.userType = decoded.type;
    next();
  });
};

// Student Routes

// Register new student
app.post("/register", async (req, res) => {
  try {
    const { name, surname, studentNumber, password } = req.body;

    if (!name || !surname || !studentNumber || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existingUser = await User.findOne({ studentNumber });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: "User with this student number already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      surname,
      studentNumber,
      password: hashedPassword,
    });

    await user.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Registration error:", error);
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

    const token = jwt.sign({ id: user._id, type: "student" }, JWT_SECRET, {
      expiresIn: "1h",
    });
    res.json({
      token,
      user: {
        studentNumber: user.studentNumber,
        name: user.name,
        surname: user.surname,
      },
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

    res.json({
      message: "Money sent successfully",
      transaction: {
        ...transaction.toObject(),
        senderName: `${sender.name} ${sender.surname}`,
        recipientName: `${recipient.name} ${recipient.surname}`,
        senderBalance: sender.balance,
        recipientBalance: recipient.balance,
      },
    });
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

    res.json({
      message: "Money withdrawn successfully",
      transaction: {
        ...transaction.toObject(),
        userName: `${user.name} ${user.surname}`,
        balance: user.balance,
      },
    });
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

    res.json({
      message: "Money uploaded successfully",
      transaction: {
        ...transaction.toObject(),
        userName: `${user.name} ${user.surname}`,
        balance: user.balance,
      },
    });
  } catch (error) {
    console.error("Error in /upload route:", error);
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

    const enhancedTransactions = await Promise.all(
      transactions.map(async (transaction) => {
        const transObj = transaction.toObject();
        if (transaction.from !== "UPLOAD" && transaction.to !== "WITHDRAW") {
          const fromUser = await User.findOne({
            studentNumber: transaction.from,
          });
          const toUser = await User.findOne({ studentNumber: transaction.to });
          transObj.fromName = fromUser
            ? `${fromUser.name} ${fromUser.surname}`
            : "Unknown";
          transObj.toName = toUser
            ? `${toUser.name} ${toUser.surname}`
            : "Unknown";
        }
        return transObj;
      })
    );

    res.json({
      transactions: enhancedTransactions,
      currentBalance: user.balance,
    });
  } catch (error) {
    res.status(500).json({ error: "Error fetching transactions" });
  }
});

// Merchant Routes

// Register new merchant
app.post("/register/merchant", async (req, res) => {
  try {
    const { name, merchantId, password } = req.body;

    if (!name || !merchantId || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existingMerchant = await Merchant.findOne({ merchantId });
    if (existingMerchant) {
      return res
        .status(400)
        .json({ error: "Merchant with this ID already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const merchant = new Merchant({
      name,
      merchantId,
      password: hashedPassword,
    });

    await merchant.save();
    res.status(201).json({ message: "Merchant registered successfully" });
  } catch (error) {
    console.error("Merchant registration error:", error);
    res.status(500).json({ error: "Error registering merchant" });
  }
});

// Merchant login
app.post("/login/merchant", async (req, res) => {
  try {
    const { merchantId, password } = req.body;
    const merchant = await Merchant.findOne({ merchantId });
    if (!merchant) return res.status(404).json({ error: "Merchant not found" });

    const validPassword = await bcrypt.compare(password, merchant.password);
    if (!validPassword)
      return res.status(401).json({ error: "Invalid password" });

    const token = jwt.sign({ id: merchant._id, type: "merchant" }, JWT_SECRET, {
      expiresIn: "1h",
    });
    res.json({
      token,
      merchant: {
        merchantId: merchant.merchantId,
        name: merchant.name,
      },
    });
  } catch (error) {
    console.error("Merchant login error:", error);
    res.status(500).json({ error: "Error logging in" });
  }
});

// Get merchant balance
app.get("/merchant/balance", verifyToken, async (req, res) => {
  if (req.userType !== "merchant")
    return res.status(403).json({ error: "Unauthorized" });
  try {
    const merchant = await Merchant.findById(req.userId);
    res.json({ balance: merchant.balance });
  } catch (error) {
    res.status(500).json({ error: "Error fetching merchant balance" });
  }
});

// Generate payment link
app.post("/merchant/generate-payment-link", verifyToken, async (req, res) => {
  if (req.userType !== "merchant")
    return res.status(403).json({ error: "Unauthorized" });
  try {
    const { amount } = req.body;
    const merchant = await Merchant.findById(req.userId);

    const paymentId = shortid.generate();
    const pendingPayment = new PendingPayment({
      paymentId,
      merchantId: merchant.merchantId,
      amount,
    });

    await pendingPayment.save();

    const paymentLink = `${
      process.env.FRONTEND_URL || "https://digital-wallet-2n2a.vercel.app/"
    }/pay/${paymentId}`;
    const qrCode = await qrcode.toDataURL(paymentLink);

    res.json({ paymentLink, qrCode, paymentId });
  } catch (error) {
    console.error("Error generating payment link:", error);
    res.status(500).json({ error: "Error generating payment link" });
  }
});

// Get merchant transactions
app.get("/merchant/transactions", verifyToken, async (req, res) => {
  if (req.userType !== "merchant")
    return res.status(403).json({ error: "Unauthorized" });
  try {
    const merchant = await Merchant.findById(req.userId);
    const transactions = await Transaction.find({
      to: merchant.merchantId,
      type: "merchant_payment",
    }).sort({ timestamp: -1 });

    res.json({ transactions });
  } catch (error) {
    console.error("Error fetching merchant transactions:", error);
    res.status(500).json({ error: "Error fetching transactions" });
  }
});

// Get payment details
app.get("/payment-details/:paymentId", async (req, res) => {
  try {
    const pendingPayment = await PendingPayment.findOne({
      paymentId: req.params.paymentId,
    });
    if (!pendingPayment)
      return res.status(404).json({ error: "Payment not found" });

    const merchant = await Merchant.findOne({
      merchantId: pendingPayment.merchantId,
    });
    if (!merchant) return res.status(404).json({ error: "Merchant not found" });

    res.json({
      merchantName: merchant.name,
      amount: pendingPayment.amount,
      status: pendingPayment.status,
    });
  } catch (error) {
    console.error("Error fetching payment details:", error);
    res.status(500).json({ error: "Error fetching payment details" });
  }
});

// Process payment
app.post("/process-payment/:paymentId", async (req, res) => {
  try {
    const { studentNumber, password } = req.body;
    const pendingPayment = await PendingPayment.findOne({
      paymentId: req.params.paymentId,
    });
    if (!pendingPayment)
      return res.status(404).json({ error: "Payment not found" });
    if (pendingPayment.status !== "pending")
      return res.status(400).json({ error: "Payment already processed" });

    const student = await User.findOne({ studentNumber });
    if (!student) return res.status(404).json({ error: "Student not found" });

    const validPassword = await bcrypt.compare(password, student.password);
    if (!validPassword)
      return res.status(401).json({ error: "Invalid password" });

    // if (student.balance < pendingPayment.amount)
    //   return res.status(400).json({ error: "Insufficient funds" });

    const merchant = await Merchant.findOne({
      merchantId: pendingPayment.merchantId,
    });
    if (!merchant) return res.status(404).json({ error: "Merchant not found" });

    student.balance -= pendingPayment.amount;
    merchant.balance += pendingPayment.amount;

    await student.save();
    await merchant.save();

    const transaction = new Transaction({
      from: student.studentNumber,
      to: merchant.merchantId,
      amount: pendingPayment.amount,
      type: "merchant_payment",
    });
    await transaction.save();

    pendingPayment.status = "completed";
    await pendingPayment.save();

    res.json({
      message: "Payment successful",
      transaction: transaction.toObject(),
    });
  } catch (error) {
    console.error("Error processing payment:", error);
    res.status(500).json({ error: "Error processing payment" });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.info("SIGTERM signal received.");
  console.log("Closing HTTP server.");
  server.close(() => {
    console.log("HTTP server closed.");
    mongoose.connection.close(false, () => {
      console.log("MongoDB connection closed.");
      process.exit(0);
    });
  });
});
