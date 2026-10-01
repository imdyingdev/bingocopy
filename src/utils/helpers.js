/**
 * Utility helper functions
 */

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  return str.replace(
    /[<>&'"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c],
  );
}

/**
 * Fisher-Yates shuffle algorithm
 */
function fisherYatesShuffle(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function compareSortableValues(a, b) {
  const normalizeValue = (value) => {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return "";
      }

      const numericValue = Number(trimmed);
      return Number.isNaN(numericValue) ? trimmed.toLowerCase() : numericValue;
    }

    return String(value);
  };

  const left = normalizeValue(a);
  const right = normalizeValue(b);

  if (left === "" && right === "") return 0;
  if (left === "") return -1;
  if (right === "") return 1;

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), undefined, { sensitivity: "base" });
}

/**
 * Extract theme from pattern keys for Giphy search
 */
function extractThemeFromPattern(pattern, patternOrder = null) {
  const keys = (patternOrder || Object.keys(pattern)).join("").toUpperCase();

  const themeMap = {
    BINGO: "bingo game",
    MRVLS: "marvel superhero",
    SPIDER: "spiderman superhero",
    FRUIT: "fruit food",
    ANIMAL: "animals",
    SPORT: "sports",
    COLOR: "colors",
    CITY: "cities travel",
  };

  for (const [patternKey, theme] of Object.entries(themeMap)) {
    if (keys === patternKey) {
      return theme;
    }
  }

  const allItems = Object.values(pattern).flat();
  if (
    allItems.some(
      (item) =>
        typeof item === "string" &&
        (item.toLowerCase().includes("spider") ||
          item.toLowerCase().includes("marvel")),
    )
  ) {
    return "marvel superhero";
  }
  if (
    allItems.some(
      (item) =>
        typeof item === "string" &&
        (item.toLowerCase().includes("fruit") ||
          ["apple", "banana", "cherry"].includes(item.toLowerCase())),
    )
  ) {
    return "fruit food";
  }
  if (
    allItems.some(
      (item) =>
        typeof item === "string" &&
        (item.toLowerCase().includes("lion") ||
          item.toLowerCase().includes("tiger")),
    )
  ) {
    return "animals";
  }

  return "bingo";
}

function inferThemeFromPattern(pattern, patternOrder = null, fallback = "bingo") {
  if (!pattern || typeof pattern !== "object") {
    return fallback;
  }

  const allItems = Object.values(pattern)
    .flat()
    .filter((item) => typeof item === "string")
    .join(" ")
    .toLowerCase();

  if (/(spongebob|patrick|krabby|bikini|squidward|sandy|plankton|gary)/i.test(allItems)) {
    return "spongebob squarepants";
  }

  if (/(woody|buzz|gabby gabby|jessie|toy story|pixar|forky|lotso|sid)/i.test(allItems)) {
    return "toy story";
  }

  if (/(iron man|captain america|thor|hulk|black widow|hawkeye|spiderman|doctor strange|scarlet witch|vision|loki|black panther|ant man|wasp|captain marvel|batman|superman|wonder woman|flash|aquaman|green lantern|cyborg|robin|nightwing|batgirl|harley quinn|joker|catwoman|lex luthor|shazam|wolverine|cyclops|storm|jean grey|rogue|beast|gambit|nightcrawler|iceman|colossus|professor x|magneto|mystique|kitty pryde|jubilee|adventure time|gravity falls|phineas and ferb|we bare bears|scooby-doo|bluey|teen titans go|powerpuff girls|the loud house|jimmy neutron|winx|the simpsons|totally spies|johnny bravo|spy x family|one punch man|haikyuu|demon slayer|death note|parasyte|sailor moon|hunter x hunter|one piece|seven deadly sins|sword art online|black clover|naruto|fairy tail|jujutsu kaisen)/i.test(allItems)) {
    return "default";
  }

  return fallback;
}

module.exports = {
  escapeXml,
  fisherYatesShuffle,
  compareSortableValues,
  extractThemeFromPattern,
  inferThemeFromPattern,
};
