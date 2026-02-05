import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import compression from "compression";
import nodemailer from "nodemailer";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const app = express();

/* ================= BASIC SECURITY ================= */
app.use(helmet());
app.use(compression());
app.disable("x-powered-by");

/* ================= CORS (NODE 18/20/24 SAFE) ================= */
const allowedOrigins = [
  "http://localhost:5173",       // local dev
  "https://tomscompliance.com",  // production
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // Postman / server calls
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS blocked"));
    },
    methods: ["GET", "POST"],
  })
);

/* ================= BODY PARSER ================= */
app.use(express.json({ limit: "10kb" }));

/* ================= RATE LIMIT ================= */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

/* ================= HEALTH CHECK ================= */
app.get("/", (_, res) => {
  res.status(200).send("API LIVE 🚀");
});

/* ================= NODEMAILER ================= */
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Gmail App Password
  },
});

transporter.verify((err) => {
  if (err) {
    console.error("❌ SMTP ERROR:", err.message);
  } else {
    console.log("✅ SMTP READY – Gmail connected");
  }
});

/* ================= GOOGLE SHEETS ================= */
const auth = new google.auth.JWT({
  email: process.env.GOOGLE_CLIENT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

await auth.authorize();

const sheets = google.sheets({
  version: "v4",
  auth,
});

async function saveToGoogleSheet({ name, phone, service, date, time }) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Sheet1!A:F",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [
          name,
          phone,
          service,
          date,
          time,
          new Date().toLocaleString(),
        ],
      ],
    },
  });
}

/* ================= BOOK FREE CALL ================= */
app.post("/api/book-call", async (req, res) => {
  try {
    const { name, phone, service, date, time } = req.body;

    if (!name || !phone || !service || !date || !time) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const cleanPhone = phone.replace(/[^0-9+]/g, "");

    await saveToGoogleSheet({ name, phone, service, date, time });

    await transporter.sendMail({
      from: `"TOMS Compliance" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: "📞 New Free Call Booking",
      html: `
      <div style="font-family:Arial;background:#f4f6f8;padding:20px">
        <div style="max-width:600px;margin:auto;background:#fff;border-radius:8px">
          <div style="background:#0f172a;color:#fff;padding:16px">
            <h2>📞 New Free Call Booking</h2>
          </div>
          <div style="padding:20px">
            <p><b>Name:</b> ${name}</p>
            <p><b>Phone:</b> ${phone}</p>
            <p><b>Service:</b> ${service}</p>
            <p><b>Date:</b> ${date}</p>
            <p><b>Time:</b> ${time}</p>
            <a href="tel:${cleanPhone}"
               style="display:inline-block;margin-top:15px;background:#16a34a;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">
              📞 Call Customer
            </a>
          </div>
        </div>
      </div>
      `,
    });

    res.json({
      success: true,
      message: "Booking saved & email sent",
    });
  } catch (error) {
    console.error("❌ API ERROR:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
