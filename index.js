const express = require("express");
const chalk = require("chalk");
const con = require("./db/db");
const { io: Client } = require("socket.io-client");

const app = express();
app.use(express.json({ limit: "10mb" }));

// --- Connect to existing Socket.IO server ---
const SOCKET_SERVER_URL = "http://localhost:8184";
const socket = Client(SOCKET_SERVER_URL, {
  reconnectionAttempts: 5,
  reconnectionDelay: 2000,
});

socket.on("connect", () => {
  console.log(chalk.green(`Connected to Socket.IO server at ${SOCKET_SERVER_URL}`));
});
socket.on("disconnect", () => {
  console.log(chalk.red("Disconnected from Socket.IO server"));
});
socket.on("connect_error", (err) => {
  console.error(chalk.red(`Socket connection error: ${err.message}`));
});

// --- Webhook state ---
const webhookState = {
  reply: true,
  interested: true,
};

const counters = {
  reply_received: 0,
  lead_interested: 0,
};

// --- Logger utility for interested leads ---
async function logWebhook(event, payload) {
  counters[event]++;
  const count = counters[event];
  const timestamp = new Date().toLocaleString();

  console.log(chalk.cyan(`\n [${timestamp}] Webhook #${count} (${event})`));
  console.log(chalk.gray("────────────────────────────────────────────"));
  console.log(chalk.white(JSON.stringify(payload, null, 2)));
  console.log("payload email:", payload.lead_email);
  console.log(`Campaign ID: ${payload.campaign_id}`);

  if (!payload.lead_email || !payload.campaign_id) {
    console.log("Missing email or campaign_id, skipping insert");
    return;
  }

  const result = await addEmailToDatabase({
    email: payload.lead_email,
    campaign_id: payload.campaign_id,
  });

  // Emit socket event immediately after successful insert
  if (result) {
    console.log(chalk.green("New lead added — emitting socket event"));
    socket.emit("new_email_added", {
      message: "New lead interested added",
      email: payload.lead_email,
      campaign_id: payload.campaign_id,
    });
  }

  console.log(chalk.gray("────────────────────────────────────────────\n"));
}

async function logWebhookReply(event, payload) {
  counters[event]++;
  const count = counters[event];
  const timestamp = new Date().toLocaleString();

  console.log(chalk.cyan(`\n [${timestamp}] Webhook #${count} (${event})`));
  console.log(chalk.gray("────────────────────────────────────────────"));
  console.log(chalk.white(JSON.stringify(payload, null, 2)));
  console.log("payload email:", payload.lead_email);
  console.log(`Campaign ID: ${payload.campaign_id}`);
  console.log(chalk.gray("────────────────────────────────────────────\n"));
}

// --- Middleware to check if specific webhook is enabled ---
function checkWebhook(type) {
  return (req, res, next) => {
    if (!webhookState[type]) {
      console.log(
        chalk.yellow(`Ignored ${req.path} — ${type} listener disabled.`)
      );
      return res.status(503).json({ message: `${type} listener is disabled` });
    }
    next();
  };
}

// --- Webhook routes ---
app.post("/webhooks/reply", checkWebhook("reply"), async (req, res) => {
  res.sendStatus(200);
  await logWebhookReply("reply_received", req.body);
});

app.post("/webhooks/interested", checkWebhook("interested"), async (req, res) => {
  res.sendStatus(200);
  await logWebhook("lead_interested", req.body);
});

// --- Toggle routes ---
app.post("/toggle/reply/:state", (req, res) => {
  const { state } = req.params;
  webhookState.reply = state === "on";
  console.log(
    webhookState.reply
      ? chalk.green("Reply webhook ENABLED")
      : chalk.red("Reply webhook DISABLED")
  );
  res.json({
    message: `Reply webhook ${webhookState.reply ? "enabled" : "disabled"}`,
  });
});

app.post("/toggle/interested/:state", (req, res) => {
  const { state } = req.params;
  webhookState.interested = state === "on";
  console.log(
    webhookState.interested
      ? chalk.green("Interested webhook ENABLED")
      : chalk.red("Interested webhook DISABLED")
  );
  res.json({
    message: `Interested webhook ${webhookState.interested ? "enabled" : "disabled"}`,
  });
});

// --- Combined toggle for all ---
app.post("/toggle/all/:state", (req, res) => {
  const { state } = req.params;
  const enabled = state === "on";
  webhookState.reply = enabled;
  webhookState.interested = enabled;
  console.log(
    enabled
      ? chalk.green("All webhooks ENABLED")
      : chalk.red("All webhooks DISABLED")
  );
  res.json({ message: `All webhooks ${enabled ? "enabled" : "disabled"}` });
});

// --- Status route ---
app.get("/status", (req, res) => {
  res.json({
    webhooks: webhookState,
    counters,
  });
});

// --- Add email to database ---
async function addEmailToDatabase({ email, campaign_id }) {
  try {
    console.log(`Email: ${email}, Campaign ID: ${campaign_id}`);

    if (!email || !campaign_id) {
      console.log("Campaign ID and Email are required");
      return;
    }

    const query = `
      INSERT INTO tobe_processed_campaign_emails (
        campaign_id, email, created_at, updated_at
      )
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (campaign_id, email) DO NOTHING
      RETURNING id;
    `;

    const values = [campaign_id, email];
    const result = await con.query(query, values);

    if (result.rows.length > 0) {
      console.log("CampaignId and Email appended");
      return result.rows[0].id;
    } else {
      console.log("Combination already exists, skipping insert");
      return null;
    }
  } catch (error) {
    console.error("Error inserting email:", error);
  }
}

// --- Start Express server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(chalk.green(`Listening on port ${PORT}`));
  console.log(chalk.green("Reply and Interested webhooks are enabled at startup."));
});
