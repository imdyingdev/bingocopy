const THEMES = [
  { id: "default", name: "Default", emoji: "🎱" },
  { id: "spongebob", name: "Spongebob", emoji: "🧽" },
  { id: "comics", name: "Comics", emoji: "🦸" },
  { id: "calendar", name: "Calendar", emoji: "📅" },
  { id: "onepiece", name: "One Piece", emoji: "🏴‍☠️" },
  { id: "onepiece_v2", name: "One Piece V2", emoji: "🏴‍☠️" },
  { id: "toy_story", name: "Toy Story", emoji: "🧸" },
  { id: "frozen", name: "Frozen", emoji: "❄️" },
  { id: "minions", name: "Minions", emoji: "🍌" },
  { id: "lovers_soiree", name: "Lover's Soiree", emoji: "👠" },
  { id: "bingulo_beta", name: "BINGULO BETA", emoji: "🧩" },
];

const THEME_NAMES = Object.fromEntries(THEMES.map((theme) => [theme.id, theme.name]));

const THEME_FILES = {
  default: "defaultTheme",
  spongebob: "spongebobTheme",
  comics: "defaultTheme",
  calendar: "calendarTheme",
  onepiece: "onepieceTheme",
  onepiece_v2: "onepieceV2Theme",
  toy_story: "toyStoryTheme",
  frozen: "frozenTheme",
  minions: "minionsTheme",
  lovers_soiree: "defaultTheme",
  bingulo_beta: "defaultTheme",
};

module.exports = {
  THEMES,
  THEME_NAMES,
  THEME_FILES,
};
