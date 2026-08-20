// Geography: turn messy location strings into ISO country codes, and countries
// into regions. Three layers resolve a location (cheap → expensive):
//   1. this gazetteer (multilingual country names + major hiring-hub cities)
//   2. the learned LocationCache table (LLM answers, persisted forever)
//   3. one batched LLM call per ingest for whatever is still unknown
// Cities are INPUT for resolving the country — not a filter dimension.

// ── Countries ────────────────────────────────────────────────────────────────

export const COUNTRY_NAMES: Record<string, string> = {
  tr: "Türkiye", de: "Germany", at: "Austria", ch: "Switzerland",
  nl: "Netherlands", be: "Belgium", lu: "Luxembourg", fr: "France",
  es: "Spain", pt: "Portugal", it: "Italy", ie: "Ireland", gb: "United Kingdom",
  se: "Sweden", no: "Norway", dk: "Denmark", fi: "Finland", is: "Iceland",
  pl: "Poland", cz: "Czechia", sk: "Slovakia", hu: "Hungary", ro: "Romania",
  bg: "Bulgaria", gr: "Greece", hr: "Croatia", si: "Slovenia", rs: "Serbia",
  ee: "Estonia", lv: "Latvia", lt: "Lithuania", ua: "Ukraine", cy: "Cyprus",
  mt: "Malta", il: "Israel", ae: "UAE", sa: "Saudi Arabia", qa: "Qatar",
  eg: "Egypt", za: "South Africa", ng: "Nigeria", ke: "Kenya", ma: "Morocco",
  us: "United States", ca: "Canada", mx: "Mexico", br: "Brazil", ar: "Argentina",
  cl: "Chile", co: "Colombia", pe: "Peru", uy: "Uruguay",
  in: "India", cn: "China", jp: "Japan", kr: "South Korea", tw: "Taiwan",
  hk: "Hong Kong", sg: "Singapore", my: "Malaysia", th: "Thailand",
  vn: "Vietnam", ph: "Philippines", id: "Indonesia", au: "Australia",
  nz: "New Zealand", pk: "Pakistan", bd: "Bangladesh",
};

export const KNOWN_COUNTRIES: ReadonlySet<string> = new Set(Object.keys(COUNTRY_NAMES));

// ── Regions (coarse, overlapping is fine — selections take the union) ────────

const EU = ["at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu", "ie", "it", "lv", "lt", "lu", "mt", "nl", "pl", "pt", "ro", "sk", "si", "es", "se"];
const EUROPE_NON_EU = ["gb", "ch", "no", "is", "rs", "ua", "tr"];
const MIDDLE_EAST = ["il", "ae", "sa", "qa"];
const AFRICA = ["eg", "za", "ng", "ke", "ma"];

export const REGIONS: Record<string, readonly string[]> = {
  eu: EU,
  emea: [...EU, ...EUROPE_NON_EU, ...MIDDLE_EAST, ...AFRICA],
  tr: ["tr"],
  "uk-ie": ["gb", "ie"],
  dach: ["de", "at", "ch"],
  nordics: ["se", "no", "dk", "fi", "is"],
  americas: ["us", "ca", "mx", "br", "ar", "cl", "co", "pe", "uy"],
  apac: ["in", "cn", "jp", "kr", "tw", "hk", "sg", "my", "th", "vn", "ph", "id", "au", "nz", "pk", "bd"],
};

export const REGION_KEYS = Object.keys(REGIONS);

export function regionsOf(country: string): string[] {
  return REGION_KEYS.filter((r) => REGIONS[r].includes(country));
}

// Local posting language per country — only languages the search layer has
// query variants for. Countries not listed search in English.
export const COUNTRY_LANGUAGE: Record<string, "de" | "nl" | "fr" | "es"> = {
  de: "de", at: "de", ch: "de",
  nl: "nl",
  fr: "fr",
  es: "es", mx: "es", ar: "es", cl: "es", co: "es", pe: "es", uy: "es",
};

// ── Gazetteer: names/cities → country ────────────────────────────────────────
// Multilingual country names (the languages job postings actually arrive in)
// and the major hiring-hub cities. Lowercase; matched per comma/dash segment.

const NAME_TO_COUNTRY: Record<string, string> = {};
function reg(country: string, ...names: string[]) {
  for (const n of names) NAME_TO_COUNTRY[n] = country;
}

// Country names: english + native + common DE/FR/ES/IT/NL/PL/TR spellings.
reg("tr", "turkey", "türkiye", "turkiye", "turquie", "türkei", "turquía");
reg("de", "germany", "deutschland", "allemagne", "alemania", "germania", "duitsland", "niemcy", "almanya");
reg("at", "austria", "österreich", "autriche", "avusturya", "oostenrijk");
reg("ch", "switzerland", "schweiz", "suisse", "svizzera", "isviçre", "isvicre");
reg("nl", "netherlands", "nederland", "pays-bas", "países bajos", "holland", "hollanda", "the netherlands");
reg("be", "belgium", "belgië", "belgique", "belgien", "belçika");
reg("lu", "luxembourg", "luxemburg", "lüksemburg");
reg("fr", "france", "frankreich", "francia", "fransa", "frankrijk");
reg("es", "spain", "españa", "espagne", "spanien", "ispanya", "spagna");
reg("pt", "portugal", "portekiz");
reg("it", "italy", "italia", "italie", "italien", "italya");
reg("ie", "ireland", "irland", "irlande", "irlanda");
reg("gb", "united kingdom", "great britain", "england", "scotland", "wales", "northern ireland", "royaume-uni", "großbritannien", "vereinigtes königreich", "ingiltere", "birleşik krallık");
reg("se", "sweden", "sverige", "schweden", "suède", "isveç", "isvec");
reg("no", "norway", "norge", "norwegen", "norvège", "norveç");
reg("dk", "denmark", "danmark", "dänemark", "danemark", "danimarka");
reg("fi", "finland", "suomi", "finnland", "finlande", "finlandiya");
reg("is", "iceland", "ísland", "izlanda");
reg("pl", "poland", "polska", "polen", "pologne", "polonya");
reg("cz", "czechia", "czech republic", "česko", "tschechien", "çekya");
reg("sk", "slovakia", "slovensko", "slowakei", "slovakya");
reg("hu", "hungary", "magyarország", "ungarn", "macaristan");
reg("ro", "romania", "românia", "rumänien", "romanya");
reg("bg", "bulgaria", "българия", "bulgarien", "bulgaristan");
reg("gr", "greece", "ελλάδα", "griechenland", "grèce", "yunanistan");
reg("hr", "croatia", "hrvatska", "kroatien", "hırvatistan");
reg("si", "slovenia", "slovenija", "slowenien", "slovenya");
reg("rs", "serbia", "srbija", "serbien", "sırbistan");
reg("ee", "estonia", "eesti", "estland", "estonya");
reg("lv", "latvia", "latvija", "lettland", "letonya");
reg("lt", "lithuania", "lietuva", "litauen", "litvanya");
reg("ua", "ukraine", "україна", "ukrayna");
reg("cy", "cyprus", "kıbrıs", "kibris", "zypern");
reg("mt", "malta");
reg("il", "israel", "israil");
reg("ae", "united arab emirates", "uae", "dubai", "abu dhabi", "bae");
reg("sa", "saudi arabia", "suudi arabistan");
reg("qa", "qatar", "katar");
reg("eg", "egypt", "mısır", "misir");
reg("za", "south africa", "güney afrika");
reg("ng", "nigeria", "nijerya");
reg("ke", "kenya");
reg("ma", "morocco", "fas");
reg("us", "united states", "usa", "u.s.", "u.s.a.", "america", "estados unidos", "états-unis", "abd", "amerika birleşik devletleri");
reg("ca", "canada", "kanada");
reg("mx", "mexico", "méxico", "meksika");
reg("br", "brazil", "brasil", "brezilya");
reg("ar", "argentina", "arjantin");
reg("cl", "chile", "şili");
reg("co", "colombia", "kolombiya");
reg("pe", "peru");
reg("uy", "uruguay");
reg("in", "india", "hindistan");
reg("cn", "china", "çin", "cin");
reg("jp", "japan", "japonya", "japon");
reg("kr", "south korea", "korea", "güney kore");
reg("tw", "taiwan", "tayvan");
reg("hk", "hong kong");
reg("sg", "singapore", "singapur");
reg("my", "malaysia", "malezya");
reg("th", "thailand", "tayland");
reg("vn", "vietnam");
reg("ph", "philippines", "filipinler");
reg("id", "indonesia", "endonezya");
reg("au", "australia", "avustralya");
reg("nz", "new zealand", "yeni zelanda");
reg("pk", "pakistan");
reg("bd", "bangladesh", "bangladeş");

// Major hiring-hub cities (native spellings included).
reg("tr", "istanbul", "ankara", "izmir", "bursa", "antalya", "kocaeli", "sarıyer", "kadıköy", "beşiktaş", "şişli", "maslak");
reg("de", "berlin", "munich", "münchen", "hamburg", "cologne", "köln", "frankfurt", "stuttgart", "düsseldorf", "dusseldorf", "leipzig", "dresden", "nuremberg", "nürnberg", "hannover", "bremen", "essen", "dortmund", "bonn", "karlsruhe", "mannheim", "heidelberg", "potsdam", "aachen", "münster");
reg("at", "vienna", "wien", "graz", "linz", "salzburg", "innsbruck");
reg("ch", "zurich", "zürich", "geneva", "genève", "basel", "bern", "lausanne", "zug");
reg("nl", "amsterdam", "rotterdam", "the hague", "den haag", "utrecht", "eindhoven", "delft", "groningen");
reg("be", "brussels", "bruxelles", "brussel", "antwerp", "antwerpen", "ghent", "gent", "leuven");
reg("fr", "paris", "lyon", "marseille", "toulouse", "bordeaux", "lille", "nantes", "nice", "grenoble", "montpellier", "sophia antipolis");
reg("es", "madrid", "barcelona", "valencia", "seville", "sevilla", "bilbao", "malaga", "málaga", "zaragoza");
reg("pt", "lisbon", "lisboa", "porto", "braga", "coimbra");
reg("it", "milan", "milano", "rome", "roma", "turin", "torino", "bologna", "florence", "firenze", "naples", "napoli");
reg("ie", "dublin", "cork", "galway", "limerick");
reg("gb", "london", "manchester", "birmingham", "edinburgh", "glasgow", "leeds", "bristol", "cambridge", "oxford", "liverpool", "newcastle", "belfast", "cardiff", "brighton", "reading", "sheffield", "nottingham");
reg("se", "stockholm", "gothenburg", "göteborg", "malmö", "malmo", "uppsala", "lund");
reg("no", "oslo", "bergen", "trondheim", "stavanger");
reg("dk", "copenhagen", "københavn", "aarhus", "odense");
reg("fi", "helsinki", "espoo", "tampere", "oulu", "turku");
reg("is", "reykjavik", "reykjavík");
reg("pl", "warsaw", "warszawa", "krakow", "kraków", "cracow", "wroclaw", "wrocław", "gdansk", "gdańsk", "poznan", "poznań", "lodz", "łódź", "katowice", "szczecin");
reg("cz", "prague", "praha", "brno", "ostrava");
reg("sk", "bratislava", "košice", "kosice");
reg("hu", "budapest", "debrecen");
reg("ro", "bucharest", "bucurești", "cluj", "cluj-napoca", "timisoara", "timișoara", "iasi", "iași");
reg("bg", "sofia", "plovdiv", "varna");
reg("gr", "athens", "αθήνα", "thessaloniki");
reg("hr", "zagreb", "split");
reg("si", "ljubljana");
reg("rs", "belgrade", "beograd", "novi sad");
reg("ee", "tallinn", "tartu");
reg("lv", "riga", "rīga");
reg("lt", "vilnius", "kaunas");
reg("ua", "kyiv", "kiev", "lviv", "kharkiv", "odesa");
reg("cy", "nicosia", "limassol", "larnaca");
reg("mt", "valletta", "sliema");
reg("il", "tel aviv", "jerusalem", "haifa", "herzliya");
reg("eg", "cairo", "alexandria");
reg("za", "cape town", "johannesburg", "pretoria", "durban");
reg("ng", "lagos", "abuja");
reg("ke", "nairobi");
reg("ma", "casablanca", "rabat");
reg("us", "new york", "nyc", "san francisco", "sf bay area", "bay area", "los angeles", "seattle", "austin", "boston", "chicago", "denver", "atlanta", "miami", "washington", "dallas", "houston", "san diego", "san jose", "portland", "philadelphia", "phoenix", "salt lake city", "mountain view", "palo alto", "sunnyvale", "menlo park", "redmond", "bellevue", "cupertino", "santa clara", "irvine", "boulder", "raleigh", "durham", "nashville", "minneapolis", "pittsburgh", "detroit", "columbus", "charlotte", "brooklyn");
reg("ca", "toronto", "vancouver", "montreal", "montréal", "ottawa", "calgary", "edmonton", "waterloo", "quebec");
reg("mx", "mexico city", "ciudad de méxico", "guadalajara", "monterrey");
reg("br", "são paulo", "sao paulo", "rio de janeiro", "belo horizonte", "curitiba", "florianópolis", "florianopolis", "porto alegre");
reg("ar", "buenos aires", "córdoba", "cordoba");
reg("cl", "santiago");
reg("co", "bogotá", "bogota", "medellín", "medellin");
reg("pe", "lima");
reg("uy", "montevideo");
reg("in", "bangalore", "bengaluru", "mumbai", "delhi", "new delhi", "hyderabad", "chennai", "pune", "gurgaon", "gurugram", "noida", "kolkata", "ahmedabad");
reg("cn", "beijing", "shanghai", "shenzhen", "guangzhou", "hangzhou", "chengdu");
reg("jp", "tokyo", "osaka", "kyoto", "fukuoka", "nagoya", "yokohama");
reg("kr", "seoul", "busan", "pangyo");
reg("tw", "taipei", "hsinchu");
reg("sg", "singapore city");
reg("my", "kuala lumpur", "penang");
reg("th", "bangkok", "chiang mai");
reg("vn", "ho chi minh", "ho chi minh city", "hanoi", "da nang");
reg("ph", "manila", "cebu");
reg("id", "jakarta", "bandung", "bali");
reg("au", "sydney", "melbourne", "brisbane", "perth", "adelaide", "canberra");
reg("nz", "auckland", "wellington", "christchurch");
reg("pk", "karachi", "lahore", "islamabad");
reg("bd", "dhaka");

// Strings that mean "no fixed place" — never a country.
const NON_PLACE_RE = /^(remote|worldwide|global|anywhere|distributed|fully remote|work from home|home office|emea|europe|european union|apac|latam|americas|international|flexible|hybrid|onsite|multiple locations?|various(?: locations?)?|n\/a|-|—)$/i;

export function normalizeLocation(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}

// Split "Sarıyer, Istanbul" / "PL - Warsaw" / "Berlin (Hybrid)" into candidate
// place segments and look each up, most-specific (rightmost country wins over
// leftmost district only when both hit — in practice segments agree).
export function resolveCountry(rawLocation: string | null | undefined): string | null {
  if (!rawLocation) return null;
  const norm = normalizeLocation(rawLocation).replace(/\(.*?\)/g, " ");
  if (NON_PLACE_RE.test(norm.trim())) return null;

  const segments = norm
    .split(/[,;/|·–—-]| - /)
    .map((s) => s.trim())
    .filter(Boolean);

  // Right-to-left: "Sarıyer, Istanbul" and "Berlin, Germany" both resolve on
  // the rightmost recognizable segment (country beats city when both present).
  for (const seg of [...segments].reverse()) {
    if (NAME_TO_COUNTRY[seg]) return NAME_TO_COUNTRY[seg];
    // Two-letter segment as ISO code ("PL - Warsaw", "Berlin, DE")
    if (/^[a-z]{2}$/.test(seg) && KNOWN_COUNTRIES.has(seg) && seg !== "us") {
      // bare "us" collides with English words too rarely to matter, allow it too
      return seg;
    }
    if (seg === "us") return "us";
  }
  // Fallback: whole-string scan for any known name (handles "Greater London Area").
  for (const [name, c] of Object.entries(NAME_TO_COUNTRY)) {
    if (name.length >= 4 && norm.includes(name)) return c;
  }
  return null;
}

// ── Region gate (fixes the "Frankfurt, Allemagne" hole) ──────────────────────
// A resolved country passes the user's accept list when the list contains the
// country's code, its English/display name, or ANY region it belongs to
// ("europe"/"emea" entries act as region grants). Backward compatible with the
// legacy substring list — no config change needed.

const REGION_SYNONYMS: Record<string, string> = {
  europe: "emea", "european union": "eu", eu: "eu", emea: "emea", dach: "dach",
  nordics: "nordics", apac: "apac", americas: "americas", latam: "americas",
};

export function countryPassesAccept(country: string, acceptList: readonly string[]): boolean {
  const grants = new Set<string>([country, COUNTRY_NAMES[country]?.toLowerCase() ?? ""]);
  for (const r of regionsOf(country)) grants.add(r);
  for (const entry of acceptList) {
    const e = entry.toLowerCase().trim();
    if (grants.has(e)) return true;
    const regionKey = REGION_SYNONYMS[e];
    if (regionKey && REGIONS[regionKey]?.includes(country)) return true;
    if (NAME_TO_COUNTRY[e] === country) return true; // "germany", "türkiye", city names
  }
  return false;
}
