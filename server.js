require("dotenv").config();
const express = require("express"),
  fs = require("fs"),
  mongoose = require("mongoose"),
  axios = require("axios"),
  { URLSearchParams: URLSearchParams } = require("url"),
  {
    Client: Client,
    GatewayIntentBits: GatewayIntentBits,
    REST: REST,
    Routes: Routes,
    SlashCommandBuilder: SlashCommandBuilder,
    EmbedBuilder: EmbedBuilder,
    ActionRowBuilder: ActionRowBuilder,
    ButtonBuilder: ButtonBuilder,
    ButtonStyle: ButtonStyle,
  } = require("discord.js"),
  { GoogleGenAI: GoogleGenAI, Modality: Modality } = require("@google/genai"),
  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
  }),
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
  commands = [
    new SlashCommandBuilder()
      .setName("image")
      .setDescription("Generate an image from a prompt using Astranix Ghiblify")
      .addStringOption((e) =>
        e
          .setName("prompt")
          .setDescription("What do you want to see?")
          .setRequired(!0)
      ),
    new SlashCommandBuilder()
      .setName("ghibli")
      .setDescription("Transform your image into Studio Ghibli style!")
      .addAttachmentOption((e) =>
        e
          .setName("image")
          .setDescription("The image to transform into Ghibli style")
          .setRequired(!0)
      ),
    new SlashCommandBuilder()
      .setName("authorize")
      .setDescription(
        "Authorize your Discord account to use premium commands."
      ),
    new SlashCommandBuilder()
      .setName("unblacklist")
      .setDescription("Removes a user from the bot's blacklist (Admin only).")
      .addStringOption((e) =>
        e
          .setName("userid")
          .setDescription("The Discord User ID of the user to unblacklist.")
          .setRequired(!0)
      ),
  ].map((e) => e.toJSON()),
  rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  try {
    console.log("Starting refresh of slash commands..."),
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
        body: commands,
      }),
      console.log("✅ Slash commands registered globally");
  } catch (e) {
    console.error("❌ Error registering commands:", e);
  }
})(),
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch((e) => console.error("❌ Could not connect to MongoDB:", e));
const UserSchema = new mongoose.Schema({
    discordId: { type: String, required: !0, unique: !0 },
    accessToken: { type: String, required: !0 },
    refreshToken: { type: String, required: !0 },
    expiresAt: { type: Date, required: !0 },
    inRequiredGuild: { type: Boolean, default: !1 },
    isBlacklisted: { type: Boolean, default: !1 },
    email: String,
    username: String,
    avatar: String,
    banner: String,
  }),
  User = mongoose.model("User", UserSchema),
  DISCORD_OAUTH_SCOPES = ["identify", "email", "guilds"],
  DISCORD_OAUTH_URL = `https://discord.com/api/oauth2/authorize?client_id=${
    process.env.CLIENT_ID
  }&redirect_uri=${encodeURIComponent(
    process.env.REDIRECT_URI
  )}&response_type=code&scope=${DISCORD_OAUTH_SCOPES.join("%20")}`,
  REQUIRED_GUILD_ID = process.env.REQUIRED_GUILD_ID,
  ADMIN_USER_ID = process.env.ADMIN_USER_ID;
async function refreshToken(e, a) {
  try {
    const t = new URLSearchParams();
    t.append("client_id", process.env.CLIENT_ID),
      t.append("client_secret", process.env.CLIENT_SECRET),
      t.append("grant_type", "refresh_token"),
      t.append("refresh_token", a);
    const { data: n } = await axios.post(
        "https://discord.com/api/oauth2/token",
        t.toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      ),
      i = new Date(Date.now() + 1e3 * n.expires_in);
    return (
      await User.updateOne(
        { discordId: e },
        {
          accessToken: n.access_token,
          refreshToken: n.refresh_token,
          expiresAt: i,
        }
      ),
      console.log(`✅ Access token refreshed for user ${e}`),
      n.access_token
    );
  } catch (a) {
    return (
      console.error(
        `❌ Failed to refresh token for user ${e}:`,
        a.response?.data || a.message
      ),
      await User.updateOne({ discordId: e }, { isBlacklisted: !0 }),
      null
    );
  }
}
async function getUserDiscordData(e) {
  try {
    const { data: a } = await axios.get("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${e}` },
    });
    return a;
  } catch (e) {
    return (
      console.error(
        "❌ Failed to fetch user Discord data:",
        e.response?.data || e.message
      ),
      null
    );
  }
}
async function checkIfUserInGuild(e, a) {
  try {
    const { data: t } = await axios.get(
      "https://discord.com/api/users/@me/guilds",
      { headers: { Authorization: `Bearer ${e}` } }
    );
    return t.some((e) => e.id === a);
  } catch (e) {
    return (
      console.error(
        `❌ Failed to check user guild membership for guild ${a}:`,
        e.response?.data || e.message
      ),
      !1
    );
  }
}
async function checkUserAuthorization(e) {
  const a = e.user.id;
  let t = await User.findOne({ discordId: a });
  if (t && t.isBlacklisted)
    return (
      await e.editReply({
        content:
          "❌ Anda telah melakukan kecurangan. Anda tidak dapat menggunakan perintah ini. Silakan hubungi admin.",
        ephemeral: !0,
      }),
      !1
    );
  if (!t || !t.accessToken) {
    const a = new ButtonBuilder()
        .setLabel("Authorize with Discord")
        .setStyle(ButtonStyle.Link)
        .setURL(DISCORD_OAUTH_URL),
      t = new ActionRowBuilder().addComponents(a);
    return (
      await e.editReply({
        content:
          "⚠️ Anda perlu mengotorisasi bot untuk menggunakan perintah ini. Klik tombol di bawah untuk otorisasi.",
        components: [t],
        ephemeral: !0,
      }),
      !1
    );
  }
  if (new Date() > t.expiresAt) {
    console.log(
      `⌛ Access token expired for user ${a}. Attempting to refresh...`
    );
    if (!(await refreshToken(a, t.refreshToken)))
      return (
        await e.editReply({
          content:
            "❌ Sesi Anda telah kedaluwarsa dan gagal diperbarui. Anda perlu mengotorisasi ulang bot. Klik tombol di bawah untuk otorisasi.",
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setLabel("Authorize with Discord")
                .setStyle(ButtonStyle.Link)
                .setURL(DISCORD_OAUTH_URL)
            ),
          ],
          ephemeral: !0,
        }),
        !1
      );
    t = await User.findOne({ discordId: a });
  }
  if (!(await checkIfUserInGuild(t.accessToken, REQUIRED_GUILD_ID))) {
    t.isBlacklisted ||
      (await User.updateOne({ discordId: a }, { isBlacklisted: !0 }),
      (t.isBlacklisted = !0),
      console.log(`User ${a} blacklisted for leaving required guild.`));
    const n = new ButtonBuilder()
      .setLabel("Join Required Server")
      .setStyle(ButtonStyle.Link)
      .setURL("https://discord.gg/zVPD4Ng2fM");
    return (
      await e.editReply({
        content:
          "⚠️ Anda harus menjadi anggota server khusus kami untuk menggunakan perintah ini. Anda telah ditambahkan ke daftar hitam sampai Anda bergabung kembali.",
        components: [new ActionRowBuilder().addComponents(n)],
        ephemeral: !0,
      }),
      !1
    );
  }
  return (
    t.isBlacklisted &&
      (await User.updateOne({ discordId: a }, { isBlacklisted: !1 }),
      (t.isBlacklisted = !1),
      console.log(`User ${a} unblacklisted for rejoining required guild.`)),
    !0
  );
}
const regenerationContexts = new Map(),
  CONTEXT_EXPIRATION_TIME = 18e5;
async function generateAndReplyImage(e, a, t, n = null) {
  let i = null;
  try {
    let r = "",
      o = "",
      s = [],
      d = "🖼️ Your Image";
    if ("image" === a)
      (r = `${t}, no text, no words, no signatures, no logos, clean image`),
        (o = t),
        (s = [{ text: r }]),
        (d = "🖼️ Generated Image");
    else {
      if ("ghibli" !== a)
        throw new Error("Unknown command type for image generation.");
      {
        if (!n || !n.contentType.startsWith("image/"))
          throw new Error("Invalid image attachment for Ghibli command.");
        const e = await fetch(n.url),
          a = await e.arrayBuffer(),
          t = Buffer.from(a).toString("base64");
        (r =
          "Transform this image into a beautiful Studio Ghibli animation style. Ghibli images should maintain the pose, posture, body, hands, face, feet, head, and facial expression of the main image. Make sure the overall composition and elements in the background are also arranged to fit the Ghibli aesthetic while maintaining the original arrangement. No text, no words, no signatures, no logos, clean image."),
          (o = "Image transformed into Studio Ghibli style."),
          (d = "🌸 Ghibli Style Image"),
          (s = [
            { text: r },
            { inlineData: { mimeType: n.contentType, data: t } },
          ]);
      }
    }
    const l = "./output";
    fs.existsSync(l) || fs.mkdirSync(l, { recursive: !0 });
    const c = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp",
      contents: s,
      config: { responseModalities: [Modality.TEXT, Modality.IMAGE] },
    });
    if (
      !c ||
      !c.candidates ||
      0 === c.candidates.length ||
      !c.candidates[0].content
    )
      return (
        console.error(
          "❌ AI response is invalid or empty:",
          JSON.stringify(c, null, 2)
        ),
        void (await e.editReply(
          "❌ Gagal menghasilkan gambar. Respons dari AI tidak valid atau kosong. Ini mungkin karena pelanggaran kebijakan atau kegagalan internal."
        ))
      );
    let u = null,
      m = null;
    for (const e of c.candidates[0].content.parts)
      e.inlineData && e.inlineData.mimeType.startsWith("image/")
        ? (u = Buffer.from(e.inlineData.data, "base64"))
        : e.text && (m = e.text);
    if (!u)
      return (
        console.error(
          "❌ No image data found in response parts:",
          JSON.stringify(c, null, 2)
        ),
        void (await e.editReply(
          m
            ? `❌ AI merespons dengan teks: "${m}". Tidak ada gambar dihasilkan.`
            : "❌ Gagal menghasilkan gambar. Gemini tidak mengembalikan data gambar yang diharapkan."
        ))
      );
    const g = `generated-${Date.now()}.png`;
    (i = `${l}/${g}`),
      fs.writeFileSync(i, u),
      console.log(`✅ Gambar disimpan secara lokal: ${i}`);
    const p = new Date(),
      h = {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: !1,
        timeZone: "Asia/Jakarta",
      },
      k = {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "Asia/Jakarta",
      },
      f = p.toLocaleTimeString("en-US", h),
      w = `Generated by Astranix Ghiblify • ${p.toLocaleDateString(
        "en-US",
        k
      )} at ${f} WIB`,
      y = new EmbedBuilder()
        .setTitle(d)
        .setDescription(`**Prompt:** \`${o}\`\n`)
        .setImage(`attachment://${g}`)
        .setFooter({ text: w });
    "ghibli" === a &&
      n &&
      y.setDescription(
        `**Style:** Ghibli Transformation\n**Original Image:** ${n.name}`
      );
    const I =
      Date.now().toString() + Math.random().toString(36).substring(2, 10);
    regenerationContexts.set(I, {
      command: a,
      prompt: t,
      geminiPrompt: r,
      inputAttachment:
        "ghibli" === a
          ? { url: n.url, name: n.name, contentType: n.contentType }
          : void 0,
    }),
      setTimeout(() => {
        regenerationContexts.delete(I), console.log(`Context ${I} removed.`);
      }, 18e5);
    const b = new ButtonBuilder()
        .setCustomId(`regenerate_${I}`)
        .setLabel("Regenerate")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🔄"),
      R = new ActionRowBuilder().addComponents(b);
    await e.editReply({
      embeds: [y],
      files: [{ attachment: i, name: g }],
      components: [R],
    });
  } catch (a) {
    console.error("❌ Error processing command:", a);
    let t = "❌ Terjadi kesalahan tak terduga. Silakan coba lagi nanti.";
    if (e.replied || e.deferred)
      if (e.deferred)
        await e.editReply(
          `${t} Silakan buka tiket di [Astranix #adaastranix](https://discord.gg/zVPD4Ng2fM)`
        );
      else
        try {
          await e.followUp({
            content: `${t} Silakan buka tiket di [Astranix #adaastranix](https://discord.gg/zVPD4Ng2fM)`,
            ephemeral: !0,
          });
        } catch (e) {
          console.error("❌ Fatal: Could not followUp after error:", e);
        }
    else
      try {
        await e.deferReply({ ephemeral: !0 }),
          await e.editReply(
            `${t} Silakan buka tiket di [Astranix #adaastranix](https://discord.gg/zVPD4Ng2fM)`
          );
      } catch (e) {
        console.error(
          "❌ Fatal: Could not defer or reply to interaction after error:",
          e
        );
      }
  } finally {
    i &&
      fs.existsSync(i) &&
      setTimeout(() => {
        try {
          fs.unlinkSync(i), console.log(`✅ File ${i} berhasil dihapus.`);
        } catch (e) {
          console.error(`❌ Gagal menghapus file ${i}:`, e);
        }
      }, 1e4);
  }
}
client.on("interactionCreate", async (e) => {
  if (e.isChatInputCommand()) {
    if ("authorize" === e.commandName) {
      await e.deferReply({ ephemeral: !0 });
      const a = new ButtonBuilder()
          .setLabel("Authorize with Discord")
          .setStyle(ButtonStyle.Link)
          .setURL(DISCORD_OAUTH_URL),
        t = new ActionRowBuilder().addComponents(a);
      return void (await e.editReply({
        content:
          "Klik tombol di bawah untuk mengotorisasi bot dan mengaktifkan akses ke perintah premium.",
        components: [t],
      }));
    }
    if ("unblacklist" === e.commandName) {
      if ((await e.deferReply({ ephemeral: !0 }), e.user.id !== ADMIN_USER_ID))
        return void (await e.editReply(
          "❌ Anda tidak memiliki izin untuk menggunakan perintah ini."
        ));
      const a = e.options.getString("userid");
      try {
        const t = await User.findOne({ discordId: a });
        if (!t)
          return void (await e.editReply(
            `⚠️ Pengguna dengan ID **${a}** tidak ditemukan dalam database bot.`
          ));
        if (!t.isBlacklisted)
          return void (await e.editReply(
            `ℹ️ Pengguna dengan ID **${a}** saat ini tidak berada dalam daftar hitam.`
          ));
        await User.updateOne(
          { discordId: a },
          { isBlacklisted: !1, inRequiredGuild: !0 }
        ),
          await e.editReply(
            `✅ Pengguna dengan ID **${a}** telah berhasil dihapus dari daftar hitam.`
          ),
          console.log(`User ${a} unblacklisted by admin ${e.user.tag}`);
      } catch (t) {
        console.error(`❌ Error unblacklisting user ${a}:`, t),
          await e.editReply(
            `❌ Terjadi kesalahan saat mencoba menghapus pengguna dari daftar hitam: ${t.message}`
          );
      }
      return;
    }
    await e.deferReply();
    if (!(await checkUserAuthorization(e))) return;
    if ("image" === e.commandName) {
      const a = e.options.getString("prompt");
      await generateAndReplyImage(e, "image", a);
    } else if ("ghibli" === e.commandName) {
      const a = e.options.getAttachment("image");
      await generateAndReplyImage(e, "ghibli", null, a);
    }
  } else if (e.isButton() && e.customId.startsWith("regenerate_")) {
    await e.deferReply();
    if (!(await checkUserAuthorization(e))) return;
    try {
      const a = e.customId.replace("regenerate_", ""),
        t = regenerationContexts.get(a);
      if (!t)
        return void (await e.editReply(
          "❌ Konteks regenerasi tidak ditemukan atau sudah kedaluwarsa (lebih dari 30 menit). Silakan jalankan perintah baru."
        ));
      await generateAndReplyImage(e, t.command, t.prompt, t.inputAttachment);
    } catch (a) {
      console.error("❌ Error during regeneration:", a),
        e.replied || e.deferred
          ? e.deferred
            ? await e.editReply(
                "❌ Gagal meregenerasi gambar. Terjadi kesalahan internal."
              )
            : await e.followUp({
                content:
                  "❌ Gagal meregenerasi gambar. Terjadi kesalahan internal.",
                ephemeral: !0,
              })
          : await e.editReply(
              "❌ Gagal meregenerasi gambar. Terjadi kesalahan internal."
            );
    }
  }
}),
  client.once("ready", () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
  }),
  client.login(process.env.DISCORD_TOKEN);
const app = express();
app.get("/", (e, a) =>
  a.send("Image Bot is alive and listening for OAuth2 callbacks.")
),
  app.get("/oauth-callback", async (e, a) => {
    const t = e.query.code;
    if (!t) return a.status(400).send("No authorization code provided.");
    try {
      const e = new URLSearchParams();
      e.append("client_id", process.env.CLIENT_ID),
        e.append("client_secret", process.env.CLIENT_SECRET),
        e.append("grant_type", "authorization_code"),
        e.append("code", t),
        e.append("redirect_uri", process.env.REDIRECT_URI),
        e.append("scope", DISCORD_OAUTH_SCOPES.join(" "));
      const n = await axios.post(
          "https://discord.com/api/oauth2/token",
          e.toString(),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        ),
        { access_token: i, refresh_token: r, expires_in: o } = n.data,
        s = new Date(Date.now() + 1e3 * o),
        d = await getUserDiscordData(i);
      if (!d)
        return a.status(500).send("Failed to retrieve user data from Discord.");
      const l = await checkIfUserInGuild(i, REQUIRED_GUILD_ID);
      await User.findOneAndUpdate(
        { discordId: d.id },
        {
          accessToken: i,
          refreshToken: r,
          expiresAt: s,
          inRequiredGuild: l,
          isBlacklisted: !l,
          email: d.email,
          username: `${d.username}#${d.discriminator}`,
          avatar: d.avatar,
          banner: d.banner,
        },
        { upsert: !0, new: !0 }
      );
      let c = `✅ Otorisasi berhasil untuk **${d.username}**. Anda sekarang dapat menggunakan perintah premium!`;
      l ||
        (c +=
          '<br>⚠️ Anda harus bergabung dengan server khusus kami untuk menggunakan perintah ini. Silakan bergabung di: <a href="https://discord.gg/zVPD4Ng2fM">Astranix #adaastranix</a>'),
        a.send(c);
    } catch (e) {
      console.error("❌ OAuth callback error:", e.response?.data || e.message),
        a
          .status(500)
          .send("❌ Gagal mengotorisasi akun Discord Anda. Silakan coba lagi.");
    }
  }),
  app.listen(3e3, () =>
    console.log("🌐 Express server running on port 3000 for OAuth callback.")
  );
