import "dotenv/config";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const BASE_SITE = "https://v0-player-tracker-website.vercel.app";

if (!DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN missing. Add it in Railway Variables.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ---- Fetch leaderboard from your existing API ----
// period: "24h" | "7d" | "30d"
async function fetchLeaderboard(period) {
  const url = `${BASE_SITE}/api/leaderboard?period=${period}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Leaderboard API error (${res.status})`);
  return await res.json();
}

// Try to normalize different JSON shapes that your API might return.
function extractEntries(data) {
  if (!data) return [];

  // Common shapes:
  // 1) { entries: [...] }
  // 2) { leaderboard: [...] }
  // 3) { data: [...] }
  // 4) [...] (array root)
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.entries)) return data.entries;
  if (Array.isArray(data.leaderboard)) return data.leaderboard;
  if (Array.isArray(data.data)) return data.data;

  return [];
}

function getUsername(row) {
  return row.username || row.user || row.name || row.player || "Unknown";
}

function getPeriodKills(row) {
  // Your UI shows "Period Kills" like +25
  // Possible keys:
  return (
    row.periodKills ??
    row.period_kills ??
    row.killsGained ??
    row.kills_gained ??
    row.deltaKills ??
    row.delta_kills ??
    row.killsDelta ??
    row.kills_delta ??
    0
  );
}

function getTotalKills(row) {
  return row.kills ?? row.totalKills ?? row.total_kills ?? null;
}

function getTotalDeaths(row) {
  return row.deaths ?? row.totalDeaths ?? row.total_deaths ?? null;
}

function getKdr(row) {
  return row.kdr ?? row.KDR ?? null;
}

async function sendLeaderboard(message, period, label) {
  const data = await fetchLeaderboard(period);
  const entries = extractEntries(data);

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${label} Leaderboard (Top 3)`)
    .setDescription("Top 3 players by **Period Kills (+)**")
    .setFooter({ text: `Source: ${BASE_SITE}` })
    .setTimestamp(new Date());

  if (!entries.length) {
    embed.addFields({ name: "No data", value: "No leaderboard entries found." });
    return message.reply({ embeds: [embed] });
  }

  entries.slice(0, 3).forEach((row, i) => {
    const username = getUsername(row);
    const periodKills = getPeriodKills(row);
    const kills = getTotalKills(row);
    const deaths = getTotalDeaths(row);
    const kdr = getKdr(row);

    // Build a nice value string even if some fields are missing
    const lines = [];
    lines.push(`**Period Kills:** +${periodKills}`);

    if (kills !== null) lines.push(`**Total Kills:** ${kills}`);
    if (deaths !== null) lines.push(`**Total Deaths:** ${deaths}`);
    if (kdr !== null) lines.push(`**KDR:** ${kdr}`);

    embed.addFields({
      name: `#${i + 1} ${username}`,
      value: lines.join("\n"),
      inline: false,
    });
  });

  return message.reply({ embeds: [embed] });
}

// ---- SpawnPK lookup ----
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
    url,
  };
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!")) return;

  const [command, ...args] = message.content.trim().split(/\s+/);
  const cmd = command.toLowerCase();
  const arg = args.join(" ").trim();

  try {
    // New leaderboard commands:
    if (cmd === "!leaderd") return await sendLeaderboard(message, "24h", "DAILY (24h)");
    if (cmd === "!leaderw") return await sendLeaderboard(message, "7d", "WEEKLY (7d)");
    if (cmd === "!leaderm") return await sendLeaderboard(message, "30d", "MONTHLY (30d)");

    // Lookup:
    if (cmd === "!lookup") {
      if (!arg) return message.reply("❌ Usage: !lookup <username>");

      const stats = await lookupSpawnPK(arg);
      if (!stats) return message.reply(`❌ Player **${arg}** not found.`);

      const embed = new EmbedBuilder()
        .setTitle(`🔍 ${stats.username}`)
        .setURL(stats.url)
        .addFields(
          { name: "Mode", value: String(stats.mode), inline: true },
          { name: "Kills", value: String(stats.kills), inline: true },
          { name: "Deaths", value: String(stats.deaths), inline: true },
          { name: "KDR", value: String(stats.kdr), inline: true },
          { name: "Streak", value: String(stats.streak), inline: true },
          { name: "ELO", value: String(stats.elo), inline: true }
        )
        .setFooter({ text: "Source: SpawnPK highscores" })
        .setTimestamp(new Date());

      return message.reply({ embeds: [embed] });
    }
  } catch (err) {
    return message.reply(`❌ Error: ${err.message}`);
  }
});

client.once("ready", () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);
