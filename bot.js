const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const TOKEN = process.env.BOT_TOKEN || 'MTQ4MDI5NzEzMzM4MjA0MTc4MA.GwIC9f.De5h6rctZ0Y6VYNXjVwvUnP5qxNPkxgrbZM1JM';
const CLIENT_ID = process.env.CLIENT_ID || '148029713338204178';

// In-memory bill storage
const bills = new Map();

function generateId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Slash command definitions
const commands = [
  new SlashCommandBuilder()
    .setName('split')
    .setDescription('Split a bill among people')
    .addStringOption(opt => opt.setName('name').setDescription('Bill name').setRequired(true))
    .addNumberOption(opt => opt.setName('total').setDescription('Total amount').setRequired(true))
    .addStringOption(opt => opt.setName('people').setDescription('Mention people to split with e.g. @Alex @Mia').setRequired(true)),

  new SlashCommandBuilder()
    .setName('paid')
    .setDescription('Mark yourself as paid on a bill')
    .addStringOption(opt => opt.setName('id').setDescription('Bill ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('remind')
    .setDescription('Remind everyone who still owes on a bill')
    .addStringOption(opt => opt.setName('id').setDescription('Bill ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check the status of a bill')
    .addStringOption(opt => opt.setName('id').setDescription('Bill ID').setRequired(true)),

  new SlashCommandBuilder()
    .setName('bills')
    .setDescription('List all active bills in this server'),
].map(cmd => cmd.toJSON());

// Register commands
const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Slash commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
})();

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

client.once('ready', () => {
  console.log(`🪶 RAVEN is online as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // /split
  if (commandName === 'split') {
    const name = interaction.options.getString('name');
    const total = interaction.options.getNumber('total');
    const peopleRaw = interaction.options.getString('people');

    // Extract mentioned user IDs
    const mentionRegex = /<@!?(\d+)>/g;
    const mentionedIds = [];
    let match;
    while ((match = mentionRegex.exec(peopleRaw)) !== null) {
      mentionedIds.push(match[1]);
    }

    if (mentionedIds.length === 0) {
      return interaction.reply({ content: '❌ Please mention at least one person using @username.', ephemeral: true });
    }

    const id = generateId();
    const perPerson = (total / mentionedIds.length).toFixed(2);
    const owers = {};
    mentionedIds.forEach(uid => { owers[uid] = { paid: false, amount: parseFloat(perPerson) }; });

    bills.set(id, {
      id,
      name,
      total,
      perPerson: parseFloat(perPerson),
      creatorId: interaction.user.id,
      guildId: interaction.guildId,
      owers,
      createdAt: Date.now(),
    });

    const mentions = mentionedIds.map(uid => `<@${uid}>`).join(', ');
    const rows = mentionedIds.map(uid => `⏳ <@${uid}> — **$${perPerson}**`).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🪶 ${name} — New Split!`)
      .setDescription(`${mentions} — <@${interaction.user.id}> covered **${name}** · you each owe **$${perPerson}**`)
      .addFields(
        { name: 'Bill ID', value: `\`${id}\``, inline: true },
        { name: 'Total', value: `$${total}`, inline: true },
        { name: 'Per Person', value: `$${perPerson}`, inline: true },
        { name: 'Status', value: rows }
      )
      .setFooter({ text: `Use /paid ${id} to mark yourself · /remind ${id} to ping owes` });

    await interaction.reply({ embeds: [embed] });
  }

  // /paid
  else if (commandName === 'paid') {
    const id = interaction.options.getString('id').toUpperCase();
    const bill = bills.get(id);

    if (!bill) return interaction.reply({ content: `❌ No bill found with ID \`${id}\`.`, ephemeral: true });

    const uid = interaction.user.id;
    if (!bill.owers[uid]) {
      return interaction.reply({ content: `❌ You're not on this bill.`, ephemeral: true });
    }
    if (bill.owers[uid].paid) {
      return interaction.reply({ content: `✅ You've already marked yourself as paid on **${bill.name}**.`, ephemeral: true });
    }

    bill.owers[uid].paid = true;

    const rows = Object.entries(bill.owers)
      .map(([id, info]) => `${info.paid ? '✅' : '⏳'} <@${id}> — **$${info.amount.toFixed(2)}**`)
      .join('\n');

    const paidCount = Object.values(bill.owers).filter(o => o.paid).length;
    const total = Object.keys(bill.owers).length;

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle(`🪶 ${bill.name} — Updated`)
      .addFields({ name: 'Status', value: rows })
      .setFooter({ text: `${paidCount}/${total} paid` });

    await interaction.reply({ embeds: [embed] });
  }

  // /remind
  else if (commandName === 'remind') {
    const id = interaction.options.getString('id').toUpperCase();
    const bill = bills.get(id);

    if (!bill) return interaction.reply({ content: `❌ No bill found with ID \`${id}\`.`, ephemeral: true });
    if (bill.creatorId !== interaction.user.id) {
      return interaction.reply({ content: `❌ Only the bill creator can send reminders.`, ephemeral: true });
    }

    const owes = Object.entries(bill.owers)
      .filter(([, info]) => !info.paid)
      .map(([uid, info]) => `<@${uid}> ($${info.amount.toFixed(2)})`);

    if (owes.length === 0) {
      return interaction.reply({ content: `✅ Everyone has paid on **${bill.name}**! 🎉` });
    }

    await interaction.reply({
      content: `🔔 **Reminder — ${bill.name}** (\`${id}\`)\n\nStill owe: ${owes.join(', ')}\n\nUse \`/paid ${id}\` when you've sent your share!`
    });
  }

  // /status
  else if (commandName === 'status') {
    const id = interaction.options.getString('id').toUpperCase();
    const bill = bills.get(id);

    if (!bill) return interaction.reply({ content: `❌ No bill found with ID \`${id}\`.`, ephemeral: true });

    const rows = Object.entries(bill.owers)
      .map(([uid, info]) => `${info.paid ? '✅' : '⏳'} <@${uid}> — **$${info.amount.toFixed(2)}**`)
      .join('\n');

    const paidCount = Object.values(bill.owers).filter(o => o.paid).length;
    const total = Object.keys(bill.owers).length;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(`🪶 ${bill.name} — Status`)
      .addFields(
        { name: 'Bill ID', value: `\`${id}\``, inline: true },
        { name: 'Total', value: `$${bill.total}`, inline: true },
        { name: 'Per Person', value: `$${bill.perPerson.toFixed(2)}`, inline: true },
        { name: 'Breakdown', value: rows }
      )
      .setFooter({ text: `${paidCount}/${total} paid · Created by <@${bill.creatorId}>` });

    await interaction.reply({ embeds: [embed] });
  }

  // /bills
  else if (commandName === 'bills') {
    const guildBills = [...bills.values()].filter(b => b.guildId === interaction.guildId);

    if (guildBills.length === 0) {
      return interaction.reply({ content: `📋 No active bills in this server. Use \`/split\` to create one!`, ephemeral: true });
    }

    const lines = guildBills.map(b => {
      const paidCount = Object.values(b.owers).filter(o => o.paid).length;
      const total = Object.keys(b.owers).length;
      return `\`${b.id}\` **${b.name}** — $${b.total} · ${paidCount}/${total} paid`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🪶 Active Bills')
      .setDescription(lines);

    await interaction.reply({ embeds: [embed] });
  }
});

client.login(TOKEN);
