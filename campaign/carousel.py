#!/usr/bin/env python3
"""Builds the Etrol battery carousel, one HTML file per slide.

Five slides, 1080x1350. The subject is the thing the brand profile lists first under what
buyers are afraid of — "battery fires and safety scares in the news" — and the thing they
misunderstand first: "that EV batteries catch fire easily or can't handle rain".

So the carousel does not sell range or price. It answers the fear, with the four facts BNC can
actually evidence from its own Etrol 40 page, one per slide, and nothing else. Every number
here is sourced; none is rounded up, dramatised or inferred. A safety claim is the worst
possible place to be approximately right.

Design follows the poster: black ground, olive from the bike's own frame, Space Grotesk for
voice and IBM Plex Mono for anything that reads as data.
"""
import pathlib

OUT = pathlib.Path(__file__).parent

SHELL = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{
    width:1080px; height:1350px; position:relative; overflow:hidden;
    background:#0A0B0A; font-family:"Space Grotesk",system-ui,sans-serif; color:#F4F6F2;
  }}
  .glow {{ position:absolute; inset:0; background:
      radial-gradient(1000px 640px at {gx}, rgba(124,142,74,.34) 0%, rgba(124,142,74,.08) 44%, transparent 74%); }}
  .grid {{ position:absolute; inset:0; opacity:.05;
    background-image:linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px);
    background-size:90px 90px;
    -webkit-mask-image:radial-gradient(880px 880px at 50% 45%,#000 18%,transparent 76%); }}
  .frame {{ position:absolute; inset:0; padding:64px 68px; display:flex; flex-direction:column; }}
  .top {{ display:flex; align-items:flex-start; justify-content:space-between; }}
  .mark {{ font-size:25px; font-weight:700; letter-spacing:-.02em; }}
  .mark i {{ font-style:normal; color:#A8BF6A; }}
  /* The slide counter is the one piece of furniture a carousel genuinely needs: it tells
     somebody whether swiping is worth it. */
  .count {{ font-family:"IBM Plex Mono",monospace; font-size:13px; letter-spacing:.2em;
    color:rgba(244,246,242,.45); }}
  .count b {{ color:#A8BF6A; font-weight:500; }}
  .body {{ flex:1; display:flex; flex-direction:column; justify-content:center; }}
  .eyebrow {{ font-family:"IBM Plex Mono",monospace; font-size:14px; letter-spacing:.22em;
    text-transform:uppercase; color:#A8BF6A; margin-bottom:26px; }}
  h1 {{ font-size:{h1}px; font-weight:600; line-height:1.06; letter-spacing:-.035em; max-width:{w}ch; }}
  h1 em {{ font-style:normal; color:#A8BF6A; }}
  .big {{ font-size:186px; font-weight:700; line-height:.86; letter-spacing:-.05em; }}
  .big small {{ font-size:68px; font-weight:500; letter-spacing:-.02em; }}
  .say {{ margin-top:28px; font-size:31px; font-weight:400; line-height:1.4; max-width:19ch;
    color:rgba(244,246,242,.84); letter-spacing:-.01em; }}
  .say em {{ font-style:normal; color:#F4F6F2; font-weight:600; }}
  /* Where the claim comes from, on the slide that makes it. A safety number with no source is
     just a louder version of the rumour it is answering. */
  .src {{ margin-top:auto; font-family:"IBM Plex Mono",monospace; font-size:12px; letter-spacing:.13em;
    text-transform:uppercase; color:rgba(244,246,242,.38); border-top:1px solid rgba(244,246,242,.14);
    padding-top:20px; line-height:1.7; }}
  /* On the opening slide the bike shares the frame with the words, so it sits to the right
     and bleeds off the corner rather than running underneath them. Centred and full width it
     ran straight through the swipe prompt. */
  .bike {{ position:absolute; right:-150px; bottom:96px; width:760px;
    filter:drop-shadow(0 40px 60px rgba(0,0,0,.8)); }}
  .swipe {{ font-family:"IBM Plex Mono",monospace; font-size:13px; letter-spacing:.2em;
    text-transform:uppercase; color:#A8BF6A; margin-top:26px; }}
</style></head>
<body>
  <div class="glow"></div><div class="grid"></div>
  {art}
  <div class="frame">
    <div class="top"><div class="mark">BNC <i>Etrol 40</i></div><div class="count"><b>{n}</b> / {total}</div></div>
    <div class="body">{inner}</div>
    <div class="src">{src}</div>
  </div>
</body></html>"""

SLIDES = [
    dict(
        gx="76% 84%", h1=78, w=11,
        inner='<div class="eyebrow">Before you buy electric</div>'
              '<h1>The question nobody asks out loud.</h1>'
              '<div class="say">“Is the <em>battery</em> going to be a problem?”</div>'
              '<div class="swipe">Swipe — four answers →</div>',
        art='<img class="bike" src="src/side.png" alt="">',
        src="BNC Motors · Coimbatore · bncmotors.in",
    ),
    dict(
        gx="22% 24%", h1=86,
        inner='<div class="eyebrow">Heat</div>'
              '<div class="big">300<small>°C</small></div>'
              '<div class="say">Tested to over 300°C <em>continuous internal temperature</em>. '
              'Not a flash test — sustained.</div>',
        art="",
        src="Source · bncmotors.in/etrol.php",
    ),
    dict(
        gx="78% 26%", h1=86,
        inner='<div class="eyebrow">Water and dust</div>'
              '<div class="big">IP<small>67</small></div>'
              '<div class="say">Monsoon, puddles, dust. <em>Sealed</em> against all of it, '
              'and rated so you can check the claim yourself.</div>',
        art="",
        src="Source · bncmotors.in/etrol.php",
    ),
    dict(
        gx="24% 80%", h1=70,
        inner='<div class="eyebrow">The standard</div>'
              '<h1><em>AIS-156</em> Amendment 3, Phase 2.</h1>'
              '<div class="say">India\'s battery safety rules for electric two-wheelers. '
              'Etrol 40 is <em>compliant</em>, and tested to extreme electrical abuse in '
              'worst-case failure modes.</div>',
        art="",
        src="Source · bncmotors.in/etrol.php",
    ),
    dict(
        gx="72% 82%", h1=74,
        inner='<div class="eyebrow">And charging it</div>'
              '<div class="big">6<small>A socket</small></div>'
              '<div class="say">The portable charger plugs into an <em>ordinary wall socket</em>. '
              'No special point to install. No electrician.</div>'
              '<div class="swipe">bncmotors.in — find your nearest dealer</div>',
        art="",
        src="Source · bncmotors.in/etrol.php · Challenger S110 · S125",
    ),
]

total = len(SLIDES)
for i, s in enumerate(SLIDES, 1):
    html = SHELL.format(n=i, total=total, gx=s["gx"], h1=s["h1"], w=s.get("w", 18), inner=s["inner"], art=s["art"], src=s["src"])
    (OUT / f"carousel-{i}.html").write_text(html)
    print(f"carousel-{i}.html")
