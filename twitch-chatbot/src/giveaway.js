const MAX_DURATION_MINUTES = 120;
const ROLE_ORDER = ["broadcaster", "moderator", "vip", "subscriber", "follower", "viewer"];
const DEFAULT_ROLE_SETTINGS = Object.freeze({
  broadcaster: { enabled: true, weight: 1 }, moderator: { enabled: true, weight: 3 }, vip: { enabled: true, weight: 2 },
  subscriber: { enabled: true, weight: 2 }, follower: { enabled: true, weight: 1 }, viewer: { enabled: true, weight: 1 }
});

function normalizeRoleSettings(input = {}) {
  return Object.fromEntries(ROLE_ORDER.map((role) => {
    const value = input[role] || DEFAULT_ROLE_SETTINGS[role];
    return [role, { enabled: value.enabled !== false, weight: Math.max(1, Math.min(100, Number.parseInt(value.weight, 10) || 1)) }];
  }));
}

function weightedWinner(participants) {
  const total = participants.reduce((sum, entry) => sum + Math.max(1, Number(entry.weight) || 1), 0);
  let cursor = Math.random() * total;
  return participants.find((entry) => { cursor -= Math.max(1, Number(entry.weight) || 1); return cursor < 0; }) || participants.at(-1);
}

function createGiveawayManager(announce, onChange = () => {}) {
  let active = null;

  function snapshot(extra = {}) {
    return active
      ? { status: "active", prize: active.prize, endsAt: active.endsAt, participants: active.entries.size, participantsData: [...active.entries.values()], roleSettings: active.roleSettings, persistentMode: active.persistentMode, updatedAt: Date.now(), ...extra }
      : { status: "idle", participants: 0, updatedAt: Date.now(), ...extra };
  }

  function finish() {
    if (!active) return "Kein aktives Giveaway.";
    clearTimeout(active.timer);
    const { prize, entries, roleSettings, persistentMode } = active;
    const participants = [...entries.values()];
    const winner = weightedWinner(participants);
    active = null;

    if (!winner) {
      announce(`Das Giveaway für ${prize} ist beendet – leider gab es keine Teilnehmer.`);
      onChange(snapshot({ status: "ended", prize, winner: null, participants: participants.length, participantsData: participants, roleSettings, persistentMode }));
      return "Giveaway beendet – keine Teilnehmer.";
    }
    announce(`🎉 Giveaway beendet! Gewinner: @${winner.username} – Preis: ${prize}`);
    onChange(snapshot({ status: "ended", prize, winner: winner.username, participants: participants.length, participantsData: participants, roleSettings, persistentMode }));
    return `Gewinner: @${winner.username}`;
  }

  function start({ minutes, prize, joinWord = "giveaway", roleSettings = DEFAULT_ROLE_SETTINGS, participantsData = [], persistentMode = false }) {
    if (active) return "Es läuft bereits ein Giveaway.";

    const duration = persistentMode ? null : Math.min(MAX_DURATION_MINUTES, Math.max(1, minutes));
    const entries = new Map(participantsData.map((entry, index) => [entry.userId || entry.username?.toLowerCase() || String(index), { username: entry.username || "Zuschauer", userId: entry.userId, role: entry.role || "viewer", weight: Number(entry.weight) || 1 }]));
    const endsAt = Date.now() + duration * 60_000;
    const timer = duration ? setTimeout(() => finish(), duration * 60_000) : null;

    active = { prize, duration, endsAt, entries, timer, roleSettings: normalizeRoleSettings(roleSettings), persistentMode: Boolean(persistentMode) };
    onChange(snapshot());
    return `🎁 Giveaway gestartet: ${prize} | ${duration ? `Laufzeit: ${duration} Min.` : "ohne automatische Endzeit"} Teilnahme mit ${joinWord} (oder !${joinWord})`;
  }

  function restore({ prize, endsAt, participantsData = [], roleSettings = DEFAULT_ROLE_SETTINGS, persistentMode = false }) {
    if (active || (!persistentMode && (!endsAt || endsAt <= Date.now()))) return false;
    const entries = new Map(participantsData.map((entry, index) => [entry.userId || entry.username?.toLowerCase() || String(index), { username: entry.username || "Zuschauer", userId: entry.userId, role: entry.role || "viewer", weight: Number(entry.weight) || 1 }]));
    const remaining = endsAt ? Math.max(1000, endsAt - Date.now()) : null;
    const timer = remaining ? setTimeout(() => finish(), remaining) : null;
    active = { prize: String(prize || ""), duration: remaining ? Math.ceil(remaining / 60000) : null, endsAt: endsAt || null, entries, timer, roleSettings: normalizeRoleSettings(roleSettings), persistentMode: Boolean(persistentMode) };
    return true;
  }

  function join({ username, userId, role = "viewer" }) {
    if (!active) return "Aktuell läuft kein Giveaway.";
    if (active.entries.has(userId)) return `@${username}, du bist bereits dabei.`;
    const normalizedRole = ROLE_ORDER.includes(role) ? role : "viewer";
    const settings = active.roleSettings[normalizedRole] || DEFAULT_ROLE_SETTINGS.viewer;
    if (!settings.enabled) return `@${username}, deine Rolle darf an diesem Giveaway nicht teilnehmen.`;
    active.entries.set(userId, { username, userId, role: normalizedRole, weight: settings.weight });
    onChange(snapshot());
    return `@${username} nimmt am Giveaway teil!`;
  }

  function stop() {
    if (active) clearTimeout(active.timer);
    active = null;
  }

  const isActive = () => Boolean(active);

  return { start, restore, join, finish, stop, isActive };
}

module.exports = { createGiveawayManager, DEFAULT_ROLE_SETTINGS, normalizeRoleSettings, ROLE_ORDER };
