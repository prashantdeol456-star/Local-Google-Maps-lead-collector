// Stylesheet of the public website (served at /site.css). Clean, light, Google-like: white
// surfaces, one blue accent, generous spacing, system fonts (no downloads, fast first paint).

export const SITE_CSS = `
:root{--blue:#1a73e8;--blue-d:#1765cc;--blue-l:#e8f0fe;--text:#202124;--muted:#5f6368;--line:#dadce0;--bg:#fff;--alt:#f8f9fa;--ok:#188038;--err:#d93025;--r:12px}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 "Google Sans",Roboto,"Segoe UI",system-ui,-apple-system,Arial,sans-serif}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
h1,h2,h3{line-height:1.25;margin:0 0 .5em;font-weight:500;letter-spacing:-.01em}
h1{font-size:clamp(2rem,4.5vw,3.1rem)}h2{font-size:clamp(1.4rem,2.6vw,2rem)}h3{font-size:1.15rem}
p{margin:0 0 1em}
svg{width:24px;height:24px;fill:currentColor;flex:none}
.wrap{max-width:1140px;margin:0 auto;padding:0 20px}.narrow{max-width:780px}
.muted{color:var(--muted)}.small{font-size:.9rem}.center{text-align:center}
.skip{position:absolute;left:-9999px}.skip:focus{left:12px;top:12px;background:#fff;padding:8px 12px;z-index:10;border-radius:8px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;padding:9px 20px;font-weight:500;font-size:.95rem;border:1px solid transparent;cursor:pointer;font-family:inherit;text-decoration:none!important;transition:background .15s,box-shadow .15s}
.btn--lg{padding:12px 26px;font-size:1rem}
.btn--primary{background:var(--blue);color:#fff}.btn--primary:hover{background:var(--blue-d);box-shadow:0 1px 3px rgba(60,64,67,.3)}
.btn--outline{border-color:var(--line);color:var(--blue);background:#fff}.btn--outline:hover{background:var(--blue-l)}
.btn--text{color:var(--blue)}.btn--text:hover{background:var(--blue-l)}
.btn--light{background:#fff;color:var(--blue)}.btn--light:hover{background:var(--blue-l)}
.top{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.95);backdrop-filter:saturate(1.8) blur(8px);border-bottom:1px solid var(--line)}
.top__in{display:flex;align-items:center;gap:24px;height:64px}
.brand{display:inline-flex;align-items:center;gap:10px;color:var(--text);font-size:1.15rem;font-weight:500;text-decoration:none!important}
.brand__logo{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:var(--blue);color:#fff;font-size:.8rem;font-weight:700}
.nav{display:flex;gap:4px;margin-left:12px}
.nav a{color:var(--muted);padding:8px 12px;border-radius:999px;text-decoration:none}.nav a:hover,.nav a[aria-current]{color:var(--blue);background:var(--blue-l)}
.top__cta{margin-left:auto;display:flex;gap:8px}
.hero{padding:72px 0 56px;background:linear-gradient(180deg,#f1f6fe 0,#fff 100%)}
.hero__in{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center}
.eyebrow{color:var(--blue);font-weight:500;letter-spacing:.02em;margin-bottom:.6em}
.lead{font-size:1.15rem;color:var(--muted);max-width:40em}
.hero__cta{display:flex;flex-wrap:wrap;gap:12px;margin:28px 0 14px}
.preview{background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 32px rgba(60,64,67,.15);overflow:hidden}
.preview__bar{display:flex;gap:6px;padding:12px 14px;background:var(--alt);border-bottom:1px solid var(--line)}
.preview__bar span{width:10px;height:10px;border-radius:50%;background:var(--line)}
.preview__search{display:flex;align-items:center;gap:10px;margin:16px;padding:10px 16px;border:1px solid var(--line);border-radius:999px;color:var(--muted);box-shadow:0 1px 4px rgba(60,64,67,.12)}
.preview__search svg{color:var(--err)}
.preview__list{list-style:none;margin:0;padding:0 16px}
.preview__list li{display:flex;flex-direction:column;padding:12px 4px;border-top:1px solid var(--line)}
.preview__list span{color:var(--muted);font-size:.9rem}
.preview__foot{margin:8px 16px 16px;padding:10px 14px;border-radius:10px;background:#e6f4ea;color:var(--ok);font-size:.9rem;font-weight:500}
.section{padding:64px 0}.section--alt{background:var(--alt)}
.section__h{text-align:center;margin-bottom:36px}
.page-head{padding:56px 0 8px;text-align:center}.page-head .lead{margin:0 auto}
.steps{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.steps li{padding:24px;border:1px solid var(--line);border-radius:var(--r);background:#fff}
.steps__n{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:var(--blue-l);color:var(--blue);font-weight:700;margin-bottom:12px}
.steps p{color:var(--muted);margin:0}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-bottom:28px}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:24px;transition:box-shadow .15s}
.card:hover{box-shadow:0 2px 10px rgba(60,64,67,.15)}
.card svg{color:var(--blue);width:28px;height:28px;margin-bottom:12px}
.card p{color:var(--muted);margin:0}.card__h{font-size:1.15rem}
.faq{border-bottom:1px solid var(--line);padding:4px 0}
.faq summary{cursor:pointer;padding:14px 0;font-weight:500;list-style:none;display:flex;justify-content:space-between;gap:12px}
.faq summary::after{content:"+";color:var(--blue);font-size:1.3rem;line-height:1}
.faq[open] summary::after{content:"–"}
.faq p{color:var(--muted)}
.band{background:var(--blue);color:#fff;padding:48px 0}
.band__in{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:20px}
.band h2{margin:0 0 .2em}.band p{margin:0;opacity:.9}
.plans{display:grid;grid-template-columns:repeat(2,minmax(0,380px));justify-content:center;gap:24px;margin-bottom:24px}
.plan{border:1px solid var(--line);border-radius:16px;padding:28px;background:#fff;display:flex;flex-direction:column}
.plan--main{border:2px solid var(--blue);box-shadow:0 8px 24px rgba(26,115,232,.15)}
.plan__price{font-size:2.6rem;font-weight:500;margin:.1em 0}.plan__price span{font-size:1rem;color:var(--muted);font-weight:400}
.plan .btn{margin-top:auto}
.ticks{list-style:none;padding:0;margin:16px 0 24px}
.ticks li{position:relative;padding-left:28px;margin-bottom:10px}
.ticks li::before{content:"";position:absolute;left:4px;top:.45em;width:12px;height:7px;border-left:2px solid var(--ok);border-bottom:2px solid var(--ok);transform:rotate(-45deg)}
.contact{display:grid;grid-template-columns:1.4fr 1fr;gap:40px;align-items:start}
.form{display:grid;gap:16px}
.field{display:grid;gap:6px}.field span{font-size:.9rem;color:var(--muted)}
.field input,.field textarea{width:100%;font:inherit;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text)}
.field input:focus,.field textarea:focus{outline:2px solid var(--blue);outline-offset:-1px;border-color:transparent}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.contact__list{list-style:none;padding:0;margin:0;display:grid;gap:14px}
.contact__list li{display:flex;gap:10px;align-items:center}.contact__list svg{color:var(--blue)}
.notice{padding:12px 16px;border-radius:8px;margin-bottom:20px}
.notice--ok{background:#e6f4ea;color:var(--ok)}.notice--err{background:#fce8e6;color:var(--err)}
.prose h2{font-size:1.25rem;margin-top:1.6em}.prose p{color:#3c4043}
.foot{border-top:1px solid var(--line);background:var(--alt);padding:48px 0 24px;margin-top:0}
.foot__in{display:grid;grid-template-columns:2fr 1fr 1fr 1.4fr;gap:32px}
.foot__in a:not(.brand){display:block;color:var(--muted);margin-bottom:8px}.foot__in a:hover{color:var(--blue)}
.foot__in .muted{margin-top:12px}
.foot__h{font-size:.95rem;font-weight:500;margin-bottom:12px}
.foot__contact{color:var(--muted)}.foot__contact a{display:inline!important}
.foot__legal{margin-top:32px;padding-top:20px;border-top:1px solid var(--line);font-size:.9rem}
@media (max-width:900px){
  .hero__in,.contact{grid-template-columns:1fr}.preview{max-width:520px}
  .cards,.steps{grid-template-columns:1fr 1fr}
  .foot__in{grid-template-columns:1fr 1fr}
  .nav{display:none}
}
@media (max-width:600px){
  .cards,.steps,.plans,.foot__in{grid-template-columns:1fr}
  .top__cta .btn--text{display:none}
  .hero{padding:48px 0 40px}.section{padding:48px 0}
  .band__in{flex-direction:column;align-items:flex-start}
}
`;
