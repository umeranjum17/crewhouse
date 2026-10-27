// Your path to the US: from a job like the person's, to a gateway employer, to a US role. Static, cited, and framework-free,
// so the web app and the phone render the same plan. Every claim names a source page with its date and carries words copied
// from that page; `node scripts/check-career-sources.mjs` opens each page and refuses a claim whose words are not on it.
// Nothing here asks for or keeps the person's citizenship, visa status, pay or notice period.
// This file holds the sources' own words verbatim, so test/plain-words.test.ts reads it through its own check instead of the screen scan.

export type How = 'updated' | 'checked' | 'current';
export type Source = { by: string; page: string; url: string; on: string; how: How };
export type Claim = { says: string; src: string; quote: string; shown?: string };
type Item = { title: string; line: string; claims: Claim[]; note?: string };
type Stage = { key: string; name: string; line: string; items: Item[]; note?: string };

const USCIS = 'https://www.uscis.gov/';
const u = (page: string, path: string, on: string, how: How = 'updated'): Source => ({ by: 'USCIS', page, url: USCIS + path, on, how });
const own = (by: string, page: string, url: string): Source => ({ by, page, url, on: '2026-10-27', how: 'checked' });

export const SOURCES: Record<string, Source> = {
  l1a: u('L-1A Intracompany Transferee Executive or Manager', 'working-in-the-united-states/temporary-workers/l-1a-intracompany-transferee-executive-or-manager', '2026-08-31'),
  l1b: u('L-1B Intracompany Transferee Specialized Knowledge', 'working-in-the-united-states/temporary-workers/l-1b-intracompany-transferee-specialized-knowledge', '2026-08-31'),
  h1b: u('H-1B Specialty Occupations', 'working-in-the-united-states/h-1b-specialty-occupations', '2026-09-21'),
  cap: u('H-1B Cap Season', 'working-in-the-united-states/temporary-workers/h-1b-specialty-occupations-and-fashion-models/h-1b-cap-season', '2026-09-21'),
  o1: u('O-1 Visa: Individuals with Extraordinary Ability or Achievement', 'working-in-the-united-states/temporary-workers/o-1-visa-individuals-with-extraordinary-ability-or-achievement', '2023-03-03'),
  pm: u('Policy Manual, Volume 2, Part M, Chapter 4 (O-1A evidence)', 'policy-manual/volume-2-part-m-chapter-4', '2026-10-23', 'current'),
  eb1: u('Employment-Based Immigration: First Preference EB-1', 'working-in-the-united-states/permanent-workers/employment-based-immigration-first-preference-eb-1', '2025-01-24'),
  eb2: u('Employment-Based Immigration: Second Preference EB-2', 'working-in-the-united-states/permanent-workers/employment-based-immigration-second-preference-eb-2', '2025-01-15'),
  opt: u('Optional Practical Training (OPT) for F-1 Students', 'working-in-the-united-states/students-and-exchange-visitors/optional-practical-training-opt-for-f-1-students', '2024-11-25'),
  tn: u('TN USMCA Professionals', 'working-in-the-united-states/temporary-workers/tn-usmca-professionals', '2025-06-04'),
  hub: u('H-1B Employer Data Hub', 'tools/reports-and-studies/h-1b-employer-data-hub', '2026-10-27', 'checked'),
  hubnote: u('Understanding Our H-1B Employer Data Hub', 'tools/reports-and-studies/h-1b-employer-data-hub/understanding-our-h-1b-employer-data-hub', '2025-07-07'),
  hubfiles: u('H-1B Employer Data Hub Files', 'archive/h-1b-employer-data-hub-files', '2025-07-01'),
  // The yearly file has no date of its own: the page that lists it carries 1 July 2025.
  hub23: u('H-1B Employer Data Hub, fiscal year 2023 file', 'sites/default/files/document/data/h1b_datahubexport-2023.csv', '2025-07-01'),
  afiniti: own('Afiniti', 'Careers', 'https://www.afiniti.com/careers'),
  motive: own('Motive', 'Careers', 'https://gomotive.com/company/careers/'),
  arbisoft: own('Arbisoft', 'Home page', 'https://arbisoft.com/'),
};

const c = (says: string, src: string, quote: string, shown?: string): Claim => ({ says, src, quote, ...(shown ? { shown } : {}) });

export const PLAN: Stage[] = [
  { key: 'routes', name: 'Know the routes', line: 'Six ways into the US. Which one fits depends on facts only you know.', items: [
    { title: 'Move inside one company (L-1)', line: 'Your employer moves you from its office here to its office in the US.', claims: [
      c('An L-1 lets a US employer move a professional with specialized knowledge from one of its offices abroad to a US office.', 'l1b', 'enables a U.S. employer to transfer a professional employee with specialized knowledge relating to the organization’s interests from one of its affiliated foreign offices to one of its offices in the United States'),
      c('You generally need one continuous year working for that company group abroad, within the three years before you enter the US.', 'l1b', 'Generally have been working for a qualifying organization abroad for one continuous year within the three years immediately preceding his or her admission to the United States'),
      c('An L-1B stay can reach five years in total.', 'l1b', 'until the employee has reached the maximum limit of five years'),
      c('For managers and executives, an L-1A stay can reach seven years.', 'l1a', 'until the employee has reached the maximum limit of seven years'),
    ] },
    { title: 'Win a place for an H-1B', line: 'A US employer files for you. Places are limited and chosen by lottery.', claims: [
      c('The regular cap is 65,000 H-1B places a year.', 'cap', 'Congress set the current annual regular cap for the H-1B category at 65,000'),
      c('Another 20,000 are allowed for people with a master’s degree or higher from a US university.', 'cap', 'An additional 20,000 petitions filed on behalf of beneficiaries who have earned a master’s degree or higher from a U.S. institution of higher education are exempt from the cap.'),
      c('An employer under the cap must register you first.', 'cap', 'Prospective petitioners who are subject to the annual cap must first go through the electronic registration process'),
      c('Since 21 September 2025, a presidential order adds a $100,000 payment to certain new H-1B petitions.', 'h1b', 'certain H-1B petitions filed at or after 12:01 a.m. Eastern on Sept. 21, 2025, must be accompanied by an additional $100,000 payment as a condition of eligibility'),
      c('On 8 June 2026 a federal court set aside the guidance for that payment.', 'h1b', 'On June 8, 2026, the U.S. District Court for the District of Massachusetts issued an order that vacated agency guidance implementing the $100,000 payment requirement for certain H-1B petitions.'),
      c('USCIS says it will follow the court’s order while it decides its next steps.', 'h1b', 'will comply with the court’s order while DHS considers next steps'),
    ], note: 'This is changing fast. Read the USCIS page again before you plan around the payment.' },
    { title: 'Show extraordinary ability (O-1)', line: 'For people at the very top of a field. You collect the evidence.', claims: [
      c('The O-1 is for people who are one of the small percentage at the very top of their field.', 'o1', 'one of the small percentage who have arisen to the very top of the field'),
      c('USCIS looks for a qualifying award, or at least three of its listed kinds of evidence.', 'pm', 'either a qualifying award (or nomination, if applicable), or at least three of the applicable alternate criteria'),
    ] },
    { title: 'A green card without an employer', line: 'Two routes let you file for yourself.', claims: [
      c('EB-1 for extraordinary ability needs no job offer and no labor certification.', 'eb1', 'continuing to work in the area of your expertise. No offer of employment or labor certification is required.'),
      c('With a national interest waiver (EB-2), you can file for yourself. No employer has to sponsor you.', 'eb2', 'Those seeking a national interest waiver may self-petition (you do not need an employer to sponsor you)'),
    ] },
    { title: 'Study in the US first (F-1 and OPT)', line: 'A US degree opens a period of work in your field.', claims: [
      c('Optional practical training (OPT) lets an F-1 student work in a job linked to their studies, for up to 12 months.', 'opt', 'Eligible students can apply to receive up to 12 months of OPT employment authorization'),
      c('A degree in science, technology, engineering or maths can add a 24-month extension.', 'opt', 'you may apply for a 24-month extension of your post-completion OPT employment authorization'),
    ] },
    { title: 'Routes tied to a passport', line: 'Some routes exist only for citizens of certain countries.', claims: [
      c('TN status is for citizens of Canada and Mexico.', 'tn', 'permits qualified Canadian and Mexican citizens to seek temporary entry into the United States'),
    ], note: 'This plan does not ask which passport you hold. Check each route against what you know about yourself.' },
  ] },
  { key: 'gateway', name: 'Pick a gateway employer', line: 'An employer with an office on both sides is where an inside transfer starts.', items: [
    { title: 'What makes an employer a gateway', line: 'One company group on both sides of the move.', claims: [
      c('The US employer and the company abroad must be linked as parent, branch, subsidiary or affiliate.', 'l1b', 'Have a qualifying relationship with a foreign company (parent company, branch, subsidiary, or affiliate'),
      c('The group must do business in the US and in at least one other country.', 'l1b', 'Currently be, or will be, doing business as an employer in the United States and in at least one other country directly or through a qualifying organization'),
      c('For an H-1B, the employer or its agent must first get a Labor Condition Application certified by the Department of Labor.', 'h1b', 'The employer or agent must apply for and receive DOL certification of an LCA.'),
    ], note: 'Ask any employer: which company in your group would hire me, and where is its US office?' },
    { title: 'Afiniti', line: 'Washington, D.C. and Lahore on its careers page.', claims: [
      c('It lists an office in Washington, D.C.', 'afiniti', 'Washington, D.C. 1701 Pennsylvania Ave. NW, 6th Floor, Washington, D.C. 20006'),
      c('It lists an office in Lahore.', 'afiniti', 'Lahore, Pakistan Office No. 4002, Delta 4, National Aerospace Science & Technology Park, Lahore Cantt'),
      c('It describes its product as AI decisioning tools for contact centers.', 'afiniti', 'AI decisioning tools that turn every contact center interaction into a measurable business outcome.'),
    ] },
    { title: 'Motive', line: 'San Francisco, Nashville, Buffalo, Austin and Lahore on its careers page.', claims: [
      c('It lists US offices in San Francisco, Nashville, Buffalo and Austin.', 'motive', 'San Francisco United States 1355 Market Street 11th Floor San Francisco, CA 94103 Nashville United States'),
      c('It lists an office in Lahore.', 'motive', 'Lahore Pakistan Tricon Corporate Center 13th Floor, Gulberg-II Lahore, 54660'),
    ] },
    { title: 'Arbisoft', line: 'Plano, Texas and Lahore on its home page.', claims: [
      c('It lists a US office in Plano, Texas.', 'arbisoft', '1700 Alma Dr Suite 102, Plano TX 75075'),
      c('It lists an office in Lahore.', 'arbisoft', '25 Canal Rd, Westwood Colony Lahore, Punjab 54000'),
    ] },
  ], note: 'These are examples, not a ranking. A company page that lists two offices does not say who the company moves or sponsors.' },
  { key: 'sponsors', name: 'Check who really sponsors', line: 'A post that says “we sponsor” is a promise. The public record shows what employers filed.', items: [
    { title: 'Look an employer up (USCIS Data Hub)', line: 'Public, free and searchable by name.', claims: [
      c('The Data Hub covers H-1B petitions from fiscal year 2009 to fiscal year 2026 (third quarter).', 'hub', 'includes data from fiscal year 2009 through fiscal year 2026 (quarter 3)'),
      c('You can search by year, employer name, city, state, zip code or industry code.', 'hub', 'Data can be queried by fiscal year, employer name, city, state, zip code, and NAICS code.'),
      c('Employers appear by the last four digits of their tax ID, so check the city and the spelling.', 'hub', 'It identifies employers by the last four digits of their tax identification.'),
      c('It shows USCIS’s first decision on each petition.', 'hubnote', 'The approval and denial data in the data hub reflects USCIS’ first decision.'),
      c('USCIS warns that errors in the forms can leave a missing or wrong employer name.', 'hubnote', 'Data entry and petitioner errors may result in a missing and/or erroneous employer name'),
    ] },
    { title: 'What it shows for two of the examples', line: 'Fiscal year 2023, the newest yearly file USCIS posts to download.', claims: [
      c('USCIS’s yearly download files stop at fiscal year 2023. The live hub has later years.', 'hubfiles', 'FY 2023 H-1B Employer Data FY 2022 H-1B Employer Data'),
      c('Afiniti Inc, Washington, D.C.: 2 new approvals, 2 continuing approvals and 1 continuing denial.', 'hub23', '"AFINITI INC",2,0,2,1,51,2266,DC,WASHINGTON,20006', 'AFINITI INC, Washington: new approvals 2, new denials 0, continuing approvals 2, continuing denials 1.'),
      c('Motive Technologies Inc, San Francisco: 1 new approval and 8 continuing approvals, no denials.', 'hub23', '"MOTIVE TECHNOLOGIES INC",1,0,8,0,51,0361,CA,"SAN FRANCISCO",94105', 'MOTIVE TECHNOLOGIES INC, San Francisco: new approvals 1, new denials 0, continuing approvals 8, continuing denials 0.'),
    ], note: 'This is one year of history. It does not say what any employer will do for you.' },
  ] },
  { key: 'build', name: 'Build what each route rewards', line: 'Pick the proof that fits your route. You can build it while you work.', items: [
    { title: 'For an inside transfer: a year at the right company', line: 'The clock starts when you join the group.', claims: [
      c('The year of work abroad must fall within the three years before you enter the US.', 'l1b', 'for one continuous year within the three years immediately preceding his or her admission'),
      c('“Specialized knowledge” can mean advanced expertise in the company’s own processes and procedures.', 'l1b', 'an advanced level of knowledge or expertise in the organization’s processes and procedures'),
    ] },
    { title: 'For an H-1B: a higher wage level and a degree or its equal', line: 'Pay level and education both count.', claims: [
      c('From fiscal year 2027, the lottery favors higher skilled and higher paid people.', 'cap', 'Starting in fiscal year (FY) 2027, USCIS has implemented a weighted selection process which favors the allocation of H-1B visas to higher skilled and higher paid aliens'),
      c('A wage level IV entry goes into the lottery 4 times.', 'cap', 'assigned wage level IV are entered into the selection pool 4 times'),
      c('A wage level I entry goes in once.', 'cap', 'those assigned wage level I are entered into the selection pool 1 time'),
      c('A foreign degree that equals a US bachelor’s degree can meet the degree test.', 'h1b', 'Hold a foreign degree that is the equivalent to a U.S. bachelor’s or higher degree required by the specialty occupation'),
      c('Years of progressively responsible work can stand in for a degree, if they equal one.', 'h1b', 'progressively responsible experience that is equivalent to the completion of a U.S. bachelor’s or higher degree in the specialty occupation'),
    ] },
    { title: 'For an O-1 or EB-1: evidence anyone can check', line: 'USCIS names the kinds of proof it weighs.', claims: [
      c('Published articles or coverage about you and your work, in professional or major media.', 'pm', 'Published material in professional or major trade publications or major media about the beneficiary'),
      c('Being asked to judge others’ work, for example reviewing papers for a conference.', 'pm', 'Reviewer of abstracts or papers submitted for presentation at scholarly conferences in the respective field'),
      c('Articles you wrote. You need not be the only author or the first.', 'pm', 'need not be the sole or first author'),
      c('Original work of major significance to the field, shown by published material or letters about it.', 'pm', 'Published materials about the significance of the beneficiary’s original work'),
      c('A leading or critical role at an organization.', 'pm', 'leading or critical role for an organization, establishment, or a division or department of an organization or establishment'),
      c('A high salary, shown by pay records or an offer letter.', 'pm', 'Contract, job offer letter, or other evidence of prospective salary or remuneration for services'),
    ] },
  ] },
];

/** What the person reads above the plan, before any stage. */
export const PATH_NOTE = [
  'This is information, not legal advice.',
  'Every line shows its source and the date of that page. Rules change, so read the page before you act.',
  'This plan never asks for your citizenship, visa status, pay or notice period, and it keeps none of them.',
  'Which route fits you is for you and an immigration lawyer to decide.',
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "updated 31 Aug 2026": the date a source carries and what kind of date it is. */
export const dated = (s: Source) => { const [y, m, d] = s.on.split('-').map(Number); return `${s.how === 'current' ? 'current as of' : s.how} ${d} ${MONTHS[m - 1]} ${y}`; };

/** `quote` is the page's own words; for a table row (`row`) it is a plain reading of that row. */
export type PathClaim = { says: string; quote: string; row: boolean; by: string; page: string; url: string; when: string };
export type PathItem = { title: string; line: string; note?: string; claims: PathClaim[] };
export type PathStage = { key: string; name: string; line: string; note?: string; items: PathItem[] };
/** The plan as the screens draw it: every claim beside its source page and date. */
export const path = (): PathStage[] => PLAN.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, claims: i.claims.map((x) => {
  const src = SOURCES[x.src];
  return { says: x.says, quote: x.shown ?? x.quote, row: !!x.shown, by: src.by, page: src.page, url: src.url, when: dated(src) };
}) })) }));
