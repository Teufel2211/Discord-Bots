const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { supabaseRequest } = require('./database');
const EPHEMERAL = { flags: MessageFlags.Ephemeral };
const TYPES = { kompanie: 'Kompanie', zug: 'Zug', gruppe: 'Gruppe' };
const POSITIONS = { mitglied: 'Mitglied', leiter: 'Leiter', stellvertreter: 'Stellvertreter' };

async function rows(path, options = {}) {
  const response = await supabaseRequest(path, { headers: { Prefer: 'return=representation' }, ...options });
  return response ? response.json() : [];
}
async function audit(guildId, unitId, actorId, action, details = {}) {
  await supabaseRequest('bww_unit_audit_logs', { method: 'POST', body: JSON.stringify({ guild_id: guildId, unit_id: unitId || null, actor_id: actorId, action, details }) });
}
async function getUnit(guildId, name) {
  const found = await rows('bww_units?select=*&guild_id=eq.' + encodeURIComponent(guildId) + '&name=ilike.' + encodeURIComponent(name) + '&limit=2');
  if (found.length > 1) throw new Error('Der Name ist nicht eindeutig. Bitte verwende einen eindeutigen Einheitennamen.');
  return found[0] || null;
}
async function getPosition(unitId, userId) {
  const found = await rows('bww_unit_members?select=position&unit_id=eq.' + unitId + '&user_id=eq.' + userId + '&limit=1');
  return found[0]?.position || null;
}
async function canManage(interaction, config, unit) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if ((config.permissions?.einheiten || []).some(id => interaction.member?.roles?.cache?.has(id))) return true;
  let current = unit;
  for (let depth = 0; current && depth < 3; depth++) {
    const position = await getPosition(current.id, interaction.user.id);
    if (position === 'leiter' || position === 'stellvertreter') return true;
    if (!current.parent_id) break;
    const parents = await rows('bww_units?select=*&id=eq.' + current.parent_id + '&guild_id=eq.' + encodeURIComponent(interaction.guildId) + '&limit=1');
    current = parents[0] || null;
  }
  return false;
}
function cleanName(value) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100); }

async function listUnits(guildId) {
  const units = await rows('bww_units?select=*&guild_id=eq.' + encodeURIComponent(guildId) + '&order=unit_type.asc,name.asc');
  const members = await rows('bww_unit_members?select=unit_id,user_id,position&guild_id=eq.' + encodeURIComponent(guildId) + '&order=position.asc');
  const byUnit = new Map();
  for (const member of members) {
    if (!byUnit.has(member.unit_id)) byUnit.set(member.unit_id, []);
    byUnit.get(member.unit_id).push(member);
  }
  const order = { kompanie: 0, zug: 1, gruppe: 2 };
  units.sort((a, b) => (order[a.unit_type] - order[b.unit_type]) || a.name.localeCompare(b.name, 'de'));
  return units.map(unit => ({ ...unit, members: byUnit.get(unit.id) || [] }));
}

async function handleUnitCommand(interaction, config) {
  const command = interaction.commandName;
  if (!command.startsWith('einheit-')) return false;
  if (command === 'einheit-liste' || command === 'einheit-uebersicht') {
    const units = await listUnits(interaction.guildId);
    if (!units.length) return interaction.reply({ content: '📭 Es sind noch keine Einheiten angelegt.', ...EPHEMERAL });
    const lines = units.map(unit => {
      const leader = unit.members.find(m => m.position === 'leiter');
      const deputy = unit.members.find(m => m.position === 'stellvertreter');
      const parent = units.find(item => item.id === unit.parent_id);
      return '**' + TYPES[unit.unit_type] + ' · ' + unit.name + '**' + (parent ? ' _(unter ' + parent.name + ')_' : '') +
        '\nLeiter: ' + (leader ? '<@' + leader.user_id + '>' : 'Nicht zugewiesen') +
        ' · Stv.: ' + (deputy ? '<@' + deputy.user_id + '>' : 'Nicht zugewiesen') +
        ' · Mitglieder: ' + unit.members.length + (unit.responsibilities ? '\nZuständigkeit: ' + unit.responsibilities : '');
    });
    return interaction.reply({ content: lines.join('\n\n').slice(0, 1900), ...EPHEMERAL });
  }

  if (command === 'einheit-erstellen') {
    const type = interaction.options.getString('typ', true);
    const name = cleanName(interaction.options.getString('name', true));
    const responsibilities = (interaction.options.getString('zustaendigkeit') || '').trim().slice(0, 1000);
    const parentName = interaction.options.getString('uebergeordnet');
    if (!TYPES[type] || !name) return interaction.reply({ content: '❌ Ungültiger Einheitentyp oder Name.', ...EPHEMERAL });
    let parent = null;
    if (type !== 'kompanie') {
      if (!parentName) return interaction.reply({ content: '❌ Ein ' + TYPES[type] + ' benötigt eine übergeordnete ' + (type === 'zug' ? 'Kompanie' : 'Zug') + '.', ...EPHEMERAL });
      parent = await getUnit(interaction.guildId, cleanName(parentName));
      const expected = type === 'zug' ? 'kompanie' : 'zug';
      if (!parent || parent.unit_type !== expected) return interaction.reply({ content: '❌ Übergeordnete ' + TYPES[expected] + ' nicht gefunden.', ...EPHEMERAL });
    } else if (parentName) return interaction.reply({ content: '❌ Eine Kompanie darf keine übergeordnete Einheit haben.', ...EPHEMERAL });
    const hasGlobalPermission = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) || (config.permissions?.einheiten || []).some(id => interaction.member?.roles?.cache?.has(id));
    const hasParentLeadership = type !== 'kompanie' && parent && await canManage(interaction, config, parent);
    if (!hasGlobalPermission && !hasParentLeadership) return interaction.reply({ content: '❌ Kompanien dürfen nur Administratoren oder freigeschaltete Einheiten-Verwalter erstellen. Leiter/Stellvertreter dürfen untergeordnete Züge und Gruppen in ihrem Zuständigkeitsbereich erstellen.', ...EPHEMERAL });
    const created = await rows('bww_units', { method: 'POST', body: JSON.stringify({ guild_id: interaction.guildId, unit_type: type, parent_id: parent?.id || null, name, responsibilities, created_by: interaction.user.id }) });
    const unit = created[0];
    await audit(interaction.guildId, unit.id, interaction.user.id, 'unit_created', { type, name, parent: parent?.name || null });
    return interaction.reply({ content: '✅ ' + TYPES[type] + ' **' + name + '** wurde erstellt' + (parent ? ' unter **' + parent.name + '**' : '') + '.', ...EPHEMERAL });
  }

  const name = cleanName(interaction.options.getString('name', true));
  const unit = await getUnit(interaction.guildId, name);
  if (!unit) return interaction.reply({ content: '❌ Einheit **' + name + '** nicht gefunden.', ...EPHEMERAL });
  if (!(await canManage(interaction, config, unit))) return interaction.reply({ content: '❌ Du darfst diese Einheit nicht verwalten. Erforderlich: Administrator, Einheiten-Verwalter oder Leiter/Stellvertreter dieser bzw. einer übergeordneten Einheit.', ...EPHEMERAL });

  if (command === 'einheit-info') {
    const members = await rows('bww_unit_members?select=*&unit_id=eq.' + unit.id + '&order=position.asc,assigned_at.asc');
    const leader = members.find(m => m.position === 'leiter');
    const deputy = members.find(m => m.position === 'stellvertreter');
    const parent = unit.parent_id ? await rows('bww_units?select=name&id=eq.' + unit.parent_id + '&limit=1') : [];
    const lines = ['## ' + TYPES[unit.unit_type] + ' · ' + unit.name, parent[0] ? 'Übergeordnet: ' + parent[0].name : '',
      'Leiter: ' + (leader ? '<@' + leader.user_id + '>' : 'Nicht zugewiesen'),
      'Stellvertreter: ' + (deputy ? '<@' + deputy.user_id + '>' : 'Nicht zugewiesen'),
      '**Mitglieder (' + members.length + ')**', ...members.filter(m => m.position === 'mitglied').map(m => '• <@' + m.user_id + '>'),
      unit.responsibilities ? '**Zuständigkeiten:** ' + unit.responsibilities : ''];
    return interaction.reply({ content: lines.filter(Boolean).join('\n').slice(0, 1900), ...EPHEMERAL });
  }

  if (command === 'einheit-bearbeiten') {
    const newName = cleanName(interaction.options.getString('neuer_name') || unit.name);
    const responsibilities = interaction.options.getString('zustaendigkeit');
    const patch = { name: newName };
    if (responsibilities !== null) patch.responsibilities = responsibilities.trim().slice(0, 1000);
    await rows('bww_units?id=eq.' + unit.id + '&guild_id=eq.' + encodeURIComponent(interaction.guildId), { method: 'PATCH', body: JSON.stringify(patch) });
    await audit(interaction.guildId, unit.id, interaction.user.id, 'unit_updated', patch);
    return interaction.reply({ content: '✅ Einheit **' + unit.name + '** wurde aktualisiert.', ...EPHEMERAL });
  }

  if (command === 'einheit-loeschen') {
    const children = await rows('bww_units?select=id&parent_id=eq.' + unit.id + '&limit=1');
    if (children.length) return interaction.reply({ content: '❌ Diese Einheit enthält noch untergeordnete Einheiten. Lösche zuerst die untergeordneten Gruppen/Züge.', ...EPHEMERAL });
    await audit(interaction.guildId, unit.id, interaction.user.id, 'unit_deleted', { name: unit.name, type: unit.unit_type });
    await supabaseRequest('bww_units?id=eq.' + unit.id + '&guild_id=eq.' + encodeURIComponent(interaction.guildId), { method: 'DELETE' });
    return interaction.reply({ content: '🗑️ Einheit **' + unit.name + '** wurde gelöscht.', ...EPHEMERAL });
  }

  if (command === 'einheit-mitglied') {
    const member = interaction.options.getMember('user');
    const position = interaction.options.getString('position', true);
    if (!member) return interaction.reply({ content: '❌ Mitglied nicht gefunden.', ...EPHEMERAL });
    if (!POSITIONS[position]) return interaction.reply({ content: '❌ Ungültige Position.', ...EPHEMERAL });
    if (position !== 'mitglied') await supabaseRequest('bww_unit_members?unit_id=eq.' + unit.id + '&position=eq.' + position + '&user_id=neq.' + member.id, { method: 'DELETE' });
    await rows('bww_unit_members?on_conflict=unit_id,user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ guild_id: interaction.guildId, unit_id: unit.id, user_id: member.id, position, assigned_by: interaction.user.id }) });
    await audit(interaction.guildId, unit.id, interaction.user.id, 'member_assigned', { userId: member.id, position });
    return interaction.reply({ content: '✅ ' + member + ' ist jetzt **' + POSITIONS[position] + '** in **' + unit.name + '**.', ...EPHEMERAL });
  }

  if (command === 'einheit-entfernen') {
    const member = interaction.options.getUser('user', true);
    await supabaseRequest('bww_unit_members?unit_id=eq.' + unit.id + '&user_id=eq.' + member.id, { method: 'DELETE' });
    await audit(interaction.guildId, unit.id, interaction.user.id, 'member_removed', { userId: member.id });
    return interaction.reply({ content: '✅ <@' + member.id + '> wurde aus **' + unit.name + '** entfernt.', ...EPHEMERAL });
  }
  return interaction.reply({ content: '❌ Unbekannter Einheiten-Befehl.', ...EPHEMERAL });
}
module.exports = { handleUnitCommand, listUnits, audit };
