const commands = {
  hilfe: ({ joinWord = "giveaway" } = {}) =>
    `Verfügbare Befehle: !help (!hilfe), !discord (!dc), !socials, !würfel, !timer, !latenz, !wt (!watchtime), !giveawaystart. Teilnahme am Giveaway mit ${joinWord} (oder !${joinWord})`,

  help: ({ joinWord = "giveaway" } = {}) => commands.hilfe({ joinWord }),

  discord: () =>
    process.env.DISCORD_INVITE
      ? `Discord: ${process.env.DISCORD_INVITE}`
      : "Discord-Link wurde noch nicht eingerichtet. Kanalinhaber: DISCORD_INVITE in .env setzen.",

  dc: () => commands.discord(),

  socials: () =>
    process.env.SOCIALS_URL
      ? `Socials: ${process.env.SOCIALS_URL}`
      : "Socials-Link wurde noch nicht eingerichtet. Kanalinhaber: SOCIALS_URL in .env setzen.",

  würfel: ({ args }) => {
    const sidesRaw = Number.parseInt(args[0] || "6", 10);
    const sides = Number.isFinite(sidesRaw) ? Math.min(100, Math.max(2, sidesRaw)) : 6;
    return `🎲 ${Math.floor(Math.random() * sides) + 1} (W${sides})`;
  },

};

module.exports = { commands };
