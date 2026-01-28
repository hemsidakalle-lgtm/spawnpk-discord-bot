import "dotenv/config";
import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const BASE_SITE = "https://v0-player-tracker-website.vercel.app";

if (!DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN missing. Add it in Railway → Variables.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --------------------
// LEADERBOARD (your API)
// --------------------
async function fetchLeaderboard(period) {
  const url = `${BASE_SITE}/api/leaderboard?period=${period}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Leaderboard API error (${res.status})`);
  return await res.json();
}

function top3ByKillsChange(players) {
  return [...players]
    .filter(p => (p.killsChange ?? 0) > 0)   // only players who gained kills
    .sort((a, b) => (b.killsChange ?? 0) - (a.killsChange ?? 0))
    .slice(0, 3);
}


async function sendLeaderboard(message, period, label) {
  const data = await fetchLeaderboard(period);

  // Your API shape: { players: [...], stats: {...} }
  const players = Array.isArray(data.players) ? data.players : [];
  const top3 = top3ByKillsChange(players);

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${label} Leaderboard (Top 3)`)
    .setDescription("Top 3 players by **Period Kills (+)**")
    .setFooter({ text: `Source: ${BASE_SITE}` })
    .setTimestamp(new Date());

  if (top3.length === 0) {
    embed.addFields({ name: "No data", value: "No players found." });
    return message.reply({ embeds: [embed] });
  }

  top3.forEach((p, i) => {
    const name = p.displayName || p.username || "Unknown";
    const plusKills = p.killsChange ?? 0;

    embed.addFields({
      name: `#${i + 1} ${name}`,
value:
  `🟢 **Period Kills:** +${plusKills}\n` +
  `🔵 **Total Kills:** ${p.kills ?? "?"}\n` +
  `🔴 **Total Deaths:** ${p.deaths ?? "?"}\n` +
  `📊 **KDR:** ${p.kdr ?? "?"}\n` +
  `🏅 **ELO:** ${p.elo ?? "?"}`,

      inline: false,
    });
  });

  return message.reply({ embeds: [embed] });
}

// --------------------
// LOOKUP (SpawnPK)
// --------------------
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

  // Based on your earlier SpawnPK example:
  // [name, mode, kills, deaths, kdr, streak, elo] can vary — this is best effort.
 return {
  username,
  mode: cols[1] || "Unknown",
  kills: cols[2] || "?",
  deaths: cols[3] || "?",
  kdr: cols[4] || "?",
  streak: cols[5] || "?",
  elo: cols[6] || "?",
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
    // Your new commands:
    if (cmd === "!leaderd") return await sendLeaderboard(message, "24h", "DAILY (24h)");
    if (cmd === "!leaderw") return await sendLeaderboard(message, "7d", "WEEKLY (7d)");
    if (cmd === "!leaderm") return await sendLeaderboard(message, "30d", "MONTHLY (30d)");

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
