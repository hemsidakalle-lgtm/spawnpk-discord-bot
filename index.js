import "dotenv/config";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

/*
  CONFIG
*/
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const BASE_SITE = "https://v0-player-tracker-website.vercel.app";

/*
  CREATE DISCORD CLIENT
*/
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/*
  HELPERS
*/
function getRangeFromCommand(command) {
  const cmd = command.toLowerCase();
  if (cmd.includes("daily")) return "daily";
  if (cmd.includes("weekly")) return "weekly";
  if (cmd.includes("monthly") || cmd.includes("montly")) return "monthly";
  return null;
}

/*
  FETCH LEADERBOARD FROM YOUR WEBSITE
*/
async function fetchLeaderboard(range) {
  const url = `${BASE_SITE}/api/leaderboard?range=${range}&limit=3`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch leaderboard (${res.status})`);
  }

  return await res.json();
}

/*
  LOOKUP PLAYER ON SPAWNPK
*/
async function lookupSpawnPK(username) {
  const url = `https://spawnpk.net/highscores/index.php?name=${encodeURIComponent(
    username
  )}&submit=Search`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch SpawnPK highscores");

  const html = await res.text();
  const $ = cheerio.load(html);

  let foundRow = null;

  $("tr").each((_, tr) => {
    const text = $(tr).text().toLowerCase();
    if (text.includes(username.toLowerCase())) {
      foundRow = $(tr);
      return false;
    }
  });

  if (!foundRow) return null;

  const cols = foundRow
    .find("td")
    .map((_, td) => $(td).text().trim())
    .get();

  return {
    username,
    mode: cols[2] || "Unknown",
    kills: cols[3] || "?",
    deaths: cols[4] || "?",
    kdr: cols[5] || "?",
    streak: cols[6] || "?",
    elo: cols[7] || "?",
    url
  };
}

/*
  MESSAGE HANDLER
*/
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!")) return;

  const parts = message.content.trim().split(/\s+/);
  const command = parts[0];
  const arg = parts.slice(1).join(" ");

  /*
    LEADERBOARD COMMANDS
  */
  if (command.toLowerCase().startsWith("!leaderboard")) {
    const range = getRangeFromCommand(command);
    if (!range) {
      return message.reply(
        "❌ Use: !leaderboardDaily | !leaderboardWeekly | !leaderboardMonthly"
      );
    }

    try {
      const data = await fetchLeaderboard(range);

      const embed = new EmbedBuilder()
        .setTitle(`🏆 ${range.toUpperCase()} Leaderboard (Top 3)`)
        .setDescription("Top players by **kills gained (+)**")
        .setFooter({ text: "Source: v0-player-tracker-website.vercel.app" })
        .setTimestamp(new Date());

      if (!data.entries || data.entries.length === 0) {
        embed.addFields({
          name: "No data",
          value: "No leaderboard data available."
        });
      } else {
        data.entries.slice(0, 3).forEach((p, i) => {
          embed.addFields({
            name: `#${i + 1} ${p.username}`,
            value: `+Kills: **${p.killsGained}**`,
            inline: false
          });
        });
      }

      await message.reply({ embeds:
