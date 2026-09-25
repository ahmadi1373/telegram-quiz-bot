const http = require("http");

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API_KEY = process.env.API_KEY;

async function sendQuiz(data) {
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendPoll`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        question: data.question,
        options: data.options,
        type: "quiz",
        is_anonymous: false,
        correct_option_id: data.correct_option_id,
        explanation: data.explanation || ""
      })
    }
  );

  return await response.json();
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Telegram Quiz Bot is running!");
    return;
  }

  if (req.method === "POST" && req.url === "/send-quiz") {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const key = req.headers["x-api-key"];

        if (API_KEY && key !== API_KEY) {
          res.writeHead(401, {
            "Content-Type": "application/json"
          });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }

        const data = JSON.parse(body);

        if (
          !data.question ||
          !Array.isArray(data.options) ||
          data.options.length < 2 ||
          data.options.length > 12 ||
          typeof data.correct_option_id !== "number"
        ) {
          res.writeHead(400, {
            "Content-Type": "application/json"
          });
          res.end(JSON.stringify({ error: "Invalid quiz data" }));
          return;
        }

        const result = await sendQuiz(data);

        res.writeHead(result.ok ? 200 : 500, {
          "Content-Type": "application/json"
        });

        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(500, {
          "Content-Type": "application/json"
        });

        res.end(
          JSON.stringify({
            error: error.message
          })
        );
      }
    });

    return;
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Telegram Quiz Bot is running on port ${PORT}`);
});
