const http = require("http");

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API_KEY = process.env.API_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const ADMIN_USER_ID = "5106935362";

if (!BOT_TOKEN || !CHAT_ID || !API_KEY || !WEBHOOK_SECRET) {
  console.error("Required environment variables are missing");
  process.exit(1);
}

const polls = new Map();
const answers = new Map();
const scores = new Map();
const pendingQuiz = new Map();

function nameOf(user) {
  return [user.first_name, user.last_name]
    .filter(Boolean).join(" ") || user.username || "عضو گروه";
}

function periodKeys(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kabul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  const month = `${p.year}-${p.month}`;

  const d = new Date(`${day}T00:00:00Z`);
  const weekday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - weekday + 3);

  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const wd = (first.getUTCDay() + 6) % 7;
  first.setUTCDate(first.getUTCDate() - wd + 3);

  const week = `${d.getUTCFullYear()}-W${String(
    1 + Math.round((d - first) / 604800000)
  ).padStart(2, "0")}`;

  return { daily: day, weekly: week, monthly: month };
}

function changeScore(user, delta, date) {
  const id = String(user.id);

  if (!scores.has(id)) {
    scores.set(id, {
      name: nameOf(user),
      daily: new Map(),
      weekly: new Map(),
      monthly: new Map()
    });
  }

  const record = scores.get(id);
  record.name = nameOf(user);
  const keys = periodKeys(date);

  for (const period of ["daily", "weekly", "monthly"]) {
    const key = keys[period];
    record[period].set(
      key,
      Math.max(0, (record[period].get(key) || 0) + delta)
    );
  }
}

function leaderboard(period) {
  const key = periodKeys()[period];

  const rows = [...scores.values()]
    .map(r => ({
      name: r.name,
      points: r[period].get(key) || 0
    }))
    .filter(r => r.points > 0)
    .sort((a, b) => b.points - a.points);

  if (!rows.length) {
    return "هنوز امتیازی ثبت نشده است.";
  }

  const medals = ["🥇", "🥈", "🥉"];

  return rows.slice(0, 20).map((r, i) =>
    `${medals[i] || (i + 1) + "."} ${r.name} — ${r.points} امتیاز`
  ).join("\n");
}

async function telegram(method, data) {
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }
  );

  const result = await response.json();

  if (!result.ok) {
    throw new Error(result.description || "Telegram error");
  }

  return result;
}

async function sendQuiz(data) {
  const result = await telegram("sendPoll", {
    chat_id: CHAT_ID,
    question: data.question,
    options: data.options.map(x => ({ text: x })),
    type: "quiz",
    is_anonymous: false,
    correct_option_id: data.correct_option_id
  });

  polls.set(result.result.poll.id, {
    correct_option_id: data.correct_option_id
  });

  return result;
}

async function handleUpdate(update) {
  if (update.poll_answer) {
    const vote = update.poll_answer;
    const poll = polls.get(vote.poll_id);

    if (!poll || !vote.user) return;
    if (String(vote.user.id) === ADMIN_USER_ID) return;

    const key = `${vote.poll_id}:${vote.user.id}`;
    const previous = answers.get(key);

    if (previous && previous.correct) {
      changeScore(previous.user, -1, previous.date);
    }

    const correct = vote.option_ids.includes(
      poll.correct_option_id
    );

    const now = new Date();

    if (correct) {
      changeScore(vote.user, 1, now);
    }

    answers.set(key, {
      user: vote.user,
      correct,
      date: now
    });

    return;
  }

  const message = update.message;
  if (!message || !message.text || !message.from) return;

  const userId = String(message.from.id);
  const command = message.text.trim()
    .split(/\s+/)[0].split("@")[0].toLowerCase();

  // پیام خصوصی مدیر
  if (message.chat.type === "private") {
    if (userId !== ADMIN_USER_ID) return;

    if (command === "/start") {
      await telegram("sendMessage", {
        chat_id: message.chat.id,
        text:
          "سلام داکتر صاحب احمدی!\n\n" +
          "برای ساخت آزمون جدید دستور /newquiz را بفرست.\n" +
          "برای لغو ساخت آزمون دستور /cancel را بفرست."
      });
      return;
    }

    if (command === "/cancel") {
      pendingQuiz.delete(userId);
      await telegram("sendMessage", {
        chat_id: message.chat.id,
        text: "ساخت آزمون لغو شد."
      });
      return;
    }

    if (command === "/newquiz") {
      pendingQuiz.set(userId, true);

      await telegram("sendMessage", {
        chat_id: message.chat.id,
        text:
          "📝 آزمون جدید\n\n" +
          "لطفاً معلومات را در ۶ خط بفرست:\n\n" +
          "خط ۱: سؤال\n" +
          "خط ۲ تا ۵: چهار گزینه\n" +
          "خط ۶: شماره پاسخ درست (۱ تا ۴)\n\n" +
          "مثال:\n" +
          "پنی‌سیلین در کدام خانواده است؟\n" +
          "ماکرولایدها\n" +
          "بتالاکتام‌ها\n" +
          "تتراسایکلین‌ها\n" +
          "آمینوگلیکوزیدها\n" +
          "۲"
      });
      return;
    }

    if (pendingQuiz.has(userId)) {
      const lines = message.text.trim()
        .split("\n")
        .map(x => x.trim())
        .filter(Boolean);

      if (lines.length !== 6) {
        await telegram("sendMessage", {
          chat_id: message.chat.id,
          text: "فرمت درست نیست. دقیقاً ۶ خط بفرست."
        });
        return;
      }

      const answerNumber = Number(lines[5]);

      if (!Number.isInteger(answerNumber) ||
          answerNumber < 1 || answerNumber > 4) {
        await telegram("sendMessage", {
          chat_id: message.chat.id,
          text: "شماره پاسخ درست باید بین ۱ تا ۴ باشد."
        });
        return;
      }

      try {
        await sendQuiz({
          question: lines[0],
          options: lines.slice(1, 5),
          correct_option_id: answerNumber - 1
        });

        pendingQuiz.delete(userId);

        await telegram("sendMessage", {
          chat_id: message.chat.id,
          text: "✅ آزمون با موفقیت در گروه منتشر شد."
        });
      } catch (error) {
        await telegram("sendMessage", {
          chat_id: message.chat.id,
          text: "خطا در انتشار آزمون: " + error.message
        });
      }
      return;
    }

    return;
  }

  // رتبه‌بندی در گروه
  if (String(message.chat.id) !== String(CHAT_ID)) return;

  const periods = {
    "/daily": ["daily", "رتبه‌بندی روزانه"],
    "/weekly": ["weekly", "رتبه‌بندی هفتگی"],
    "/monthly": ["monthly", "رتبه‌بندی ماهانه"]
  };

  if (!periods[command]) return;

  const [period, label] = periods[command];

  await telegram("sendMessage", {
    chat_id: message.chat.id,
    text: `🏆 ${label}\n\n${leaderboard(period)}`
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  );

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200);
    res.end("Quiz Ranking Bot is running!");
    return;
  }

  if (req.method === "GET" &&
      url.pathname === "/setup-webhook") {
    (async () => {
      const result = await telegram("setWebhook", {
        url: `${process.env.RENDER_EXTERNAL_URL}/telegram-webhook`,
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ["poll_answer", "message"]
      });

      res.writeHead(200, {
        "Content-Type": "application/json"
      });
      res.end(JSON.stringify(result));
    })().catch(error => {
      res.writeHead(500);
      res.end(error.message);
    });
    return;
  }

  if (req.method === "POST" &&
      url.pathname === "/telegram-webhook") {
    if (req.headers["x-telegram-bot-api-secret-token"]
        !== WEBHOOK_SECRET) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    let body = "";
    req.on("data", chunk => body += chunk);

    req.on("end", async () => {
      try {
        await handleUpdate(JSON.parse(body));
        res.writeHead(200);
        res.end("OK");
      } catch (error) {
        console.error(error);
        res.writeHead(500);
        res.end("Error");
      }
    });
    return;
  }

  if (req.method === "POST" &&
      url.pathname === "/send-quiz") {
    let body = "";

    req.on("data", chunk => body += chunk);

    req.on("end", async () => {
      try {
        if (req.headers["x-api-key"] !== API_KEY) {
          res.writeHead(401);
          res.end("Unauthorized");
          return;
        }

        const data = JSON.parse(body);

        if (!data.question ||
            !Array.isArray(data.options) ||
            data.options.length !== 4 ||
            !Number.isInteger(data.correct_option_id) ||
            data.correct_option_id < 0 ||
            data.correct_option_id > 3) {
          res.writeHead(400);
          res.end("Invalid quiz data");
          return;
        }

        const result = await sendQuiz(data);

        res.writeHead(200, {
          "Content-Type": "application/json"
        });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500);
        res.end(error.message);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Bot running on port ${PORT}`);
});
