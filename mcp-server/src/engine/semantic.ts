import {
  tokenizeWords,
  extractSignificantTokens,
  countExactMatches,
  isTermPresentInText,
  detectSearchIntent,
  stemWord,
} from "./nlp.js";
import {
  SuggestSemanticTermsResult,
  SemanticTermItem,
} from "../types.js";

// Domain-specific semantic knowledge bases (local heuristics, zero external APIs)
const DOMAIN_CLUSTERS: Record<string, {
  keywords: string[];
  terms: Array<{
    term: string;
    category: SemanticTermItem["category"];
    relevance: SemanticTermItem["relevance"];
    reason: string;
  }>;
}> = {
  gardeningAndTomatoes: {
    keywords: [
      "tomato", "tomatoes", "vegetable", "vegetables", "gardening", "garden", "gardener",
      "plant", "planting", "horticulture", "grow tomatoes", "raised bed", "container garden"
    ],
    terms: [
      {
        term: "soil preparation",
        category: "core-entity",
        relevance: "high",
        reason: "Rich, well-aerated soil with compost and proper pH (6.0–6.8) is essential for root vigor and nutrient uptake.",
      },
      {
        term: "sunlight",
        category: "supporting-attribute",
        relevance: "high",
        reason: "Tomatoes need 6 to 8 hours of uninterrupted direct daily sun to stimulate flowering and fruit set.",
      },
      {
        term: "watering",
        category: "supporting-attribute",
        relevance: "high",
        reason: "Consistent, deep watering prevents calcium deficiency, blossom end rot, and fruit splitting.",
      },
      {
        term: "drainage",
        category: "supporting-attribute",
        relevance: "high",
        reason: "Adequate container or raised-bed drainage prevents waterlogged soil and root rot.",
      },
      {
        term: "seedlings",
        category: "core-entity",
        relevance: "high",
        reason: "Starting with hardened seedlings ensures faster establishment compared to direct outdoor sowing.",
      },
      {
        term: "pruning suckers",
        category: "intent-driver",
        relevance: "high",
        reason: "Pinching non-fruiting suckers directs energy toward fruit ripening and improves air circulation.",
      },
      {
        term: "stakes or cages",
        category: "core-entity",
        relevance: "high",
        reason: "Supporting stems keeps fruit off wet soil, reducing pests and fungal spore exposure.",
      },
      {
        term: "fertilizer",
        category: "supporting-attribute",
        relevance: "high",
        reason: "Balanced phosphorus and potassium promote flower blooming without causing excessive foliage overgrowth.",
      },
      {
        term: "mulch",
        category: "supporting-attribute",
        relevance: "medium",
        reason: "An organic mulch layer suppresses weeds, conserves moisture, and prevents soil splashing onto leaves.",
      },
      {
        term: "blight prevention",
        category: "intent-driver",
        relevance: "high",
        reason: "Proper plant spacing and bottom-watering minimize early and late blight foliar infections.",
      },
      {
        term: "container gardening",
        category: "core-entity",
        relevance: "medium",
        reason: "Growing patio or determinate varieties in 5-gallon pots allows high yields in limited spaces.",
      },
      {
        term: "determinate vs indeterminate",
        category: "core-entity",
        relevance: "medium",
        reason: "Classifies whether plants bush out and set fruit all at once or grow continuously as tall vines.",
      },
      {
        term: "harvesting",
        category: "intent-driver",
        relevance: "high",
        reason: "Harvesting tomatoes at the breaker stage allows full flavor and color development without cracking.",
      },
      {
        term: "transplanting depth",
        category: "intent-driver",
        relevance: "medium",
        reason: "Burying stems up to the lowest leaves prompts adventitious roots to grow, creating a stronger root ball.",
      },
      {
        term: "companion planting",
        category: "supporting-attribute",
        relevance: "medium",
        reason: "Growing basil or marigolds nearby helps deter nematodes, hornworms, and other common garden pests.",
      },
    ],
  },
  runningShoes: {
    keywords: ["running shoe", "running shoes", "sneaker", "sneakers", "runner", "footwear", "marathon"],
    terms: [
      { term: "cushioning", category: "core-entity", relevance: "high", reason: "Determines impact dampening and long-distance foot comfort." },
      { term: "midsole", category: "core-entity", relevance: "high", reason: "Houses the foam compound responsible for energy return and shock absorption." },
      { term: "outsole", category: "core-entity", relevance: "high", reason: "Provides grip, road traction, and long-term rubber durability." },
      { term: "arch support", category: "core-entity", relevance: "high", reason: "Stabilizes the foot arch to accommodate flat feet, neutral arches, or high arches." },
      { term: "breathability", category: "supporting-attribute", relevance: "high", reason: "Engineered upper mesh maintains ventilation and reduces blister risk." },
      { term: "durability", category: "supporting-attribute", relevance: "high", reason: "Key indicator of expected mileage lifespan before outsole or foam breakdown." },
      { term: "heel-to-toe drop", category: "core-entity", relevance: "high", reason: "Height differential between heel and forefoot influencing runner gait and cadence." },
      { term: "traction", category: "supporting-attribute", relevance: "high", reason: "Ensures wet pavement and light trail stability under varied weather conditions." },
      { term: "stability", category: "core-entity", relevance: "high", reason: "Features medial posting or guide rails to correct excessive inward rolling." },
      { term: "pronation", category: "core-entity", relevance: "high", reason: "Biomechanical foot roll (overpronation, neutral, supination) dictates shoe category." },
      { term: "toe box", category: "core-entity", relevance: "high", reason: "Width allowance in the forefoot preventing black toenails and bunion irritation." },
      { term: "daily trainer", category: "intent-driver", relevance: "high", reason: "Workhorse shoes designed for everyday mileage rather than race day speed." },
      { term: "trail running", category: "intent-driver", relevance: "medium", reason: "Off-road terrain requiring rock plates and aggressive lug patterns." },
      { term: "road running", category: "intent-driver", relevance: "high", reason: "Asphalt and pavement running emphasizing shock dissipation and lightweight smooth ride." },
      { term: "energy return", category: "supporting-attribute", relevance: "high", reason: "Propulsion percentage bounced back by high-rebound modern foams." },
      { term: "shock absorption", category: "supporting-attribute", relevance: "high", reason: "Mitigates repetitive joint stress on knees and shins during hard landings." },
      { term: "marathon", category: "intent-driver", relevance: "medium", reason: "26.2 mile distance requiring sustained cushioning and blister prevention." },
      { term: "carbon plate", category: "core-entity", relevance: "medium", reason: "Curved rigid composite plate enhancing rocker geometry for racing efficiency." },
      { term: "weight", category: "supporting-attribute", relevance: "high", reason: "Ounce-by-ounce measurement impacting running fatigue over extended distances." },
      { term: "fit and sizing", category: "intent-driver", relevance: "high", reason: "Guidance on half-size sizing up to accommodate foot swelling during long runs." },
    ],
  },
  techAndSoftware: {
    keywords: ["software", "tool", "app", "platform", "cloud", "api", "database", "ai", "plugin", "automation"],
    terms: [
      { term: "features", category: "core-entity", relevance: "high", reason: "Core functional capabilities that address target user workflows." },
      { term: "pricing", category: "intent-driver", relevance: "high", reason: "Tier breakdown and cost justification for decision makers." },
      { term: "integrations", category: "core-entity", relevance: "high", reason: "Interoperability with existing tech stack and workflow tools." },
      { term: "user interface", category: "supporting-attribute", relevance: "medium", reason: "Usability and learning curve for day-to-day operators." },
      { term: "performance", category: "supporting-attribute", relevance: "high", reason: "Speed, latency, and resource efficiency under operational loads." },
      { term: "security", category: "supporting-attribute", relevance: "high", reason: "Data encryption, privacy compliance, and authentication standards." },
      { term: "customer support", category: "intent-driver", relevance: "medium", reason: "Availability of SLAs, live chat, and onboarding documentation." },
      { term: "scalability", category: "supporting-attribute", relevance: "high", reason: "Ability to handle growing volume without architecture redesign." },
      { term: "pros and cons", category: "intent-driver", relevance: "high", reason: "Balanced evaluation highlighting strengths and trade-offs." },
      { term: "documentation", category: "supporting-attribute", relevance: "medium", reason: "Technical guides, tutorials, and API reference material." },
    ],
  },
  fitnessAndHealth: {
    keywords: ["workout", "fitness", "exercise", "diet", "nutrition", "weight loss", "muscle"],
    terms: [
      { term: "recovery", category: "core-entity", relevance: "high", reason: "Rest periods and sleep essential for muscle protein synthesis." },
      { term: "intensity", category: "supporting-attribute", relevance: "medium", reason: "Target effort levels that stimulate cardiovascular and strength adaptations." },
      { term: "hydration", category: "supporting-attribute", relevance: "high", reason: "Fluid intake supporting electrolyte balance and endurance capacity." },
      { term: "injury prevention", category: "intent-driver", relevance: "high", reason: "Warm-ups and mobility drills that protect joints and ligaments." },
      { term: "proper form", category: "intent-driver", relevance: "high", reason: "Biomechanically sound movement execution maximizing target muscle engagement." },
      { term: "consistency", category: "supporting-attribute", relevance: "medium", reason: "Adherence to routine over weeks and months to yield compounding gains." },
      { term: "heart rate", category: "core-entity", relevance: "medium", reason: "Target training zones corresponding to aerobic base and threshold capacity." },
      { term: "progressive overload", category: "core-entity", relevance: "high", reason: "Gradually increasing resistance or volume to continually stimulate growth." },
    ],
  },
  coffeeAndBrewing: {
    keywords: ["coffee", "espresso", "brew", "pour over", "cafe", "latte", "cappuccino", "dripper", "kettle", "aeropress"],
    terms: [
      { term: "bloom", category: "core-entity", relevance: "high", reason: "Initial degassing phase releasing trapped CO2 for uniform extraction." },
      { term: "grind size", category: "core-entity", relevance: "high", reason: "Particle diameter controlling water contact surface area and flow rate." },
      { term: "gooseneck kettle", category: "core-entity", relevance: "medium", reason: "Precision spout providing controlled, laminar water flow." },
      { term: "paper filter", category: "core-entity", relevance: "high", reason: "Filters micro-fines and oils for a clean, sediment-free cup profile." },
      { term: "coffee to water ratio", category: "supporting-attribute", relevance: "high", reason: "Standard brew ratio (e.g. 1:15 to 1:17) balancing strength and extraction." },
      { term: "dripper", category: "core-entity", relevance: "high", reason: "Conical or flat-bottom brewing vessel directing flow geometry." },
      { term: "brew time", category: "supporting-attribute", relevance: "high", reason: "Total contact duration preventing under-extraction sourness or over-extraction bitterness." },
      { term: "water temperature", category: "supporting-attribute", relevance: "high", reason: "Ideal extraction window (195°F–205°F / 90°C–96°C) for solubles dissolution." },
      { term: "extraction", category: "core-entity", relevance: "high", reason: "Total dissolved solids (TDS) percentage pulled from roasted grounds." },
      { term: "burr grinder", category: "core-entity", relevance: "medium", reason: "Produces consistent particle uniformity compared to blade choppers." },
      { term: "single origin", category: "intent-driver", relevance: "medium", reason: "Beans from a specific estate or region displaying terroir characteristics." },
      { term: "roast date", category: "supporting-attribute", relevance: "medium", reason: "Freshness indicator ensuring beans are within peak flavor window." },
      { term: "preheated", category: "supporting-attribute", relevance: "medium", reason: "Rinsing the brewer and vessel to prevent thermal drop during pouring." },
    ],
  },
  personalFinance: {
    keywords: ["budget", "budgeting", "finance", "financial", "saving", "savings", "debt", "money", "expense", "spending"],
    terms: [
      { term: "emergency fund", category: "core-entity", relevance: "high", reason: "3 to 6 months of living expenses set aside in a high-yield liquid account." },
      { term: "50/30/20 rule", category: "core-entity", relevance: "high", reason: "Popular allocation dividing take-home pay into needs, wants, and savings." },
      { term: "zero-based budgeting", category: "core-entity", relevance: "high", reason: "Framework assigning every single earned dollar a specific functional role." },
      { term: "envelope system", category: "core-entity", relevance: "medium", reason: "Cash-based discipline allocating fixed physical envelopes to variable categories." },
      { term: "savings rate", category: "supporting-attribute", relevance: "high", reason: "Percentage of income saved monthly, predicting time to financial independence." },
      { term: "net worth", category: "core-entity", relevance: "medium", reason: "Total assets minus total liabilities tracking overarching financial trajectory." },
      { term: "debt snowball", category: "intent-driver", relevance: "high", reason: "Payoff strategy targeting smallest balances first for psychological momentum." },
      { term: "debt avalanche", category: "intent-driver", relevance: "high", reason: "Mathematically optimal strategy prioritizing highest interest rate loans." },
      { term: "variable expenses", category: "core-entity", relevance: "high", reason: "Fluctuating costs (groceries, leisure) that offer the most immediate budget flexibility." },
      { term: "fixed expenses", category: "core-entity", relevance: "high", reason: "Non-negotiable recurring obligations (rent, insurance, loan minimums)." },
      { term: "expense tracking", category: "supporting-attribute", relevance: "high", reason: "Logging outflows daily or weekly to eliminate hidden spending leaks." },
      { term: "compound interest", category: "core-entity", relevance: "medium", reason: "Growth multiplier where earned returns generate their own subsequent returns." },
      { term: "credit score", category: "core-entity", relevance: "medium", reason: "Underwriting rating determining interest rates on mortgages and loans." },
      { term: "discretionary spending", category: "supporting-attribute", relevance: "medium", reason: "Non-essential outlays that can be dialed back during lean periods." },
      { term: "financial goals", category: "intent-driver", relevance: "high", reason: "Concrete milestones (house down payment, debt freedom) that anchor budgeting resolve." },
    ],
  },
  dogTraining: {
    keywords: ["dog training", "puppy training", "obedience", "potty training", "leash training", "clicker"],
    terms: [
      { term: "positive reinforcement", category: "core-entity", relevance: "high", reason: "Rewarding desired actions to strengthen repeatable behavioral patterns." },
      { term: "clicker training", category: "core-entity", relevance: "high", reason: "Using a sharp acoustic marker to signal exact moment of correct behavior." },
      { term: "crate training", category: "core-entity", relevance: "high", reason: "Establishing an enclosed safe haven aiding housebreaking and impulse control." },
      { term: "potty training", category: "core-entity", relevance: "high", reason: "Consistent outdoor scheduling and cue association for clean indoor living." },
      { term: "leash training", category: "core-entity", relevance: "high", reason: "Teaching loose-leash walking without pulling, lunging, or stress." },
      { term: "socialization", category: "supporting-attribute", relevance: "high", reason: "Controlled exposure to novel environments, sounds, and dogs during early weeks." },
      { term: "basic commands", category: "core-entity", relevance: "high", reason: "Foundational cues (sit, stay, come, down, leave it) essential for safety." },
      { term: "separation anxiety", category: "supporting-attribute", relevance: "high", reason: "Desensitizing departure cues to prevent distress barking and destruction." },
      { term: "recall training", category: "core-entity", relevance: "medium", reason: "High-value emergency recall command bringing dog back reliably off-leash." },
      { term: "reward-based training", category: "core-entity", relevance: "medium", reason: "Using high-value treats and praise rather than aversive punishment." },
      { term: "behavioral issues", category: "supporting-attribute", relevance: "high", reason: "Addressing root causes of reactivity, resource guarding, or jumping." },
      { term: "command consistency", category: "supporting-attribute", relevance: "medium", reason: "Ensuring all household members use identical vocal cues and hand signals." },
      { term: "training schedule", category: "intent-driver", relevance: "medium", reason: "Keeping training sessions short (5–10 mins) to maintain canine focus." },
      { term: "housebreaking", category: "core-entity", relevance: "medium", reason: "Establishing clear spatial boundaries between living areas and elimination spots." },
      { term: "muzzle training", category: "core-entity", relevance: "medium", reason: "Conditioning positive associations with basket muzzles for vet safety." },
      { term: "breed-specific traits", category: "supporting-attribute", relevance: "medium", reason: "Adapting methods to herding, hunting, or working instinct drives." },
    ],
  },
  solarEnergy: {
    keywords: ["solar panel", "solar energy", "solar power", "photovoltaic", "renewable energy"],
    terms: [
      { term: "photovoltaic cells", category: "core-entity", relevance: "high", reason: "Silicon semiconductors converting sunlight photons into direct electric current." },
      { term: "solar inverter", category: "core-entity", relevance: "high", reason: "Hardware converting DC solar power into usable household AC electricity." },
      { term: "roof mounting", category: "core-entity", relevance: "medium", reason: "Racking hardware engineered for wind-load stability and roof penetration sealing." },
      { term: "net metering", category: "core-entity", relevance: "high", reason: "Utility billing credit mechanism compensating homeowners for excess grid export." },
      { term: "kilowatt-hours", category: "supporting-attribute", relevance: "high", reason: "Standard metric quantifying electrical energy consumption and solar production." },
      { term: "energy production", category: "supporting-attribute", relevance: "medium", reason: "Annual solar yield dependent on geographic insolation and azimuth angles." },
      { term: "battery storage", category: "core-entity", relevance: "high", reason: "Home storage systems providing emergency backup power during grid blackouts." },
      { term: "panel efficiency", category: "supporting-attribute", relevance: "high", reason: "Percentage of absorbed solar radiation converted into electricity." },
      { term: "payback period", category: "intent-driver", relevance: "medium", reason: "Timeline in years before accumulated utility savings offset upfront capital cost." },
      { term: "monocrystalline", category: "core-entity", relevance: "medium", reason: "High-purity single-crystal silicon panels with top-tier efficiency ratings." },
      { term: "polycrystalline", category: "core-entity", relevance: "medium", reason: "Multi-crystal silicon panel alternative with lower initial cost and efficiency." },
      { term: "grid-tied", category: "core-entity", relevance: "medium", reason: "System synchronized with the local municipal electric distribution network." },
      { term: "shading losses", category: "supporting-attribute", relevance: "medium", reason: "Power drop caused by tree canopy or chimney obstructions across string arrays." },
      { term: "installation cost", category: "intent-driver", relevance: "high", reason: "Net outlay factoring in federal tax credits, local rebates, and labor." },
      { term: "warranty", category: "supporting-attribute", relevance: "medium", reason: "25-year performance guarantees securing solar panel equipment longevity." },
    ],
  },
  breadBaking: {
    keywords: ["sourdough", "bread", "baking", "levain", "yeast"],
    terms: [
      { term: "sourdough starter", category: "core-entity", relevance: "high", reason: "Symbiotic wild yeast and lactic acid bacteria culture driving leavening." },
      { term: "levain", category: "core-entity", relevance: "high", reason: "Offshoot starter build prepared with specific hydration for a dough batch." },
      { term: "hydration", category: "supporting-attribute", relevance: "high", reason: "Ratio of water to flour by weight determining crumb openness and handling." },
      { term: "autolyse", category: "core-entity", relevance: "medium", reason: "Initial flour and water rest period initiating enzymatic gluten breakdown." },
      { term: "bulk fermentation", category: "core-entity", relevance: "high", reason: "Primary fermentation stage developing gas bubbles, flavor, and dough strength." },
      { term: "proofing", category: "core-entity", relevance: "high", reason: "Final shaped dough fermentation prior to high-heat oven baking." },
      { term: "banneton", category: "core-entity", relevance: "medium", reason: "Rattan proofing basket supporting dough structure and wicking outer moisture." },
      { term: "scoring", category: "supporting-attribute", relevance: "medium", reason: "Slashing dough with a lame to control expansion and produce an ear." },
      { term: "crumb", category: "core-entity", relevance: "high", reason: "Internal loaf hole structure ranging from tight sandwich to open artisan." },
      { term: "gluten development", category: "supporting-attribute", relevance: "high", reason: "Protein network created via stretch-and-folds trapping fermentation gases." },
      { term: "sourdough discard", category: "core-entity", relevance: "medium", reason: "Unfed starter volume repurposed for pancakes, crackers, and quick breads." },
      { term: "feeding schedule", category: "supporting-attribute", relevance: "medium", reason: "Flour and water refresh intervals keeping microbiological cultures active." },
      { term: "dutch oven", category: "core-entity", relevance: "high", reason: "Heavy cast-iron vessel trapping steam for maximum oven spring and thin crust." },
      { term: "bread flour", category: "core-entity", relevance: "medium", reason: "High-protein flour (12%–14%) delivering strong elastic gluten strands." },
      { term: "oven spring", category: "supporting-attribute", relevance: "medium", reason: "Rapid initial rise in the first 10 minutes of baking before crust sets." },
    ],
  },
  outdoorGear: {
    keywords: ["hiking", "backpack", "trail", "camping", "daypack"],
    terms: [
      { term: "hip belt", category: "core-entity", relevance: "high", reason: "Transfers 80% of pack weight off the shoulders onto the skeletal hips." },
      { term: "load lifters", category: "core-entity", relevance: "medium", reason: "Shoulder strap adjusters that pull pack weight forward against the torso." },
      { term: "pack volume", category: "core-entity", relevance: "high", reason: "Capacity in liters matched to day hikes (20L) vs multi-day treks (50L+)." },
      { term: "torso length", category: "core-entity", relevance: "high", reason: "Crucial anatomical measurement between C7 vertebra and iliac crest for proper fit." },
      { term: "rain cover", category: "supporting-attribute", relevance: "medium", reason: "Waterproof outer shield protecting pack contents during mountain squalls." },
      { term: "hydration bladder", category: "core-entity", relevance: "medium", reason: "Hands-free water reservoir sleeve with dedicated drinking tube port." },
      { term: "ventilated back panel", category: "supporting-attribute", relevance: "medium", reason: "Tensioned mesh frame promoting airflow to reduce back sweating." },
      { term: "frame sheet", category: "core-entity", relevance: "medium", reason: "Internal support structure preventing pack contents from poking into spine." },
      { term: "pack weight", category: "supporting-attribute", relevance: "high", reason: "Base empty weight directly affecting hiker efficiency and joint strain." },
      { term: "compression straps", category: "supporting-attribute", relevance: "medium", reason: "Cinched straps stabilizing loose gear close to the body's center of gravity." },
      { term: "gear organization", category: "supporting-attribute", relevance: "medium", reason: "Accessibility of essential items like first-aid, layers, and snacks." },
      { term: "thru-hiking", category: "intent-driver", relevance: "medium", reason: "Long-distance continuous backpacking demanding durable ultralight gear." },
      { term: "daypack", category: "core-entity", relevance: "medium", reason: "Streamlined single-day pack built for light loads and rapid movement." },
      { term: "load distribution", category: "supporting-attribute", relevance: "high", reason: "Packing heaviest items near spine center to maintain trail balance." },
      { term: "pack liner", category: "core-entity", relevance: "medium", reason: "Internal waterproof dry-bag liner securing sleeping bag and dry clothes." },
    ],
  },
  guitarLearning: {
    keywords: ["guitar", "chord", "strumming", "fingerpicking", "fretboard"],
    terms: [
      { term: "power chords", category: "core-entity", relevance: "high", reason: "Two-note root-fifth chord shape fundamental to rock and pop guitar." },
      { term: "barre chords", category: "core-entity", relevance: "high", reason: "Index finger clamping across all strings unlocking movable chord shapes." },
      { term: "fingerpicking", category: "core-entity", relevance: "high", reason: "Plucking individual strings with right-hand fingers for acoustic texture." },
      { term: "strumming patterns", category: "core-entity", relevance: "high", reason: "Rhythmic down-up wrist movement establishing song tempo and groove." },
      { term: "chord transitions", category: "supporting-attribute", relevance: "high", reason: "Practicing fluid muscle memory changes between open chords without pausing." },
      { term: "fretboard", category: "core-entity", relevance: "high", reason: "Fingerboard navigation, fret markers, and chromatic note positions." },
      { term: "tuning", category: "supporting-attribute", relevance: "high", reason: "Standard EADGBE pitch calibration required before every practice session." },
      { term: "capo", category: "core-entity", relevance: "medium", reason: "Clamp raising string pitch to easily transpose songs into comfortable vocal keys." },
      { term: "scales", category: "core-entity", relevance: "medium", reason: "Pentatonic and major scale patterns forming the vocabulary for soloing." },
      { term: "arpeggio", category: "core-entity", relevance: "medium", reason: "Playing chord notes sequentially rather than struck simultaneously." },
      { term: "practice routine", category: "intent-driver", relevance: "high", reason: "Daily structured 20-minute drill schedule yielding consistent finger dexterity." },
      { term: "hand positioning", category: "supporting-attribute", relevance: "medium", reason: "Curling fingertips perpendicular to fret wire to avoid muting adjacent strings." },
      { term: "tablature", category: "core-entity", relevance: "medium", reason: "Intuitive 6-line notation showing exact fret numbers without standard music notation." },
      { term: "calluses", category: "supporting-attribute", relevance: "medium", reason: "Protective fingertip skin hardening acquired over the first 3 weeks of practice." },
      { term: "metronome", category: "supporting-attribute", relevance: "medium", reason: "Audible click tool developing steady internal timing and subdivision feel." },
    ],
  },
};

// Generic intent modifiers for reviews / comparisons
const REVIEW_INTENT_TERMS: Array<{
  term: string;
  category: SemanticTermItem["category"];
  relevance: SemanticTermItem["relevance"];
  reason: string;
}> = [
  { term: "pros and cons", category: "intent-driver", relevance: "high", reason: "Highlights balanced trade-offs so readers can weigh strengths against limitations." },
  { term: "buying guide", category: "intent-driver", relevance: "high", reason: "Provides clear selection criteria and considerations before making a purchasing decision." },
  { term: "value for money", category: "intent-driver", relevance: "high", reason: "Evaluates pricing and features relative to competitor alternatives." },
  { term: "durability", category: "supporting-attribute", relevance: "high", reason: "Assesses build quality and expected lifespan under real-world usage." },
  { term: "testing methodology", category: "intent-driver", relevance: "medium", reason: "Explains evaluation criteria to establish review credibility." },
  { term: "verdict", category: "intent-driver", relevance: "high", reason: "Delivers a definitive recommendation summarizing who should or should not choose this option." },
  { term: "key features", category: "core-entity", relevance: "high", reason: "Details standout capabilities and specifications central to the product or topic." },
];

/**
 * Natural topical concepts generated for uncurated topics.
 * Weaves keyword tokens grammatically to maintain 100% topic relevance
 * while generating natural concepts instead of robotic checklist/benefits suffixes.
 */
function generateNaturalFallbackTerms(
  keyword: string
): Array<{
  term: string;
  category: SemanticTermItem["category"];
  relevance: SemanticTermItem["relevance"];
  reason: string;
}> {
  const kwTokens = extractSignificantTokens(keyword);
  const cleanKw = keyword.trim().toLowerCase();

  // Natural editorial angles using the full topic phrase
  return [
    {
      term: `${cleanKw} step-by-step guide`,
      category: "intent-driver",
      relevance: "high",
      reason: `Provides an actionable roadmap breaking down ${cleanKw} into manageable execution stages.`,
    },
    {
      term: `essential ${cleanKw} techniques`,
      category: "core-entity",
      relevance: "high",
      reason: `Covers foundational skills and methods required to succeed with ${cleanKw}.`,
    },
    {
      term: `common ${cleanKw} mistakes to avoid`,
      category: "intent-driver",
      relevance: "high",
      reason: `Identifies frequent pitfalls and misconceptions that hinder progress in ${cleanKw}.`,
    },
    {
      term: `best practices for ${cleanKw}`,
      category: "intent-driver",
      relevance: "high",
      reason: `Outlines proven industry-standard principles and guidelines for ${cleanKw}.`,
    },
    {
      term: `${cleanKw} tools and materials`,
      category: "core-entity",
      relevance: "high",
      reason: `Specifies required equipment, supplies, or software needed for effective ${cleanKw}.`,
    },
    {
      term: `${cleanKw} for beginners`,
      category: "intent-driver",
      relevance: "high",
      reason: `Addresses introductory considerations, basic terminology, and initial setup steps.`,
    },
    {
      term: `${cleanKw} troubleshooting`,
      category: "supporting-attribute",
      relevance: "medium",
      reason: `Helps diagnose and resolve typical errors or complications encountered in ${cleanKw}.`,
    },
    {
      term: `key principles of ${cleanKw}`,
      category: "core-entity",
      relevance: "medium",
      reason: `Explains core underlying mechanisms and concepts governing ${cleanKw}.`,
    },
    {
      term: `${cleanKw} maintenance and care`,
      category: "supporting-attribute",
      relevance: "medium",
      reason: `Ensures long-term sustainability, ongoing monitoring, and preservation of results.`,
    },
    {
      term: `${cleanKw} workflow optimization`,
      category: "supporting-attribute",
      relevance: "medium",
      reason: `Streamlines routine tasks to save time and increase overall efficiency.`,
    },
    {
      term: `${cleanKw} safety considerations`,
      category: "supporting-attribute",
      relevance: "medium",
      reason: `Highlights crucial precautions and risk management measures when handling ${cleanKw}.`,
    },
    {
      term: `${cleanKw} frequently asked questions`,
      category: "intent-driver",
      relevance: "medium",
      reason: `Answers common reader inquiries and clarifies ambiguous details about ${cleanKw}.`,
    },
  ];
}

/** Whole-word match check */
function mentionsPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}s?\\b`, "i").test(haystack);
}

function startsWithWord(text: string, word: string): boolean {
  return text === word || text.startsWith(`${word} `);
}

export function suggestSemanticTerms(
  content: string,
  keyword: string
): SuggestSemanticTermsResult {
  const normalizedKeyword = keyword.toLowerCase().trim();
  const lowerContent = content.toLowerCase();
  const evaluatedTermsMap = new Map<
    string,
    {
      category: SemanticTermItem["category"];
      relevance: SemanticTermItem["relevance"];
      reason: string;
    }
  >();

  // 1. Check matching domain clusters (anchored to search keyword)
  for (const cluster of Object.values(DOMAIN_CLUSTERS)) {
    const matchesDomain = cluster.keywords.some((dk) =>
      mentionsPhrase(normalizedKeyword, dk)
    );
    if (matchesDomain) {
      for (const t of cluster.terms) {
        evaluatedTermsMap.set(t.term, {
          category: t.category,
          relevance: t.relevance,
          reason: t.reason,
        });
      }
    }
  }

  // 2. Add commercial/review intent terms if applicable
  const intent = detectSearchIntent(keyword, content);
  if (intent === "Commercial") {
    for (const t of REVIEW_INTENT_TERMS) {
      if (!evaluatedTermsMap.has(t.term)) {
        evaluatedTermsMap.set(t.term, {
          category: t.category,
          relevance: t.relevance,
          reason: t.reason,
        });
      }
    }
  }

  // 3. Fallback: if fewer than 10 terms found, generate natural keyword-anchored terms
  if (evaluatedTermsMap.size < 10) {
    const fallbackTerms = generateNaturalFallbackTerms(keyword);
    for (const fb of fallbackTerms) {
      if (!evaluatedTermsMap.has(fb.term)) {
        evaluatedTermsMap.set(fb.term, {
          category: fb.category,
          relevance: fb.relevance,
          reason: fb.reason,
        });
      }
    }
  }

  // 4. Evaluate present vs missing terms using morphological and semantic matching
  const presentTerms: SemanticTermItem[] = [];
  const missingTerms: SemanticTermItem[] = [];

  for (const [term, meta] of evaluatedTermsMap.entries()) {
    const isPresent = isTermPresentInText(content, term);
    const count = isPresent ? Math.max(1, countExactMatches(content, term)) : 0;

    const item: SemanticTermItem = {
      term,
      category: meta.category,
      relevance: meta.relevance,
      reason: meta.reason,
    };

    if (isPresent) {
      presentTerms.push({ ...item, count });
    } else {
      missingTerms.push(item);
    }
  }

  // Sort: high relevance first, then core-entity -> intent-driver -> supporting-attribute
  const categoryOrder = { "core-entity": 1, "intent-driver": 2, "supporting-attribute": 3 };
  missingTerms.sort((a, b) => {
    if (a.relevance !== b.relevance) return a.relevance === "high" ? -1 : 1;
    return categoryOrder[a.category] - categoryOrder[b.category];
  });

  presentTerms.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  // Actionable advice for content creator
  const actionableAdvice: string[] = [
    `Found ${presentTerms.length} covered semantic concepts and identified ${missingTerms.length} topical opportunities for '${keyword}'.`,
  ];

  if (missingTerms.length > 0) {
    const topMissing = missingTerms.slice(0, 3).map((t) => `'${t.term}'`).join(", ");
    actionableAdvice.push(
      `Prioritize weaving in ${topMissing} within relevant subheadings or explanatory paragraphs to improve topical authority.`
    );
    actionableAdvice.push(
      "Incorporate missing entities naturally as part of comprehensive explanations rather than stuffing phrases verbatim."
    );
  } else {
    actionableAdvice.push(
      "Outstanding topical depth! Your article thoroughly covers the essential entities and subtopics for this subject."
    );
  }

  return {
    keyword,
    totalTermsEvaluated: evaluatedTermsMap.size,
    presentTermsCount: presentTerms.length,
    missingTermsCount: missingTerms.length,
    presentTerms,
    missingTerms,
    actionableAdvice,
  };
}
