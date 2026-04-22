// Committed, PR-reviewed lists of entity-level decisions that apply
// corpus-wide. On every indexes-stage run we ensure these are reflected
// in data/aliases.json (added if missing, never removed — operator
// overrides via ⋯ menu still win).
//
// Guidance for adding entries:
//   - DELETE_ALWAYS: entities that are never graph-worthy on this corpus.
//     Role nouns ("person:scientists"), generic nouns
//     ("organization:government"), transcript / outro artifacts
//     ("work_of_media:music", "organization:patreon"), tautologies
//     ("technology:technology").
//   - ALWAYS_PROMOTE: short forms of famous names that are unambiguous in
//     this corpus. Only applied when BOTH endpoints exist in the corpus.

export interface DeleteAlwaysEntry {
  key: string;
  reason: string;
}

export interface AlwaysPromoteEntry {
  from: string;
  to: string;
  rationale: string;
}

// Whole labels that are never graph-worthy on this corpus. The indexes-
// stage hook deletes every entity with one of these labels and emits
// one `deletedEntities` entry per key. Operator assessment (2026-04-21):
// these labels capture mostly generic/role/quantity nouns whose
// individual merits do not justify a per-entity audit.
export const DELETE_LABELS: Array<{ label: string; reason: string }> = [
  { label: "quantity", reason: "entire label is generic numeric nouns with no graph value" },
  { label: "role", reason: "entire label is role/occupation nouns (doctor, scientist, etc.) not specific persons" },
  { label: "law_or_policy", reason: "entire label is mostly generic policy/rule/law nouns; specific named laws go under work_of_media or event" },
];

// ---- DELETE_ALWAYS ---------------------------------------------------

export const DELETE_ALWAYS: DeleteAlwaysEntry[] = [
  // Transcript cue-tag artifacts
  { key: "work_of_media:music", reason: "[music] cue tag" },
  { key: "work_of_media:[music]", reason: "[music] cue tag" },
  { key: "work_of_media:applause", reason: "[applause] cue tag" },
  { key: "work_of_media:[applause]", reason: "[applause] cue tag" },
  { key: "work_of_media:laughter", reason: "[laughter] cue tag" },
  { key: "work_of_media:[laughter]", reason: "[laughter] cue tag" },
  { key: "work_of_media:podcast", reason: "generic noun; outro pollution" },

  // YouTube / platform outro mentions
  { key: "organization:channel", reason: "outro: 'like and subscribe to the channel'" },
  { key: "organization:patreon", reason: "outro: Patreon plug" },
  { key: "organization:discord", reason: "outro: Discord plug" },
  { key: "organization:youtube", reason: "outro/meta: YouTube platform mention" },
  { key: "organization:wi files", reason: "outro: 'Y-Files' branding / show identifier" },

  // Role nouns mislabeled as persons
  { key: "person:scientists", reason: "role noun, not a person" },
  { key: "person:scientist", reason: "role noun, not a person" },
  { key: "person:researchers", reason: "role noun, not a person" },
  { key: "person:researcher", reason: "role noun, not a person" },
  { key: "person:witnesses", reason: "role noun, not a person" },
  { key: "person:witness", reason: "role noun, not a person" },
  { key: "person:officers", reason: "role noun, not a person" },
  { key: "person:officer", reason: "role noun, not a person" },
  { key: "person:astronauts", reason: "role noun, not a person" },
  { key: "person:astronaut", reason: "role noun, not a person" },
  { key: "person:farmer", reason: "role noun, not a person" },
  { key: "person:farmers", reason: "role noun, not a person" },
  { key: "person:sheriff", reason: "role noun, not a person" },
  { key: "person:priest", reason: "role noun, not a person" },
  { key: "person:captain", reason: "role noun when standalone; specific captains are first-name+last-name" },
  { key: "person:colonel", reason: "role noun when standalone" },
  { key: "person:general", reason: "role noun when standalone; specific generals are first-name+last-name" },
  { key: "person:admiral", reason: "role noun when standalone" },
  { key: "person:king", reason: "role noun when standalone" },
  { key: "person:queen", reason: "role noun when standalone" },
  { key: "person:pope", reason: "role noun when standalone" },
  { key: "person:doctor", reason: "role noun when standalone" },
  { key: "person:pilot", reason: "role noun when standalone" },
  { key: "person:driver", reason: "role noun when standalone" },
  { key: "person:worker", reason: "role noun when standalone" },
  { key: "person:workers", reason: "role noun when standalone" },
  { key: "person:employee", reason: "role noun when standalone" },
  { key: "person:agent", reason: "role noun when standalone" },
  { key: "person:agents", reason: "role noun when standalone" },
  { key: "person:spy", reason: "role noun when standalone" },
  { key: "person:spies", reason: "role noun when standalone" },
  { key: "person:soldier", reason: "role noun when standalone" },
  { key: "person:soldiers", reason: "role noun when standalone" },

  // Generic persons
  { key: "person:people", reason: "generic noun, not a person" },
  { key: "person:person", reason: "generic noun, not a person" },
  { key: "person:persons", reason: "generic noun, not a person" },
  { key: "person:man", reason: "generic noun, not a person" },
  { key: "person:men", reason: "generic noun, not a person" },
  { key: "person:woman", reason: "generic noun, not a person" },
  { key: "person:women", reason: "generic noun, not a person" },
  { key: "person:boy", reason: "generic noun, not a person" },
  { key: "person:girl", reason: "generic noun, not a person" },
  { key: "person:children", reason: "generic noun, not a person" },
  { key: "person:child", reason: "generic noun, not a person" },
  { key: "person:baby", reason: "generic noun, not a person" },
  { key: "person:human", reason: "generic noun, not a person" },
  { key: "person:humans", reason: "generic noun, not a person" },
  { key: "person:family", reason: "generic noun, not a person" },
  { key: "person:wife", reason: "relationship noun, not a person" },
  { key: "person:husband", reason: "relationship noun, not a person" },
  { key: "person:mother", reason: "relationship noun, not a person" },
  { key: "person:father", reason: "relationship noun, not a person" },
  { key: "person:son", reason: "relationship noun, not a person" },
  { key: "person:daughter", reason: "relationship noun, not a person" },
  { key: "person:brother", reason: "relationship noun, not a person" },
  { key: "person:sister", reason: "relationship noun, not a person" },
  { key: "person:parent", reason: "relationship noun, not a person" },
  { key: "person:parents", reason: "relationship noun, not a person" },

  // Generic orgs / institutions (too broad to be entities on their own;
  // specific forms like "US government", "British army" remain intact)
  { key: "organization:scientists", reason: "role noun, not an organization" },
  { key: "organization:researchers", reason: "role noun, not an organization" },
  { key: "organization:witnesses", reason: "role noun, not an organization" },
  { key: "organization:government", reason: "too generic; specific 'US government' / 'British government' kept" },
  { key: "organization:governments", reason: "too generic" },
  { key: "organization:military", reason: "too generic; specific branches kept" },
  { key: "organization:army", reason: "too generic when standalone; specific armies kept" },
  { key: "organization:navy", reason: "too generic when standalone; specific navies kept" },
  { key: "organization:police", reason: "too generic when standalone; specific forces kept" },
  { key: "organization:church", reason: "too generic when standalone; specific churches kept" },
  { key: "organization:company", reason: "generic noun" },
  { key: "organization:corporation", reason: "generic noun" },
  { key: "organization:organization", reason: "tautology" },
  { key: "organization:group", reason: "generic noun" },
  { key: "organization:team", reason: "generic noun" },
  { key: "organization:agency", reason: "generic noun; specific agencies kept" },
  { key: "organization:bureau", reason: "generic noun; specific bureaus kept" },
  { key: "organization:department", reason: "generic noun" },
  { key: "organization:office", reason: "generic noun" },
  { key: "organization:network", reason: "generic noun" },

  // Scope-of-corpus locations
  { key: "location:earth", reason: "universal scope; trivial for nearly every video" },
  { key: "location:world", reason: "universal scope; trivial" },
  { key: "location:the world", reason: "universal scope; trivial" },
  { key: "location:planet", reason: "universal scope; trivial" },
  { key: "location:the planet", reason: "universal scope; trivial" },
  { key: "location:house", reason: "generic location" },
  { key: "location:home", reason: "generic location" },
  { key: "location:room", reason: "generic location" },
  { key: "location:building", reason: "generic location" },
  { key: "location:street", reason: "generic location" },
  { key: "location:road", reason: "generic location" },
  { key: "location:city", reason: "generic location" },
  { key: "location:town", reason: "generic location" },
  { key: "location:village", reason: "generic location" },
  { key: "location:country", reason: "generic location" },
  { key: "location:state", reason: "generic location" },

  // Tech tautologies / too-generic tech
  { key: "technology:technology", reason: "tautology" },
  { key: "technology:tech", reason: "tautology" },
  { key: "technology:system", reason: "generic noun" },
  { key: "technology:systems", reason: "generic noun" },
  { key: "technology:device", reason: "generic noun" },
  { key: "technology:devices", reason: "generic noun" },
  { key: "technology:machine", reason: "generic noun" },
  { key: "technology:machines", reason: "generic noun" },
  { key: "technology:object", reason: "generic noun" },
  { key: "technology:objects", reason: "generic noun" },

  // Generic quantities — keep specific numeric values that tie to an event
  { key: "quantity:thousands", reason: "generic quantity, no proper-noun value" },
  { key: "quantity:hundreds", reason: "generic quantity" },
  { key: "quantity:millions", reason: "generic quantity" },
  { key: "quantity:billions", reason: "generic quantity" },
  { key: "quantity:dozens", reason: "generic quantity" },
  { key: "quantity:dozen", reason: "generic quantity" },
  { key: "quantity:many", reason: "generic quantity" },
  { key: "quantity:several", reason: "generic quantity" },
  { key: "quantity:few", reason: "generic quantity" },
  { key: "quantity:three bucks", reason: "per-video patron tier mention, not a graph-worthy quantity" },
  { key: "quantity:five bucks", reason: "per-video patron tier mention" },
  { key: "quantity:ten bucks", reason: "per-video patron tier mention" },

  // Generic events
  { key: "event:meeting", reason: "generic noun" },
  { key: "event:war", reason: "too generic when standalone" },
  { key: "event:battle", reason: "too generic when standalone" },
  { key: "event:crash", reason: "too generic when standalone" },
  { key: "event:accident", reason: "too generic when standalone" },
  { key: "event:incident", reason: "too generic when standalone" },
  { key: "event:conspiracy", reason: "too generic when standalone" },
  { key: "event:death", reason: "too generic when standalone" },
  { key: "event:murder", reason: "too generic when standalone" },
  { key: "event:fire", reason: "too generic when standalone" },
  { key: "event:flood", reason: "too generic when standalone" },
  { key: "event:earthquake", reason: "too generic when standalone" },
  { key: "event:storm", reason: "too generic when standalone" },

  // Generic facilities
  { key: "facility:base", reason: "generic noun" },
  { key: "facility:airport", reason: "generic noun when standalone" },
  { key: "facility:airfield", reason: "generic noun when standalone" },
  { key: "facility:hotel", reason: "generic noun when standalone" },
  { key: "facility:hospital", reason: "generic noun when standalone" },
  { key: "facility:school", reason: "generic noun when standalone" },
  { key: "facility:prison", reason: "generic noun when standalone" },
];

// ---- ALWAYS_PROMOTE --------------------------------------------------
//
// Target canonicals that should swallow their famous short forms. Only
// applied when BOTH endpoints exist in the corpus (indexes-stage hook
// checks).

export const ALWAYS_PROMOTE: AlwaysPromoteEntry[] = [
  // Host (AJ Gentile is the host of every video in this corpus)
  { from: "person:aj", to: "person:aj gentile", rationale: "host of every video in the corpus" },

  // Famous inventors / scientists
  { from: "person:tesla", to: "person:nikola tesla", rationale: "famous inventor; 'tesla' standalone refers to Nikola Tesla in this corpus" },
  { from: "person:einstein", to: "person:albert einstein", rationale: "famous physicist" },
  { from: "person:newton", to: "person:isaac newton", rationale: "famous physicist" },
  { from: "person:darwin", to: "person:charles darwin", rationale: "famous naturalist" },
  { from: "person:edison", to: "person:thomas edison", rationale: "famous inventor" },
  { from: "person:hawking", to: "person:stephen hawking", rationale: "famous physicist" },
  { from: "person:feynman", to: "person:richard feynman", rationale: "famous physicist" },

  // 20th century political / military
  { from: "person:hitler", to: "person:adolf hitler", rationale: "WWII political figure" },
  { from: "person:stalin", to: "person:joseph stalin", rationale: "Soviet leader" },
  { from: "person:churchill", to: "person:winston churchill", rationale: "British PM" },
  { from: "person:roosevelt", to: "person:franklin d. roosevelt", rationale: "US president" },
  { from: "person:eisenhower", to: "person:dwight d. eisenhower", rationale: "US president" },
  { from: "person:truman", to: "person:harry s. truman", rationale: "US president" },
  { from: "person:kennedy", to: "person:john f. kennedy", rationale: "US president (most commonly referred to)" },
  { from: "person:jfk", to: "person:john f. kennedy", rationale: "US president" },
  { from: "person:nixon", to: "person:richard nixon", rationale: "US president" },
  { from: "person:reagan", to: "person:ronald reagan", rationale: "US president" },
  { from: "person:clinton", to: "person:bill clinton", rationale: "US president (most commonly referred to)" },

  // Historical figures
  { from: "person:columbus", to: "person:christopher columbus", rationale: "explorer" },
  { from: "person:lincoln", to: "person:abraham lincoln", rationale: "US president" },
  { from: "person:washington", to: "person:george washington", rationale: "US president" },
  { from: "person:jefferson", to: "person:thomas jefferson", rationale: "US president" },
  { from: "person:napoleon", to: "person:napoleon bonaparte", rationale: "French emperor" },

  // Orgs — common abbreviations
  { from: "organization:the cia", to: "organization:cia", rationale: "determiner dedup" },
  { from: "organization:the fbi", to: "organization:fbi", rationale: "determiner dedup" },
  { from: "organization:the nsa", to: "organization:nsa", rationale: "determiner dedup" },
  { from: "organization:the nasa", to: "organization:nasa", rationale: "determiner dedup" },
  { from: "organization:the pentagon", to: "organization:pentagon", rationale: "determiner dedup" },
  { from: "organization:the air force", to: "organization:air force", rationale: "determiner dedup" },
  { from: "organization:the navy", to: "organization:us navy", rationale: "'the navy' in US-centric host corpus is the US Navy" },
  { from: "organization:the army", to: "organization:us army", rationale: "'the army' in US-centric host corpus is the US Army" },

  // Locations — determiner dedup (handled by existing corpus 'the X' rule
  // in propose.mjs, but repeated here for safety on popular names)
  { from: "location:the moon", to: "location:moon", rationale: "determiner dedup" },
  { from: "location:the sun", to: "location:sun", rationale: "determiner dedup" },
  { from: "location:the united states", to: "location:united states", rationale: "determiner dedup" },

  // Location synonyms (Plan 02 Part A expansion)
  { from: "location:america", to: "location:united states", rationale: "US-centric host corpus — 'America' is the United States" },
  { from: "location:the us", to: "location:united states", rationale: "acronym expansion" },
  { from: "location:usa", to: "location:united states", rationale: "acronym expansion" },
  { from: "location:u.s.", to: "location:united states", rationale: "acronym expansion" },
  { from: "location:u.s.a.", to: "location:united states", rationale: "acronym expansion" },
  { from: "location:u.s.a", to: "location:united states", rationale: "acronym expansion" },
  { from: "location:uk", to: "location:united kingdom", rationale: "acronym expansion" },
  { from: "location:u.k.", to: "location:united kingdom", rationale: "acronym expansion" },
  { from: "location:britain", to: "location:united kingdom", rationale: "synonym" },
  { from: "location:great britain", to: "location:united kingdom", rationale: "synonym" },
  { from: "location:england", to: "location:united kingdom", rationale: "commonly conflated in host corpus; keep if you want separate" },
  { from: "location:ussr", to: "location:soviet union", rationale: "acronym expansion" },
  { from: "location:u.s.s.r.", to: "location:soviet union", rationale: "acronym expansion" },
  { from: "location:the soviet union", to: "location:soviet union", rationale: "determiner dedup" },

  // More famous persons — historical / political / scientific
  { from: "person:galileo", to: "person:galileo galilei", rationale: "famous astronomer" },
  { from: "person:da vinci", to: "person:leonardo da vinci", rationale: "famous polymath" },
  { from: "person:leonardo", to: "person:leonardo da vinci", rationale: "corpus reference is the historical figure" },
  { from: "person:aristotle", to: "person:aristotle", rationale: "canonical single-name" },
  { from: "person:plato", to: "person:plato", rationale: "canonical single-name" },
  { from: "person:socrates", to: "person:socrates", rationale: "canonical single-name" },
  { from: "person:buddha", to: "person:gautama buddha", rationale: "disambiguation" },
  { from: "person:muhammad", to: "person:muhammad", rationale: "canonical single-name" },
  { from: "person:jesus", to: "person:jesus christ", rationale: "fuller form" },

  // UFO / fringe-science recurring figures commonly referenced by surname
  { from: "person:sagan", to: "person:carl sagan", rationale: "famous astronomer" },
  { from: "person:oppenheimer", to: "person:j. robert oppenheimer", rationale: "Manhattan Project lead" },
  { from: "person:curie", to: "person:marie curie", rationale: "famous scientist" },
  { from: "person:mao", to: "person:mao zedong", rationale: "Chinese leader" },
  { from: "person:gandhi", to: "person:mahatma gandhi", rationale: "Indian leader" },
  { from: "person:castro", to: "person:fidel castro", rationale: "Cuban leader" },
  { from: "person:lenin", to: "person:vladimir lenin", rationale: "Soviet leader" },
  { from: "person:trotsky", to: "person:leon trotsky", rationale: "Soviet leader" },
  { from: "person:mussolini", to: "person:benito mussolini", rationale: "Italian fascist leader" },
  { from: "person:franco", to: "person:francisco franco", rationale: "Spanish dictator" },
  { from: "person:de gaulle", to: "person:charles de gaulle", rationale: "French president" },
  { from: "person:thatcher", to: "person:margaret thatcher", rationale: "UK PM" },
  { from: "person:blair", to: "person:tony blair", rationale: "UK PM" },
  { from: "person:obama", to: "person:barack obama", rationale: "US president" },
  { from: "person:biden", to: "person:joe biden", rationale: "US president" },
  { from: "person:trump", to: "person:donald trump", rationale: "US president" },
  { from: "person:bush", to: "person:george w. bush", rationale: "most commonly referenced Bush" },
  { from: "person:carter", to: "person:jimmy carter", rationale: "US president" },
  { from: "person:ford", to: "person:gerald ford", rationale: "US president (context-dependent; may need unmerge for Henry Ford)" },
  { from: "person:reagan", to: "person:ronald reagan", rationale: "US president" },
  { from: "person:fdr", to: "person:franklin d. roosevelt", rationale: "common acronym" },

  // Tech / business
  { from: "person:gates", to: "person:bill gates", rationale: "Microsoft founder" },
  { from: "person:jobs", to: "person:steve jobs", rationale: "Apple founder" },
  { from: "person:musk", to: "person:elon musk", rationale: "Tesla/SpaceX founder" },
  { from: "person:bezos", to: "person:jeff bezos", rationale: "Amazon founder" },
  { from: "person:zuckerberg", to: "person:mark zuckerberg", rationale: "Facebook founder" },

  // Fringe / paranormal researchers commonly in this corpus
  { from: "person:keel", to: "person:john keel", rationale: "Mothman author" },
  { from: "person:hynek", to: "person:j. allen hynek", rationale: "UFO researcher" },
  { from: "person:vallee", to: "person:jacques vallée", rationale: "UFO researcher" },
  { from: "person:greer", to: "person:steven greer", rationale: "disclosure advocate" },
  { from: "person:corso", to: "person:philip j. corso", rationale: "The Day After Roswell author" },
  { from: "person:lazar", to: "person:bob lazar", rationale: "Area 51 claimant" },
  { from: "person:dolan", to: "person:richard dolan", rationale: "UFO historian" },
  { from: "person:mack", to: "person:john e. mack", rationale: "Harvard abduction researcher" },
  { from: "person:strieber", to: "person:whitley strieber", rationale: "Communion author" },
  { from: "person:keel", to: "person:john keel", rationale: "repeat guard" },
  { from: "person:fuller", to: "person:john g. fuller", rationale: "Interrupted Journey author" },
  { from: "person:hoagland", to: "person:richard c. hoagland", rationale: "Face on Mars researcher" },
  { from: "person:bell", to: "person:art bell", rationale: "Coast to Coast AM host (context-dependent)" },

  // Famous explorers / historical figures
  { from: "person:shackleton", to: "person:ernest shackleton", rationale: "Antarctic explorer" },
  { from: "person:amundsen", to: "person:roald amundsen", rationale: "Antarctic explorer" },
  { from: "person:magellan", to: "person:ferdinand magellan", rationale: "explorer" },
  { from: "person:cortes", to: "person:hernán cortés", rationale: "conquistador" },
  { from: "person:pizarro", to: "person:francisco pizarro", rationale: "conquistador" },
  { from: "person:caesar", to: "person:julius caesar", rationale: "Roman dictator" },
  { from: "person:cleopatra", to: "person:cleopatra vii", rationale: "Egyptian queen" },
  { from: "person:alexander", to: "person:alexander the great", rationale: "historical figure (context may need unmerge)" },
  { from: "person:genghis khan", to: "person:genghis khan", rationale: "canonical" },

  // Orgs — more abbreviations / synonyms
  { from: "organization:the n.a.s.a.", to: "organization:nasa", rationale: "punctuation dedup" },
  { from: "organization:n.a.s.a.", to: "organization:nasa", rationale: "punctuation dedup" },
  { from: "organization:nasa space agency", to: "organization:nasa", rationale: "redundant compound" },
  { from: "organization:central intelligence agency", to: "organization:cia", rationale: "full-form → acronym (cia has more mentions)" },
  { from: "organization:federal bureau of investigation", to: "organization:fbi", rationale: "full-form → acronym" },
  { from: "organization:national security agency", to: "organization:nsa", rationale: "full-form → acronym" },
  { from: "organization:defense advanced research projects agency", to: "organization:darpa", rationale: "full-form → acronym" },
  { from: "organization:the dia", to: "organization:dia", rationale: "determiner dedup" },
  { from: "organization:defense intelligence agency", to: "organization:dia", rationale: "full-form → acronym" },
  { from: "organization:the kgb", to: "organization:kgb", rationale: "determiner dedup" },
  { from: "organization:the mossad", to: "organization:mossad", rationale: "determiner dedup" },
  { from: "organization:the mi6", to: "organization:mi6", rationale: "determiner dedup" },
  { from: "organization:the mi5", to: "organization:mi5", rationale: "determiner dedup" },
  { from: "organization:the gru", to: "organization:gru", rationale: "determiner dedup" },
  { from: "organization:the fsb", to: "organization:fsb", rationale: "determiner dedup" },
  { from: "organization:the un", to: "organization:united nations", rationale: "acronym → fuller form" },
  { from: "organization:un", to: "organization:united nations", rationale: "acronym → fuller form" },
  { from: "organization:u.n.", to: "organization:united nations", rationale: "acronym → fuller form" },
  { from: "organization:the nato", to: "organization:nato", rationale: "determiner dedup" },
  { from: "organization:north atlantic treaty organization", to: "organization:nato", rationale: "full-form → acronym" },
  { from: "organization:the eu", to: "organization:european union", rationale: "determiner dedup" },
  { from: "organization:eu", to: "organization:european union", rationale: "acronym → fuller form" },
  { from: "organization:e.u.", to: "organization:european union", rationale: "acronym" },
  { from: "organization:world health organization", to: "organization:who", rationale: "the WHO in medical contexts" },
  { from: "organization:the who", to: "organization:who", rationale: "determiner dedup" },
  { from: "organization:world economic forum", to: "organization:wef", rationale: "acronym" },
  { from: "organization:the wef", to: "organization:wef", rationale: "determiner dedup" },
  { from: "organization:masons", to: "organization:freemasons", rationale: "synonym" },
  { from: "organization:the freemasons", to: "organization:freemasons", rationale: "determiner dedup" },
  { from: "organization:templars", to: "organization:knights templar", rationale: "synonym" },
  { from: "organization:the knights templar", to: "organization:knights templar", rationale: "determiner dedup" },
  { from: "organization:the illuminati", to: "organization:illuminati", rationale: "determiner dedup" },
  { from: "organization:the vatican", to: "organization:vatican", rationale: "determiner dedup" },

  // Work of media — famous works, determiner + spelling
  { from: "work_of_media:the bible", to: "work_of_media:bible", rationale: "determiner dedup" },
  { from: "work_of_media:the holy bible", to: "work_of_media:bible", rationale: "synonym" },
  { from: "work_of_media:holy bible", to: "work_of_media:bible", rationale: "synonym" },
  { from: "work_of_media:the old testament", to: "work_of_media:old testament", rationale: "determiner dedup" },
  { from: "work_of_media:the new testament", to: "work_of_media:new testament", rationale: "determiner dedup" },
  { from: "work_of_media:the quran", to: "work_of_media:quran", rationale: "determiner dedup" },
  { from: "work_of_media:koran", to: "work_of_media:quran", rationale: "spelling variant" },
  { from: "work_of_media:the koran", to: "work_of_media:quran", rationale: "spelling + determiner" },
  { from: "work_of_media:the book of enoch", to: "work_of_media:book of enoch", rationale: "determiner dedup" },
  { from: "work_of_media:the dead sea scrolls", to: "work_of_media:dead sea scrolls", rationale: "determiner dedup" },
  { from: "work_of_media:the voynich manuscript", to: "work_of_media:voynich manuscript", rationale: "determiner dedup" },
  { from: "work_of_media:the iliad", to: "work_of_media:iliad", rationale: "determiner dedup" },
  { from: "work_of_media:the odyssey", to: "work_of_media:odyssey", rationale: "determiner dedup" },
  { from: "work_of_media:the matrix", to: "work_of_media:matrix", rationale: "determiner dedup (context: movie)" },
  { from: "work_of_media:lord of the rings", to: "work_of_media:the lord of the rings", rationale: "canonical full title" },
  { from: "work_of_media:2001", to: "work_of_media:2001 a space odyssey", rationale: "full title" },

  // Events — synonyms / acronyms / determiner
  { from: "event:ww1", to: "event:world war i", rationale: "acronym" },
  { from: "event:wwi", to: "event:world war i", rationale: "acronym" },
  { from: "event:world war 1", to: "event:world war i", rationale: "roman numeral standard" },
  { from: "event:first world war", to: "event:world war i", rationale: "synonym" },
  { from: "event:the first world war", to: "event:world war i", rationale: "synonym" },
  { from: "event:the great war", to: "event:world war i", rationale: "synonym" },
  { from: "event:great war", to: "event:world war i", rationale: "synonym" },
  { from: "event:ww2", to: "event:world war ii", rationale: "acronym" },
  { from: "event:wwii", to: "event:world war ii", rationale: "acronym" },
  { from: "event:world war 2", to: "event:world war ii", rationale: "roman numeral standard" },
  { from: "event:second world war", to: "event:world war ii", rationale: "synonym" },
  { from: "event:the second world war", to: "event:world war ii", rationale: "synonym" },
  { from: "event:the holocaust", to: "event:holocaust", rationale: "determiner dedup" },
  { from: "event:the cold war", to: "event:cold war", rationale: "determiner dedup" },
  { from: "event:the vietnam war", to: "event:vietnam war", rationale: "determiner dedup" },
  { from: "event:the korean war", to: "event:korean war", rationale: "determiner dedup" },
  { from: "event:the gulf war", to: "event:gulf war", rationale: "determiner dedup" },
  { from: "event:the civil war", to: "event:american civil war", rationale: "disambiguation (US-centric corpus)" },
  { from: "event:civil war", to: "event:american civil war", rationale: "disambiguation" },
  { from: "event:9/11", to: "event:september 11 attacks", rationale: "canonical" },
  { from: "event:nine eleven", to: "event:september 11 attacks", rationale: "synonym" },
  { from: "event:9-11", to: "event:september 11 attacks", rationale: "synonym" },
  { from: "event:roswell", to: "event:roswell incident", rationale: "short-form" },
  { from: "event:the roswell incident", to: "event:roswell incident", rationale: "determiner dedup" },
  { from: "event:moon landing", to: "event:apollo 11 moon landing", rationale: "specific form" },
  { from: "event:the moon landing", to: "event:apollo 11 moon landing", rationale: "specific form" },

  // Technology — acronyms + determiner
  { from: "technology:artificial intelligence", to: "technology:ai", rationale: "ai is more commonly referenced" },
  { from: "technology:a.i.", to: "technology:ai", rationale: "punctuation dedup" },
  { from: "technology:the internet", to: "technology:internet", rationale: "determiner dedup" },
  { from: "technology:gps", to: "technology:gps", rationale: "canonical" },
  { from: "technology:global positioning system", to: "technology:gps", rationale: "acronym" },
  { from: "technology:nuclear weapon", to: "technology:nuclear weapons", rationale: "plural form dominant" },
];

// Re-export in a shape friendly to plain-JS callers.
export interface DeleteAlwaysLists {
  deleteAlways: DeleteAlwaysEntry[];
  alwaysPromote: AlwaysPromoteEntry[];
}

export function getDeleteAlwaysLists(): DeleteAlwaysLists {
  return { deleteAlways: DELETE_ALWAYS, alwaysPromote: ALWAYS_PROMOTE };
}
