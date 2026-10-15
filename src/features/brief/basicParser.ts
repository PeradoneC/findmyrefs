// Deterministic, offline brief parser. Used by the free Mock AI provider and as the
// no-AI fallback. It only recognises vocabulary it knows; anything else is left for
// the user to fill in. Includes a small Thai -> English vocabulary so Thai briefs
// still produce English search queries.

import { uniqueClean } from "../../lib/schemas";
import type { BriefFieldKey } from "../../lib/types";

export type ParsedFields = Record<BriefFieldKey, string[]>;

type Vocab = Record<string, string>; // phrase (lowercase) -> canonical English

function words(list: string): Vocab {
  const out: Vocab = {};
  for (const w of list.split(",")) {
    const t = w.trim();
    if (t) out[t] = t;
  }
  return out;
}

const PALETTE: Vocab = {
  ...words(
    "red,orange,yellow,green,blue,purple,violet,pink,magenta,cyan,teal,turquoise,gold,golden,silver,black,white,grey,gray,brown,beige,crimson,scarlet,amber,emerald,navy,indigo,ochre,pastel,muted,desaturated,monochrome,monochromatic,neon,sepia,vibrant,warm tones,cool tones,earth tones,black and white",
  ),
  แดง: "red",
  ส้ม: "orange",
  เหลือง: "yellow",
  เขียว: "green",
  ฟ้า: "sky blue",
  น้ำเงิน: "blue",
  ม่วง: "purple",
  ชมพู: "pink",
  ทอง: "gold",
  ขาว: "white",
  ดำ: "black",
  เทา: "gray",
  น้ำตาล: "brown",
};

const LIGHTING: Vocab = {
  ...words(
    "golden hour,blue hour,sunset,sunrise,dawn,dusk,twilight,moonlight,candlelight,firelight,neon lights,backlight,backlit,rim light,volumetric light,god rays,overcast,soft light,harsh light,dramatic lighting,chiaroscuro,low key,high key,studio lighting,dappled light,midday sun,silhouette,night,lantern light,bioluminescence",
  ),
  แสงอาทิตย์: "sunlight",
  พระอาทิตย์ตก: "sunset",
  พระอาทิตย์ขึ้น: "sunrise",
  แสงจันทร์: "moonlight",
  กลางคืน: "night",
  แสงเทียน: "candlelight",
};

const MOOD: Vocab = {
  ...words(
    "melancholic,melancholy,peaceful,serene,calm,eerie,mysterious,ominous,gloomy,joyful,cheerful,whimsical,nostalgic,romantic,epic,heroic,tense,lonely,dreamy,cozy,hopeful,ethereal,haunting,playful,somber,tranquil,chaotic,majestic,intimate,uplifting",
  ),
  เศร้า: "melancholic",
  สงบ: "serene",
  ลึกลับ: "mysterious",
  น่ากลัว: "eerie",
  อบอุ่น: "cozy",
  โรแมนติก: "romantic",
  เหงา: "lonely",
};

const COMPOSITION: Vocab = words(
  "rule of thirds,symmetrical,symmetry,centered,leading lines,negative space,close-up,closeup,close up,wide shot,medium shot,full body,portrait,panorama,panoramic,minimalist composition,framing,diagonal composition,layered depth,foreground interest,golden ratio",
);

const CAMERA: Vocab = words(
  "low angle,high angle,bird's eye view,birds eye view,aerial view,aerial,worm's eye view,eye level,dutch angle,over the shoulder,top down,top-down,three-quarter view,side view,profile view,wide angle,telephoto,macro,fisheye,first person",
);

const STYLE: Vocab = words(
  "watercolor,watercolour,oil painting,gouache,ink drawing,ink,pencil sketch,charcoal,digital painting,concept art,anime,manga,cel shaded,pixel art,impressionist,impressionism,art nouveau,art deco,ukiyo-e,baroque,surreal,surrealism,photorealistic,realistic,cinematic,film noir,noir,cyberpunk,steampunk,dark fantasy,fantasy,sci-fi,science fiction,low poly,3d render,comic book,minimalist,vintage,retro,storybook illustration,illustration",
);

const MATERIALS: Vocab = {
  ...words(
    "fur,feathers,metal,rusty metal,rust,wood,weathered wood,stone,marble,glass,fabric,silk,leather,ice,snow,sand,moss,tree bark,bark,scales,porcelain,velvet,cloth,ceramic,concrete,brick,gold leaf,armor,lace,water droplets",
  ),
  ไม้: "wood",
  หิน: "stone",
  ผ้าไหม: "silk",
  ขนนก: "feathers",
};

const ENVIRONMENT: Vocab = {
  ...words(
    "forest,bamboo forest,pine forest,jungle,desert,city,cityscape,street,alley,temple,market,night market,beach,ocean,sea,coast,mountain,mountains,cave,river,lake,village,castle,ruins,outer space,space station,underwater,field,meadow,rooftop,interior,bedroom,kitchen,cafe,library,swamp,canyon,island,harbor,rice field,garden,waterfall,cliff,tundra,battlefield,throne room,train station,subway",
  ),
  ป่า: "forest",
  ทะเล: "sea",
  ภูเขา: "mountains",
  วัด: "temple",
  ตลาด: "market",
  เมือง: "city",
  ถนน: "street",
  แม่น้ำ: "river",
  ทุ่งนา: "rice field",
  ชายหาด: "beach",
};

const WEATHER: Vocab = {
  rain: "rain",
  rainy: "rainy weather",
  snowy: "snowy weather",
  snowfall: "snowfall",
  fog: "fog",
  foggy: "foggy weather",
  mist: "mist",
  misty: "misty atmosphere",
  storm: "storm",
  stormy: "stormy weather",
  ฝน: "rain",
  หมอก: "fog",
  หิมะ: "snow",
};

const THAI = /[฀-๿]/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Finds vocabulary phrases in text. Longer phrases win over contained shorter ones. */
function match(text: string, vocab: Vocab): string[] {
  const lower = text.toLowerCase();
  const phrases = Object.keys(vocab).sort((a, b) => b.length - a.length);
  const found: { index: number; value: string }[] = [];
  const taken: [number, number][] = [];
  for (const phrase of phrases) {
    // Latin phrases match whole words, optionally plural ("greens", "lanterns").
    const pattern = THAI.test(phrase)
      ? new RegExp(escapeRegex(phrase), "g")
      : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase)}(?:e?s)?(?![\\p{L}\\p{N}])`, "gu");
    for (const m of lower.matchAll(pattern)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      found.push({ index: start, value: vocab[phrase] ?? phrase });
    }
  }
  return uniqueClean(found.sort((a, b) => a.index - b.index).map((f) => f.value));
}

const EXCLUSION = /\b(?:no|without|avoid|avoiding|exclude|excluding|not)\s+([^,.;\n]+)/gi;
const THAI_EXCLUSION = /(?:ไม่เอา|ไม่มี|ห้ามมี)\s*([^,.;\n]+)/g;

const LEADING_FILLER =
  /^(?:i\s+(?:want|would like|need)\s+(?:to\s+)?(?:paint|draw|create|make|illustrate)\s+|(?:please\s+)?(?:paint|draw|create|make|illustrate)\s+|(?:a|an)\s+(?:painting|illustration|drawing|picture|image|artwork|piece|scene|concept)\s+(?:of|showing|with)\s+)/i;

const CLAUSE_SPLIT =
  /\s*(?:[,.;\n]|\s(?:in|inside|at|on|under|during|with|near|beside|beneath|surrounded by|while|as)\s)\s*/i;
const ARTICLES = /^(?:a|an|the|some|one)\s+/i;

function stripPhrases(text: string, vocab: Vocab): string {
  let out = text;
  for (const phrase of Object.keys(vocab).sort((a, b) => b.length - a.length)) {
    if (THAI.test(phrase)) continue;
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase)}(?![\\p{L}\\p{N}])`, "giu"),
      " ",
    );
  }
  return out.replace(/\s+/g, " ").trim();
}

function clipWords(text: string, max: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, max).join(" ");
}

function extractSubject(text: string): string[] {
  let body = text.trim().replace(LEADING_FILLER, "");
  const first = body.split(CLAUSE_SPLIT)[0] ?? "";
  body = stripPhrases(first, { ...MOOD, ...STYLE, ...LIGHTING, ...CAMERA, ...COMPOSITION });
  body = body.replace(ARTICLES, "").replace(/^(?:of|and)\s+/i, "");
  body = body
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!body || THAI.test(body)) return [];
  return [clipWords(body.toLowerCase(), 6)];
}

const TRAILING_LINKERS = /\s+(?:at|on|in|with|by|during|under|near|and|of|the|a|an)$/i;

function extractPlace(text: string): string[] {
  const m = /\b(?:in|inside|at|on)\s+(?:a|an|the)?\s*([^,.;\n]+)/i.exec(text);
  if (!m?.[1]) return [];
  let place = m[1].split(/\s(?:at|on|with|while|during|as|under|near|beside|by)\s/i)[0] ?? "";
  place = stripPhrases(place, { ...STYLE, ...LIGHTING, ...MOOD, ...CAMERA });
  place = place.replace(ARTICLES, "").trim();
  while (TRAILING_LINKERS.test(place)) place = place.replace(TRAILING_LINKERS, "").trim();
  if (!place || THAI.test(place)) return [];
  return [clipWords(place.toLowerCase(), 5)];
}

export function parseBriefText(prompt: string): ParsedFields {
  const exclusions: string[] = [];
  let text = prompt;
  for (const re of [EXCLUSION, THAI_EXCLUSION]) {
    text = text.replace(re, (_all, what: string) => {
      exclusions.push(clipWords(what.trim().toLowerCase(), 5));
      return " ";
    });
  }

  const placeFromClause = extractPlace(text);
  const environment = uniqueClean([
    ...placeFromClause,
    ...match(text, ENVIRONMENT).filter((env) => !placeFromClause.some((p) => p.includes(env))),
    ...match(text, WEATHER),
  ]);

  // "golden hour" is lighting, not a palette color.
  const withoutLighting = stripPhrases(text, LIGHTING);

  return {
    subject: extractSubject(text),
    environment,
    palette: match(withoutLighting, PALETTE),
    lighting: match(text, LIGHTING),
    mood: match(text, MOOD),
    composition: match(text, COMPOSITION),
    cameraAngle: match(text, CAMERA),
    style: match(text, STYLE),
    materialsOrTextures: match(text, MATERIALS),
    exclusions: uniqueClean(exclusions),
  };
}

/** Splits a comma/newline separated field value into clean entries. */
export function splitFieldInput(value: string): string[] {
  return uniqueClean(value.split(/[,\n]/));
}
