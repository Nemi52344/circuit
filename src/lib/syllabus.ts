/* The marketing course: four levels for somebody who is new to marketing, from the words
   everybody uses on day one to running a budget.

   Each lesson is short on purpose — three to five minutes of reading, the idea in a sentence,
   the few points that matter, what it looks like at BNC, one thing to try, and three questions
   to check it went in. A lesson counts as done when two of its three are right; a level counts
   as passed at the usual test mark. The questions go into the same bank as every other test
   (as "marketing"), so the answer key stays on the server.

   No imports, so a test can read it. */

export type LevelKey = "basic" | "normal" | "hard" | "advanced";
export type Check = [question: string, options: string[], answer: number, why: string];
export type Lesson = {
  id: string; title: string; minutes: number;
  short: string;
  points: { h: string; t: string }[];
  example: string;
  tryThis: string;
  terms: [term: string, meaning: string][];
  checks: Check[];
};
export type Level = { key: LevelKey; label: string; tag: string; what: string; outcomes: string[]; lessons: Lesson[] };

export const LESSON_PASS = 2;
export const questionId = (lessonId: string, i: number) => `syl-${lessonId}-${i + 1}`;

export const LEVELS: Level[] = [
  {
    key: "basic", label: "Basics", tag: "Start here",
    what: "What marketing is, who it is for, and the words everybody uses.",
    outcomes: ["Explain what marketing does and how it differs from sales", "Describe our customers in a sentence each", "Read a post's numbers without guessing"],
    lessons: [
      {
        id: "b1", title: "What marketing actually is", minutes: 3,
        short: "Marketing is getting the right people to know, want and choose what you sell — and come back.",
        points: [
          { h: "It starts with a need", t: "People do not buy a motorcycle; they buy a cheaper, reliable way to do a day's deliveries. Marketing begins by understanding that need." },
          { h: "Marketing, sales, branding", t: "Marketing creates interest and trust at scale. Sales turns a specific interested person into a buyer. Branding is the memory people carry of you between the two." },
          { h: "The four Ps", t: "Product (what it is), Price (what it costs), Place (where it is bought), Promotion (how people hear of it). Posts and ads are only the last P." },
          { h: "Value, in their words", t: "Say what the buyer gets — 'saves ₹3,000 a month on fuel' — not what the engineer built — '2.5 kWh pack'. Features prove; benefits persuade." },
        ],
        example: "A fleet owner in Coimbatore does not care that the Challenger has a double-cradle frame. He cares that it survives potholes with 150 kg on the back, every day, and costs less to run than petrol. The frame is the proof; the uptime is the message.",
        tryThis: "Write one sentence: '[Who] uses our product to [do what], because [benefit].' Do it for a delivery rider and for a fleet manager.",
        terms: [["Benefit", "What the customer gains"], ["Feature", "What the product has"], ["Value proposition", "Why someone should pick you over the alternative"]],
        checks: [
          ["Which of these is a benefit rather than a feature?", ["2.5 kWh battery pack", "Double-cradle steel frame", "Costs less per kilometre than petrol", "Hub motor"], 2, "A benefit is what the buyer gains; the others are things the product has."],
          ["Which of the four Ps covers where the product is bought?", ["Product", "Price", "Place", "Promotion"], 2, "Place is distribution — dealers, online, direct to fleets."],
          ["What is the main difference between marketing and sales?", ["Marketing is only advertising", "Marketing builds interest at scale; sales converts a particular buyer", "Sales is online, marketing is offline", "There is no difference"], 1, "Marketing reaches many and builds trust; sales works one interested buyer to a decision."],
        ],
      },
      {
        id: "b2", title: "Knowing your customer", minutes: 4,
        short: "You cannot speak to everyone. Pick who you are talking to and learn what they worry about.",
        points: [
          { h: "Segments", t: "Split the market into groups that buy for different reasons: fleet operators, individual riders, dealers, corporate buyers." },
          { h: "B2B and B2C", t: "Selling to a business (B2B) means several people decide, slowly, on cost and risk. Selling to a person (B2C) is faster and more emotional." },
          { h: "Personas", t: "A persona is one believable person standing for a segment: their job, a day in their life, what they fear, what would make them switch." },
          { h: "Ask, do not guess", t: "Ten real conversations with riders or fleet managers beat a hundred assumptions. Write down their exact words — they become your copy." },
        ],
        example: "Persona: Ravi, 34, runs 40 delivery bikes for a quick-commerce partner. Fears: bikes off the road, riders quitting, fuel bills. Would switch if: running cost drops and service is guaranteed within a day.",
        tryThis: "Write a five-line persona for a delivery rider who rents a bike. What is the one thing that would make them ask their fleet owner for an electric one?",
        terms: [["Segment", "A group of customers who buy for similar reasons"], ["Persona", "A made-up but realistic person representing a segment"], ["B2B / B2C", "Business-to-business / business-to-consumer"]],
        checks: [
          ["A fleet operator buying 40 bikes is an example of…", ["B2C buying", "B2B buying", "Impulse buying", "Retail buying"], 1, "A business buying for its operations is B2B, usually with several decision-makers."],
          ["What is a persona?", ["A celebrity endorser", "A realistic profile standing for one customer segment", "The brand's logo and colours", "A competitor's customer"], 1, "A persona makes a segment concrete enough to write for."],
          ["The best source for how customers describe their problem is…", ["Your own guess", "A competitor's website", "Their own words in real conversations", "A stock-photo caption"], 2, "Customers' own words are the most persuasive copy you will find."],
        ],
      },
      {
        id: "b3", title: "Brand and positioning", minutes: 4,
        short: "Positioning is the one place in the customer's mind you want to own. Brand is everything that keeps reminding them of it.",
        points: [
          { h: "Pick one place", t: "'The toughest electric bike for working riders' is a position. 'Good quality, good price, good service' is not — everyone says it." },
          { h: "The statement", t: "For [who], [brand] is the [category] that [main benefit], because [proof]." },
          { h: "Consistency wins", t: "Same colours, same fonts, same tone, every time. Recognition is built by repetition, not by novelty." },
          { h: "Voice", t: "How the brand speaks. BNC is precise and calm: numbers, not hype; no exclamation marks; claims we can prove." },
        ],
        example: "For delivery fleets in India, BNC Challenger is the electric motorcycle built to carry a working day's load, because its frame, battery and service are designed in-house for Indian roads.",
        tryThis: "Find three posts by any brand you know. Cover the logo. Could you still tell whose they are? What gives it away?",
        terms: [["Positioning", "The specific idea you want to own in a buyer's mind"], ["Brand voice", "The consistent personality in how a brand writes and speaks"], ["Distinctive assets", "Colours, shapes, sounds people link to you without the name"]],
        checks: [
          ["Which is the strongest positioning?", ["Quality products at good prices", "The toughest electric bike for working riders", "We are the best", "Innovation for everyone"], 1, "It is specific about who and what — the others could belong to anyone."],
          ["Why does consistency in colours and fonts matter?", ["It saves design time only", "Repetition builds recognition", "Instagram requires it", "It improves battery life"], 1, "People remember brands through repeated, consistent cues."],
          ["BNC's brand voice is best described as…", ["Loud and hype-driven", "Precise, calm and evidence-led", "Jokey and meme-heavy", "Formal legal language"], 1, "Numbers and provable claims, without hype."],
        ],
      },
      {
        id: "b4", title: "The funnel", minutes: 4,
        short: "People move from never having heard of you to buying, and then to coming back. Each step needs different content.",
        points: [
          { h: "Awareness", t: "They learn you exist. Reels, ads, events. Measure reach." },
          { h: "Consideration", t: "They compare. Spec sheets, comparisons, testimonials, test rides. Measure saves, site visits, enquiries." },
          { h: "Conversion", t: "They act — a test ride, a quote, a purchase. Clear offer, easy form, fast reply. Measure leads and sales." },
          { h: "Retention and advocacy", t: "Happy customers buy more and tell others. Service updates, rider stories, referral offers." },
        ],
        example: "A reel of a Challenger in the rain (awareness) → a carousel comparing running cost with petrol (consideration) → a 'book a test ride' WhatsApp link (conversion) → a fleet owner's video six months later (advocacy).",
        tryThis: "Take last week's five posts. Mark each as awareness, consideration or conversion. Is one stage missing?",
        terms: [["TOFU / MOFU / BOFU", "Top, middle and bottom of funnel"], ["Conversion", "The action you want someone to take"], ["Retention", "Keeping customers you already have"]],
        checks: [
          ["A cost-comparison carousel mostly serves which stage?", ["Awareness", "Consideration", "Retention", "None"], 1, "Comparing options is what people do in consideration."],
          ["Which number best measures awareness?", ["Reach", "Sales", "Refunds", "Repeat purchases"], 0, "Awareness is about how many people saw you."],
          ["What should a conversion-stage post include?", ["No call to action", "A clear, easy next step", "Only the logo", "A long history of the company"], 1, "At conversion, remove friction: one clear action."],
        ],
      },
      {
        id: "b5", title: "The channels", minutes: 3,
        short: "Owned, earned and paid: where people meet the brand, and who controls each.",
        points: [
          { h: "Owned", t: "What you control: website, Instagram and LinkedIn pages, WhatsApp, email list, brochures." },
          { h: "Earned", t: "What others say: press, reviews, shares, word of mouth. Most trusted, least controllable." },
          { h: "Paid", t: "What you buy: ads on Meta, Google, LinkedIn; sponsored events. Fast and measurable, stops when the money stops." },
          { h: "Fit the channel to the buyer", t: "Riders live on Instagram and WhatsApp. Fleet managers and investors read LinkedIn. Dealers respond to calls and events." },
        ],
        example: "Launch week: owned (posts, website banner), paid (Meta ads to riders in three cities), earned (a trade publication covers the launch, a fleet partner posts about it).",
        tryThis: "List every place someone could meet BNC this month. Mark each owned, earned or paid.",
        terms: [["Owned media", "Channels you control"], ["Earned media", "Attention you did not pay for"], ["Paid media", "Attention you bought"]],
        checks: [
          ["A newspaper article about BNC that we did not pay for is…", ["Owned", "Earned", "Paid", "Sponsored"], 1, "Coverage you did not pay for or control is earned."],
          ["Which channel suits fleet managers and investors best?", ["LinkedIn", "Snapchat", "Pinterest", "A billboard in another state"], 0, "Business decision-makers read LinkedIn."],
          ["The main weakness of paid media is…", ["It cannot be measured", "It stops when spending stops", "It is never seen", "It is always free"], 1, "Paid reach lasts only as long as the budget."],
        ],
      },
      {
        id: "b6", title: "The words everybody uses", minutes: 5,
        short: "Reach, impressions, engagement, CTR, CPM, CPC, CPL, conversion rate — what each one means and when it matters.",
        points: [
          { h: "Reach vs impressions", t: "Reach is how many different people saw it. Impressions is how many times it was seen. One person seeing it three times = 1 reach, 3 impressions." },
          { h: "Engagement rate", t: "Interactions (likes, comments, saves, shares) ÷ reach × 100. 300 interactions on 10,000 reach = 3%." },
          { h: "Click-through rate (CTR)", t: "Clicks ÷ impressions × 100. Tells you whether the ad made people curious enough to act." },
          { h: "Cost metrics", t: "CPM = cost per 1,000 impressions. CPC = cost per click. CPL = cost per lead. Lower is better only if the quality holds." },
          { h: "Conversion rate", t: "People who did the action ÷ people who could have × 100. 20 test rides from 400 page visits = 5%." },
        ],
        example: "An ad spent ₹5,000, got 250,000 impressions, 2,500 clicks and 50 test-ride leads. CPM = ₹20, CTR = 1%, CPC = ₹2, CPL = ₹100.",
        tryThis: "Open last month's best post in Instagram insights. Work out its engagement rate yourself.",
        terms: [["CPM", "Cost per thousand impressions"], ["CTR", "Click-through rate"], ["CPL", "Cost per lead"]],
        checks: [
          ["One person sees a post three times. Reach and impressions are…", ["3 and 1", "1 and 3", "3 and 3", "1 and 1"], 1, "Reach counts people once; impressions count every view."],
          ["400 interactions on 10,000 reach is an engagement rate of…", ["0.4%", "4%", "40%", "2.5%"], 1, "400 ÷ 10,000 × 100 = 4%."],
          ["₹2,000 spent for 40 leads gives a CPL of…", ["₹20", "₹50", "₹80", "₹500"], 1, "2,000 ÷ 40 = ₹50 per lead."],
        ],
      },
    ],
  },
  {
    key: "normal", label: "Normal", tag: "Doing the job",
    what: "The everyday work: planning posts, writing, designing, reading the numbers.",
    outcomes: ["Plan a month of posts with a reason for each", "Write copy that leads with a benefit and one action", "Read a weekly report and say what to change"],
    lessons: [
      {
        id: "n1", title: "Planning a content calendar", minutes: 4,
        short: "A calendar is a promise: what goes out, when, on which platform, and why.",
        points: [
          { h: "Pillars", t: "Three to five recurring themes — e.g. product proof, rider stories, behind the build, EV facts. Every post belongs to one." },
          { h: "Cadence you can keep", t: "Three good posts a week, every week, beats seven for a fortnight and then silence. The algorithm and the audience both reward regularity." },
          { h: "Mix formats", t: "Reels for reach, carousels for saves and explaining, single images for announcements, stories for daily touch." },
          { h: "Plan a month, adjust weekly", t: "Fix the month's themes and key dates (launches, festivals, events); leave room for what happens." },
        ],
        example: "October: Mon — EV fact carousel; Wed — rider story reel; Fri — product proof post; plus Diwali greeting and the fleet-partner announcement on fixed dates.",
        tryThis: "Open the Calendar in Circuit. Count next month's posts per pillar. Is one pillar doing all the work?",
        terms: [["Content pillar", "A recurring theme posts are built around"], ["Cadence", "How often you post"], ["Evergreen", "Content that stays useful for months"]],
        checks: [
          ["Why use content pillars?", ["To post more often", "So every post has a clear purpose and the mix stays balanced", "Instagram requires them", "To avoid writing captions"], 1, "Pillars keep the feed purposeful and varied."],
          ["Which is better?", ["7 posts a week for two weeks, then nothing", "3 posts a week, every week", "1 post a month", "Posting only when inspired"], 1, "Consistency compounds; bursts and silence do not."],
          ["Which format usually earns the most saves for explaining something?", ["Carousel", "Story", "Profile photo", "Highlight cover"], 0, "Carousels hold several steps or facts people want to keep."],
        ],
      },
      {
        id: "n2", title: "Writing copy that works", minutes: 5,
        short: "Hook in the first line, one benefit, proof, one clear action.",
        points: [
          { h: "The hook", t: "Only the first line shows before 'more'. Make it a question, a number or a surprise: '₹3,100 saved last month. Same routes.'" },
          { h: "One message per post", t: "If a post says five things, it says nothing. Pick the one thing and cut the rest." },
          { h: "Proof", t: "A number, a test, a customer's words. 'ARAI-certified 110 km range' beats 'great range'." },
          { h: "One call to action", t: "'Book a test ride — link in bio' or 'Save this for later'. Not both, not five." },
          { h: "AIDA", t: "Attention, Interest, Desire, Action — a simple order for any piece of copy." },
        ],
        example: "Weak: 'Introducing our amazing new EV with great features!' Strong: '150 kg on the carrier. Monsoon roads. Eight hours a day. Challenger was built for exactly that. Book a test ride → link in bio.'",
        tryThis: "Rewrite the caption of one of our older posts so the first line alone would make you stop scrolling.",
        terms: [["Hook", "The first line that earns attention"], ["CTA", "Call to action — the one thing you ask the reader to do"], ["AIDA", "Attention, Interest, Desire, Action"]],
        checks: [
          ["Which first line is the strongest hook?", ["Introducing our new product", "₹3,100 saved last month. Same routes.", "We are happy to announce", "Check this out"], 1, "A specific number and a surprise earn attention."],
          ["How many calls to action should one post usually have?", ["None", "One", "Three", "As many as fit"], 1, "One clear action converts better than several competing ones."],
          ["Which is proof?", ["Great range", "ARAI-certified range figure", "Best in class", "Amazing performance"], 1, "A certified figure can be checked; adjectives cannot."],
        ],
      },
      {
        id: "n3", title: "Each platform and what it is for", minutes: 4,
        short: "Instagram, LinkedIn, Facebook, YouTube and WhatsApp reward different things. Do not post the same thing everywhere unchanged.",
        points: [
          { h: "Instagram", t: "Visual and fast. Reels reach new people; carousels get saved; stories keep followers close. Riders and young buyers." },
          { h: "LinkedIn", t: "Business decisions. Text-led posts, data, company milestones, people's stories. Fleet operators, partners, investors, hiring." },
          { h: "Facebook", t: "Older and broader audience, groups, and the home of Meta ads. Useful for local reach and paid campaigns." },
          { h: "YouTube", t: "Search engine for video: reviews, how-tos, long explainers that keep working for years." },
          { h: "WhatsApp", t: "Direct, personal, high reply rates. For people who have opted in — enquiries, follow-ups, service." },
        ],
        example: "The same fleet-partner news: Instagram — a reel of the bikes rolling out; LinkedIn — a post on why the partner chose electric, with the cost numbers; WhatsApp — a message to dealers with the details.",
        tryThis: "Take one upcoming post and write the LinkedIn version and the Instagram version. How different are they?",
        terms: [["Reel", "Short vertical video on Instagram/Facebook"], ["Carousel", "A post of several swipeable images"], ["Opt-in", "Permission someone gives to be messaged"]],
        checks: [
          ["Where would a post about fleet running-cost data do best?", ["LinkedIn", "Instagram stories only", "A highlight cover", "Pinterest"], 0, "Business buyers read data-led posts on LinkedIn."],
          ["Which Instagram format is best for reaching new people?", ["Reels", "Highlights", "Bio link", "Close friends story"], 0, "Reels are shown widely to non-followers."],
          ["WhatsApp marketing messages should go to…", ["Every number you can find", "People who have opted in", "Competitors' customers", "Random groups"], 1, "Messaging without consent breaks trust, platform rules and data-protection law."],
        ],
      },
      {
        id: "n4", title: "Design basics for posts", minutes: 4,
        short: "One message, clear hierarchy, brand colours, right size. Good design is mostly removing things.",
        points: [
          { h: "Hierarchy", t: "The eye should land on one thing first (the number or headline), then the supporting line, then the logo." },
          { h: "Contrast and space", t: "Light text on dark or dark on light — never mid on mid. Empty space makes the message easier to read on a phone." },
          { h: "Sizes", t: "Feed portrait 1080×1350 (4:5) takes the most room in the feed. Reels and stories 1080×1920 (9:16) — keep text away from the top and bottom edges." },
          { h: "Brand rules", t: "Use the brand's colours and fonts every time. Our own photography, never another brand's picture as ours." },
        ],
        example: "The Studio's 'Big number' template: one figure huge, the product beneath, three small facts at the bottom — hierarchy built in.",
        tryThis: "Look at a post at phone size from arm's length. Can you read the main line in two seconds? If not, cut words.",
        terms: [["Hierarchy", "The order in which the eye reads a design"], ["Safe zone", "The area of a reel/story not covered by app buttons"], ["Aspect ratio", "Width to height, e.g. 4:5 or 9:16"]],
        checks: [
          ["Which size suits an Instagram feed post best?", ["1080×1350", "1920×1080", "500×500", "3000×1000"], 0, "4:5 portrait fills the most space in the feed."],
          ["What should the eye land on first in a post?", ["The logo", "The single main message", "The fine print", "The hashtags"], 1, "Hierarchy puts the main message first."],
          ["Can we post a picture from another brand's page as our own?", ["Yes, if it looks good", "No — only our own photography or licensed images", "Yes, if we crop it", "Yes, on weekends"], 1, "Using others' images as ours is a rights and trust problem."],
        ],
      },
      {
        id: "n5", title: "Reading your numbers", minutes: 4,
        short: "Numbers tell you what to do more of and what to stop. Compare like with like, and look for patterns, not single posts.",
        points: [
          { h: "Look weekly, decide monthly", t: "One post can be luck. Five posts of the same kind doing better is a pattern." },
          { h: "Compare like with like", t: "A reel against reels, a carousel against carousels, this month against last." },
          { h: "Saves and shares", t: "They mean the post was useful or worth passing on — usually a stronger signal than likes." },
          { h: "Reach high, engagement low", t: "People saw it but it gave them no reason to act. Fix the hook or the offer, not the posting time." },
        ],
        example: "Our carousels average twice the saves of single images, but reels reach three times as many people. So: reels to be found, carousels to be kept.",
        tryThis: "Open Reports in Circuit → Social media. Which format has the best average reach? Which month was the quietest, and why?",
        terms: [["Saves", "People keeping a post to see again"], ["Benchmark", "A normal level to compare against"], ["Pattern", "A result that repeats across several posts"]],
        checks: [
          ["A single post did very well. The right move is…", ["Change the whole strategy", "Look for whether similar posts also did well", "Post it again every day", "Ignore all numbers"], 1, "One result can be luck; look for a pattern."],
          ["A post had high reach but almost no saves or comments. Likely reading?", ["It worked perfectly", "It was seen but gave people no reason to act", "Instagram is broken", "The colours were wrong"], 1, "Reach says it was shown; interactions say it mattered."],
          ["Which comparison is fair?", ["A reel against a story", "This month's reels against last month's reels", "Our post against a celebrity's", "A paid ad against an unpaid post"], 1, "Compare the same kind of thing over time."],
        ],
      },
      {
        id: "n6", title: "Briefs and sign-off", minutes: 3,
        short: "A brief says what is needed and why before anybody starts. Sign-off checks it is true and on-brand before it goes out.",
        points: [
          { h: "What a brief holds", t: "Objective, audience, single message, proof, format and size, deadline, who signs off." },
          { h: "Why sign-off", t: "A post is public and permanent. One wrong number or claim costs more trust than ten good posts earn." },
          { h: "Check before you send", t: "Spelling, numbers against the source, brand colours, logo, link works, right platform size." },
          { h: "In Circuit", t: "Posters wait on Content status for the manager's sign-off; an edit after approval needs a fresh look." },
        ],
        example: "Brief: Objective — test-ride bookings in Chennai. Audience — delivery riders. Message — runs all day on one charge. Proof — certified range. Format — reel 9:16. Due — Thursday. Sign-off — Marketing Manager.",
        tryThis: "Write a six-line brief for next week's most important post before anyone designs it.",
        terms: [["Brief", "A short document saying what is needed and why"], ["Sign-off", "Approval before publishing"], ["Claim", "Any statement of fact about the product"]],
        checks: [
          ["What belongs in a brief?", ["Only the deadline", "Objective, audience, message, proof, format, deadline", "The designer's salary", "Nothing — just start designing"], 1, "A brief prevents work being redone."],
          ["Why do posts need sign-off?", ["To slow things down", "Because public mistakes cost trust", "Instagram requires it", "To change the colours"], 1, "A wrong claim in public is expensive."],
          ["A poster was approved, then its headline was edited. What now?", ["Post it — it was approved", "It needs to be signed off again", "Delete it", "Change the colours back"], 1, "Approval covers what was approved; a change needs a fresh look."],
        ],
      },
    ],
  },
  {
    key: "hard", label: "Hard", tag: "Growing results",
    what: "Leads, ads, search, email and WhatsApp, tracking, testing — turning attention into business.",
    outcomes: ["Set up a lead path from post to sales call", "Read a Meta ads report and know what to change", "Tag links so every lead can be traced to its source"],
    lessons: [
      {
        id: "h1", title: "Lead generation for B2B", minutes: 5,
        short: "A fleet sale starts with a lead: someone who has told you who they are and that they might be interested.",
        points: [
          { h: "Offer something worth the details", t: "A running-cost calculator, a fleet trial, a spec sheet, a case study. People trade contact details for something useful." },
          { h: "Landing page", t: "One page, one offer, one form. Headline matches the ad; short form (name, phone, city, fleet size)." },
          { h: "MQL and SQL", t: "A marketing-qualified lead fits the profile (a fleet in our cities). A sales-qualified lead has a real need and timing, ready for a call." },
          { h: "Speed to reply", t: "Leads go cold in hours. Reply the same day — ideally within an hour — on the channel they used." },
        ],
        example: "LinkedIn post on fleet running costs → 'Get the cost sheet for your fleet' → form asks fleet size and city → fleets over 20 bikes in our cities get a sales call the same day.",
        tryThis: "Map our current path from a post to a sales conversation. Where would a fleet manager give up?",
        terms: [["Lead", "A potential customer who has shared contact details"], ["MQL / SQL", "Marketing- / sales-qualified lead"], ["Landing page", "A page built for one offer and one action"]],
        checks: [
          ["What makes a lead 'sales-qualified'?", ["They liked a post", "They fit the profile and have a real need and timing", "They follow us", "They are a competitor"], 1, "SQLs are ready for a sales conversation."],
          ["A landing page should have…", ["Many offers and links", "One offer and one clear form", "No form", "The full company history"], 1, "Focus raises conversion."],
          ["How fast should a new B2B lead get a reply?", ["Within a week", "The same day, ideally within the hour", "Next month", "Only if they call again"], 1, "Interest fades fast; speed wins deals."],
        ],
      },
      {
        id: "h2", title: "Paid ads fundamentals", minutes: 5,
        short: "Meta and Google ads let you pay to reach exactly who you choose. The setup decides most of the result.",
        points: [
          { h: "Structure", t: "Campaign (the objective) → ad set (audience, budget, placement, schedule) → ad (the creative and copy)." },
          { h: "Objective first", t: "Choose what you want — awareness, traffic, leads, sales. The platform optimises for exactly that, so the wrong objective buys the wrong people." },
          { h: "Audience", t: "Location, age, interests, or lookalikes of people who already engaged. Too narrow is expensive; too broad is wasted." },
          { h: "Learning phase", t: "New ad sets need time and results to settle. Changing them every day keeps them learning and costs more." },
          { h: "Read the right number", t: "For a lead campaign judge cost per lead and lead quality — not likes." },
        ],
        example: "Campaign: Leads. Ad set: men 21–40 in Chennai and Coimbatore, interest in delivery jobs, ₹1,000/day. Ads: two reels and one carousel, same offer — book a test ride.",
        tryThis: "Write the objective, audience and success number for an ad that should bring fleet enquiries from Bengaluru.",
        terms: [["Objective", "What the platform will optimise for"], ["Lookalike audience", "People similar to a list you give"], ["Learning phase", "The period an ad set needs to stabilise"]],
        checks: [
          ["In Meta ads, where is the audience set?", ["Campaign", "Ad set", "Ad", "Page settings"], 1, "Audience, budget and placement live at the ad-set level."],
          ["You want enquiries. Which objective?", ["Awareness", "Leads", "Video views", "Page likes"], 1, "The platform finds people likely to do what the objective asks."],
          ["A new ad set is edited every day. The likely effect?", ["Better results", "It keeps re-entering learning and costs rise", "Nothing", "It gets free reach"], 1, "Frequent edits reset learning."],
        ],
      },
      {
        id: "h3", title: "Search and SEO basics", minutes: 4,
        short: "When someone searches 'electric bike for delivery Coimbatore', you want to be what they find.",
        points: [
          { h: "Intent", t: "Searches show what people want: learning ('how far does an EV bike go'), comparing ('Challenger vs …'), or buying ('EV bike dealer near me')." },
          { h: "On-page", t: "Each page answers one question well, with the words people search in the title, heading and first paragraph." },
          { h: "Google Business Profile", t: "For local buyers it is often the first thing they see: correct address, hours, photos, and replies to reviews." },
          { h: "Slow but lasting", t: "SEO takes months, but a page that ranks keeps bringing visitors without paying for each one." },
        ],
        example: "A blog post 'Running cost of an electric delivery bike in Tamil Nadu — worked out' answers a real search, links to the test-ride page, and keeps being found for a year.",
        tryThis: "Search Google for three things a fleet manager might type. Where does BNC appear? Who appears instead?",
        terms: [["SEO", "Search engine optimisation — being found without paying per click"], ["Search intent", "What the searcher is trying to do"], ["SERP", "The search results page"]],
        checks: [
          ["'EV bike dealer near me' shows which intent?", ["Learning", "Buying", "Entertainment", "None"], 1, "'Near me' plus 'dealer' means ready to act."],
          ["For local buyers, which matters a lot?", ["Google Business Profile", "Number of hashtags", "Font size on Instagram", "Email signature"], 0, "Local searches often show the business profile first."],
          ["SEO results usually come…", ["Instantly", "Over months, and then last", "Only with paid ads", "Never"], 1, "It is slow to build and slow to fade."],
        ],
      },
      {
        id: "h4", title: "Email and WhatsApp", minutes: 4,
        short: "Messages to people who asked to hear from you are the cheapest, most personal channel you have — if you respect them.",
        points: [
          { h: "Consent first", t: "Only message people who opted in, and make stopping easy. India's data-protection law (DPDP Act) expects clear consent for personal data." },
          { h: "Segment", t: "Fleet managers, riders, dealers and investors want different messages. One list for everyone means irrelevant messages for most." },
          { h: "WhatsApp Business", t: "On the WhatsApp Business Platform, a conversation the business starts uses an approved template; within 24 hours of the customer's last message you can reply freely. Keep it short and useful." },
          { h: "Measure", t: "Email: open rate, click rate, unsubscribes. WhatsApp: delivered, read, replied. Rising unsubscribes mean the messages are not wanted." },
        ],
        example: "A rider who booked a test ride gets: a WhatsApp confirmation with the address, a reminder the day before, and a follow-up asking how it went — three messages, all expected.",
        tryThis: "List every message a new test-ride lead gets from us in their first week. Is any of them unexpected or missing?",
        terms: [["Opt-in", "Clear permission to be contacted"], ["Segmentation", "Splitting a list by who people are"], ["Template message", "A pre-approved WhatsApp Business message"]],
        checks: [
          ["Before sending marketing messages you need…", ["A large list", "The person's consent", "A long message", "A discount"], 1, "Consent is required and keeps trust."],
          ["Unsubscribes are rising. This usually means…", ["Messages are not relevant or too frequent", "Everything is fine", "The font is wrong", "Email is broken"], 0, "People leave lists that do not serve them."],
          ["Why segment a list?", ["To send fewer emails ever", "So each group gets messages relevant to them", "It is required by Instagram", "To hide prices"], 1, "Relevance drives response."],
        ],
      },
      {
        id: "h5", title: "Tracking and UTMs", minutes: 4,
        short: "If you cannot trace a lead to where it came from, you cannot tell which work is paying off.",
        points: [
          { h: "UTM tags", t: "Small labels on a link: utm_source (instagram), utm_medium (social or paid), utm_campaign (oct-fleet-launch). Analytics then shows where each visit came from." },
          { h: "Be consistent", t: "Always lower case, same names every time. 'Instagram' and 'instagram' become two sources in the report." },
          { h: "Events", t: "In Google Analytics 4, record the actions that matter — form submitted, test ride booked, brochure downloaded." },
          { h: "Pixels", t: "The Meta pixel on the website tells Meta who acted, so ads can find more people like them and report results." },
        ],
        example: "Bio link: bncmotors.com/test-ride?utm_source=instagram&utm_medium=social&utm_campaign=oct-rider — every booking from the bio is now counted as Instagram, October rider campaign.",
        tryThis: "Write UTM-tagged links for the same landing page from Instagram, LinkedIn and a WhatsApp broadcast.",
        terms: [["UTM", "Tags added to a link to track where visits come from"], ["GA4", "Google Analytics 4"], ["Pixel", "Code that reports website actions back to an ad platform"]],
        checks: [
          ["Which UTM tag names the campaign?", ["utm_source", "utm_medium", "utm_campaign", "utm_colour"], 2, "utm_campaign groups visits by campaign."],
          ["Why keep UTM names in lower case and consistent?", ["It looks nicer", "Different spellings split one source into several in reports", "Google charges for capitals", "It is not important"], 1, "Inconsistent tags fragment the data."],
          ["What does the Meta pixel do?", ["Designs ads", "Reports website actions back to Meta", "Writes captions", "Blocks bots"], 1, "It lets Meta measure and optimise for real actions."],
        ],
      },
      {
        id: "h6", title: "A/B testing", minutes: 4,
        short: "Change one thing, show both versions to similar people, and let the result decide.",
        points: [
          { h: "One variable", t: "Test the headline OR the image OR the offer. Change two at once and you will not know which one worked." },
          { h: "Enough people", t: "Ten clicks each is noise. Wait for enough results — usually hundreds of impressions and dozens of actions per version." },
          { h: "Same time, same audience", t: "Run both together so the day, season and audience are the same for each." },
          { h: "Write down what you learn", t: "A test is only worth its lesson: 'cost-saving headlines beat range headlines for riders' changes the next twenty posts." },
        ],
        example: "Two ads, identical except the headline: 'Save ₹3,000 a month' vs '110 km on one charge'. After a week and 80 leads, saving wins 52 to 28 — the next month's creative leads with savings.",
        tryThis: "Pick one thing on our test-ride page to test. Write the two versions and the number that will decide it.",
        terms: [["A/B test", "Comparing two versions that differ in one thing"], ["Variable", "The single thing that changes"], ["Statistical significance", "Confidence the difference is not luck"]],
        checks: [
          ["A good A/B test changes…", ["Everything at once", "One thing", "Nothing", "Only the budget"], 1, "One change means you know what caused the result."],
          ["Version A got 6 clicks, B got 4. Conclusion?", ["A wins, roll it out", "Too few results to tell yet", "B wins", "Stop testing"], 1, "Small numbers are mostly noise."],
          ["Why run both versions at the same time?", ["It is cheaper", "So timing and audience are the same for both", "Meta requires it", "It is not important"], 1, "Otherwise the day or season could explain the difference."],
        ],
      },
    ],
  },
  {
    key: "advanced", label: "Advanced", tag: "Running marketing",
    what: "Strategy, budgets, unit economics, measurement, launches and building a brand that lasts.",
    outcomes: ["Turn a business goal into a marketing plan with numbers", "Judge spend by CAC, LTV and payback", "Plan a launch and say how you will know it worked"],
    lessons: [
      {
        id: "a1", title: "Strategy and planning", minutes: 5,
        short: "Strategy is choosing where to play and how to win — and what you will not do.",
        points: [
          { h: "Objective → strategy → tactics", t: "Objective: 500 fleet bikes sold this year. Strategy: win quick-commerce fleets in three Tamil Nadu cities on running cost. Tactics: LinkedIn content, fleet trials, cost calculator, sales follow-up." },
          { h: "SMART goals", t: "Specific, Measurable, Achievable, Relevant, Time-bound. 'More awareness' is not a goal; '30,000 riders reached in Chennai by March' is." },
          { h: "Market size", t: "TAM (everyone who could buy), SAM (those you can actually serve), SOM (what you can realistically win). Plan on SOM." },
          { h: "Say no", t: "A strategy that includes everything is a wish list. Choosing three cities means not chasing ten." },
        ],
        example: "Not 'be present everywhere' but: 'For the next two quarters, every rupee and post serves fleets of 20+ bikes in Chennai, Coimbatore and Bengaluru.'",
        tryThis: "Write next quarter's marketing objective as one SMART sentence, then the three tactics that serve it most.",
        terms: [["SMART", "Specific, Measurable, Achievable, Relevant, Time-bound"], ["TAM / SAM / SOM", "Total, serviceable and obtainable market"], ["Tactic", "A specific action that serves the strategy"]],
        checks: [
          ["Which is a SMART goal?", ["Increase awareness", "Reach 30,000 riders in Chennai by March", "Be the best brand", "Post more"], 1, "It is specific, measurable and dated."],
          ["SOM means…", ["The whole market", "The part you can realistically win", "Social media only", "Sales operations"], 1, "Serviceable obtainable market — what you can actually capture."],
          ["A good strategy also says…", ["Nothing about limits", "What you will not do", "Every possible channel", "Only the budget"], 1, "Choice means leaving things out."],
        ],
      },
      {
        id: "a2", title: "Budgets and unit economics", minutes: 5,
        short: "Marketing spend is an investment. CAC, LTV and payback tell you whether it is a good one.",
        points: [
          { h: "CAC", t: "Customer acquisition cost = total sales and marketing spend ÷ new customers. ₹6 lakh for 20 new fleet customers = ₹30,000 each." },
          { h: "LTV", t: "Lifetime value = the gross profit a customer brings over the whole relationship — bikes, service, batteries, repeat orders." },
          { h: "LTV:CAC", t: "A common rule of thumb is LTV at least three times CAC. Below one, every customer loses money." },
          { h: "Payback", t: "How many months of a customer's profit it takes to earn back their CAC. Shorter means growth funds itself sooner." },
          { h: "ROAS", t: "Return on ad spend = revenue from ads ÷ ad spend. Useful for direct sales, misleading for long B2B cycles." },
        ],
        example: "A fleet customer costs ₹30,000 to win and brings ₹1.5 lakh of profit over three years: LTV:CAC = 5. Worth spending more to win more of them.",
        tryThis: "Using last quarter's spend and new customers, work out our CAC. What would LTV need to be for a 3:1 ratio?",
        terms: [["CAC", "Cost to acquire one customer"], ["LTV", "Profit from a customer over the relationship"], ["ROAS", "Revenue ÷ ad spend"]],
        checks: [
          ["₹4 lakh spent, 10 new customers. CAC is…", ["₹4,000", "₹40,000", "₹400", "₹4 lakh"], 1, "4,00,000 ÷ 10 = ₹40,000."],
          ["LTV:CAC of 0.8 means…", ["Very healthy", "Each customer costs more than they bring", "Perfect balance", "Nothing"], 1, "Below one, acquisition loses money."],
          ["Why can ROAS mislead for B2B fleets?", ["It is always zero", "Sales take months and many touches, so revenue is not tied to one ad", "Ads do not work for B2B", "It counts likes"], 1, "Long cycles break the direct link between an ad and revenue."],
        ],
      },
      {
        id: "a3", title: "Attribution and measurement", minutes: 5,
        short: "A buyer saw a reel, a LinkedIn post, an ad and a dealer before buying. Which one gets the credit — and does it matter?",
        points: [
          { h: "Last-click", t: "All credit to the final touch. Simple, but it undervalues everything that created the interest." },
          { h: "Multi-touch", t: "Credit spread across touches (first, last, linear, data-driven). Closer to reality, needs good tracking." },
          { h: "Incrementality", t: "The real question: would the sale have happened without this? Test it with holdouts — a city or audience that does not see the campaign." },
          { h: "Ask the customer", t: "'How did you hear about us?' on the form and in the sales call. Cheap, imperfect, and often the most honest signal." },
        ],
        example: "Last-click says Google search brings all our fleet leads. But most of those searchers had seen our LinkedIn posts first. Turning LinkedIn off would quietly shrink the searches too.",
        tryThis: "Add 'How did you first hear about BNC?' to the test-ride form. After a month, compare its answers with what analytics says.",
        terms: [["Attribution", "Assigning credit for a result to the touches before it"], ["Incrementality", "The extra result caused by an activity"], ["Holdout", "A group deliberately not shown a campaign, for comparison"]],
        checks: [
          ["Last-click attribution tends to…", ["Over-credit the first touch", "Over-credit the final touch and undervalue awareness work", "Be perfectly accurate", "Ignore search"], 1, "The final touch gets everything, earlier work gets nothing."],
          ["How do you test whether a campaign caused extra sales?", ["Count likes", "Compare with a holdout group that did not see it", "Ask the designer", "Double the budget"], 1, "A holdout shows what would have happened anyway."],
          ["A cheap, useful attribution signal is…", ["Asking customers how they heard of you", "Guessing", "Follower count", "Number of hashtags"], 0, "Self-reported source is imperfect but honest and free."],
        ],
      },
      {
        id: "a4", title: "Competitors and differentiation", minutes: 4,
        short: "Know who else the buyer is considering, what they claim, and where you are genuinely different.",
        points: [
          { h: "Who the buyer compares", t: "Not only other EV makers — petrol bikes, renting instead of buying, and doing nothing are competitors too." },
          { h: "Map claims", t: "List what each competitor leads with: price, range, speed, service, financing. Look for the gap nobody owns that matters to buyers." },
          { h: "Differentiate on what is true", t: "Only claim an advantage you can prove and keep. Copying a rival's message makes you the cheaper copy." },
          { h: "Watch, do not chase", t: "Track competitors monthly; react to what changes buyers' choices, not to every post." },
        ],
        example: "If rivals lead with speed and style, a load-carrying, service-guaranteed working bike for fleets is a position nobody is defending.",
        tryThis: "Make a table of four alternatives a fleet manager has (including petrol and renting). One row each: price, running cost, service, main claim.",
        terms: [["Differentiation", "A meaningful, provable difference from alternatives"], ["Competitive set", "Everything the buyer is choosing between"], ["Share of voice", "Your share of the category's visible attention"]],
        checks: [
          ["For a fleet buyer, which counts as a competitor?", ["Only other EV brands", "Other EVs, petrol bikes, renting, and doing nothing", "Only luxury cars", "None"], 1, "Any alternative way to solve the need competes."],
          ["Copying a competitor's main message usually…", ["Makes you stand out", "Makes you look like the copy", "Doubles sales", "Is required"], 1, "Differentiation comes from owning your own ground."],
          ["Which advantage should you claim?", ["Any that sounds good", "One you can prove and keep", "Whatever the rival claims", "None"], 1, "Unprovable claims cost trust when tested."],
        ],
      },
      {
        id: "a5", title: "Planning a launch", minutes: 5,
        short: "A launch is a plan with a date: who, what message, which channels, in what order, and how you will know it worked.",
        points: [
          { h: "Before", t: "Brief, audience, one message, assets (photos, video, spec sheet, landing page), sales and dealers briefed, tracking set up." },
          { h: "Launch week", t: "Coordinated moment across owned, paid and earned: posts, ads, press, partner posts, dealer WhatsApp — the same message everywhere." },
          { h: "After", t: "Keep going — proof content, customer stories, retargeting people who engaged. Most launches fade because week two is empty." },
          { h: "Success, decided first", t: "Set the numbers before launch: reach, leads, test rides, orders by week four. Otherwise every result can be called a success." },
        ],
        example: "New model launch: T-4 weeks teasers and dealer briefing; T-0 reveal reel, LinkedIn announcement, press release, ads on; T+1–4 weeks rider reviews, comparison carousels, retargeting; review at T+4 against the targets set at T-4.",
        tryThis: "Draft a four-week launch plan for one product on a single page, with the target numbers at the top.",
        terms: [["Go-to-market (GTM)", "The plan for bringing a product to buyers"], ["Retargeting", "Showing ads to people who already engaged"], ["Launch metrics", "Targets set before launch to judge it"]],
        checks: [
          ["When should launch success numbers be set?", ["After the launch", "Before the launch", "Never", "Only if it goes well"], 1, "Targets set afterwards can make anything look like success."],
          ["Why do many launches fade?", ["Too much planning", "Nothing planned for the weeks after launch", "Too few colours", "Instagram limits"], 1, "Momentum needs follow-up content."],
          ["Who should be briefed before launch?", ["Only the designer", "Sales and dealers as well as marketing", "Nobody", "Only competitors"], 1, "Buyers will ask sales and dealers first."],
        ],
      },
      {
        id: "a6", title: "Building a brand that lasts", minutes: 4,
        short: "Performance marketing harvests demand that exists. Brand building creates the demand you will harvest next year.",
        points: [
          { h: "Two jobs", t: "Short-term activation (leads now) and long-term brand (being the first name people think of). Doing only the first slowly dries up the second." },
          { h: "A rule of thumb", t: "Research by Binet and Field is often summarised as roughly 60% brand / 40% activation for consumer brands, with B2B leaning nearer half and half. Treat it as a starting point, not a law." },
          { h: "Distinctive assets", t: "The colours, shapes, sounds and phrases people recognise without the logo. Pick them and never stop using them." },
          { h: "Patience and consistency", t: "Brand effects build over years. Changing look and message every quarter resets the memory you were building." },
        ],
        example: "Every BNC post uses the same dark ground, accent green and Space Grotesk headlines. Two years of that, and a rider recognises a BNC post before reading a word.",
        tryThis: "List our three most distinctive assets. Are we using them in every post? Where are we not?",
        terms: [["Brand building", "Long-term work to be remembered and preferred"], ["Activation", "Short-term work to get action now"], ["Mental availability", "How easily the brand comes to mind when buying"]],
        checks: [
          ["Spending only on short-term lead ads tends to…", ["Build the brand faster", "Slowly reduce future demand", "Have no effect", "Lower costs forever"], 1, "Without brand work, the pool of people who know you shrinks."],
          ["The 60/40 brand/activation split is best treated as…", ["A strict law", "A research-based starting point", "Only for B2B", "Irrelevant"], 1, "It is a guide to adapt, not a rule."],
          ["Changing the brand's look every few months…", ["Builds recognition", "Resets the memory the brand was building", "Is required by Meta", "Increases CTR permanently"], 1, "Consistency is what makes assets distinctive."],
        ],
      },
    ],
  },
];

export const ALL_LESSONS: (Lesson & { level: LevelKey })[] = LEVELS.flatMap((l) => l.lessons.map((x) => ({ ...x, level: l.key })));
export const lessonById = (id: string) => ALL_LESSONS.find((l) => l.id === id);
export const levelByKey = (key: string) => LEVELS.find((l) => l.key === key);
