// Stylesheet of the public website (served at /site.css). Deep green with gold accents: dark
// hero, header, plans and footer; light content sections. System fonts (no downloads).

/** Thin gold curves drawn in the corners of the dark sections. */
const CURVES = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 400' fill='none' stroke='%23d9ad55' stroke-opacity='.45'%3E%3Cpath d='M600 40C470 90 380 210 330 400'/%3E%3Cpath d='M600 90C490 140 410 250 380 400' stroke-opacity='.3'/%3E%3Cpath d='M600 150C520 190 460 280 440 400' stroke-opacity='.2'/%3E%3C/svg%3E")`;

export const SITE_CSS = `
:root{--g950:#041a13;--g900:#06231a;--g800:#0a2e23;--g700:#0f3d2e;--g600:#155c44;--g100:#e7f2ec;--gold:#e2b558;--gold-l:#f3d58c;--gold-d:#c4953a;--text:#0f1f19;--muted:#5a6b63;--line:#e2e8e4;--bg:#fff;--alt:#f3f6f3;--ok:#1d8a52;--err:#c9362b;--r:14px}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 "Plus Jakarta Sans","Segoe UI",Inter,system-ui,-apple-system,Roboto,Arial,sans-serif}
a{color:var(--g600);text-decoration:none}a:hover{text-decoration:underline}
h1,h2,h3{line-height:1.2;margin:0 0 .5em;font-weight:800;letter-spacing:-.02em}
h1{font-size:clamp(2.1rem,4.6vw,3.3rem)}h2{font-size:clamp(1.45rem,2.6vw,2.05rem)}h3{font-size:1.1rem;font-weight:700}
p{margin:0 0 1em}
.i{width:22px;height:22px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.i--sm{width:17px;height:17px}.i--xs{width:14px;height:14px}.i--fill{fill:currentColor;stroke:none}
.mark{width:40px;height:40px;flex:none}
.wrap{max-width:1180px;margin:0 auto;padding:0 20px}.narrow{max-width:820px}
.muted{color:var(--muted)}.small{font-size:.9rem}.center{text-align:center}
.skip{position:absolute;left:-9999px}.skip:focus{left:12px;top:12px;background:#fff;padding:8px 12px;z-index:10;border-radius:8px}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:10px;padding:9px 18px;font-weight:700;font-size:.92rem;border:1px solid transparent;cursor:pointer;font-family:inherit;text-decoration:none!important;transition:filter .15s,background .15s,box-shadow .15s;white-space:nowrap}
.btn--lg{padding:13px 24px;font-size:1rem}.btn--block{width:100%}
.btn--gold{background:linear-gradient(180deg,var(--gold-l),var(--gold) 55%,var(--gold-d));color:#1d1606;box-shadow:0 6px 18px rgba(226,181,88,.25)}.btn--gold:hover{filter:brightness(1.06)}
.btn--ghost{color:#fff;border-color:rgba(255,255,255,.45)}.btn--ghost:hover{background:rgba(255,255,255,.08)}
.btn--outline{color:#fff;border-color:rgba(255,255,255,.75)}.btn--outline:hover{background:rgba(255,255,255,.08)}

/* Header */
.top{background:var(--g900);color:#fff;position:sticky;top:0;z-index:20;border-bottom:1px solid rgba(255,255,255,.06)}
.top__in{display:flex;align-items:center;gap:28px;height:68px}
.brand{display:inline-flex;align-items:center;gap:10px;color:#fff;font-weight:800;font-size:1.15rem;text-decoration:none!important;letter-spacing:-.01em}
.brand sup{font-size:.55em;font-weight:600;margin-left:1px}
.brand__logo{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#1fb57b,#0d8a5c);color:#fff;font-size:.85rem;font-weight:800}
.nav{display:flex;gap:26px;align-items:center;flex:1;margin-left:24px}
.nav a,.dd summary{color:#e8efe9;font-size:.93rem;font-weight:600}.nav a:hover,.dd summary:hover{color:var(--gold-l);text-decoration:none}
.nav a[aria-current]{color:var(--gold)}
.dd{position:relative}.dd summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:4px}.dd summary::-webkit-details-marker{display:none}
.dd__menu{position:absolute;top:150%;left:-12px;min-width:200px;background:#fff;border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.25);padding:8px;display:grid}
.dd__menu a{color:var(--text);padding:8px 12px;border-radius:8px}.dd__menu a:hover{background:var(--alt);color:var(--text)}
.top__cta{display:flex;gap:12px;align-items:center}
.menu{display:none;margin-left:auto}.menu summary{list-style:none;cursor:pointer;color:#fff;padding:6px}.menu summary::-webkit-details-marker{display:none}
.menu__panel{position:absolute;left:0;right:0;top:68px;background:var(--g900);padding:12px 20px 20px;display:grid;gap:4px;border-top:1px solid rgba(255,255,255,.08)}
.menu__panel a{color:#fff;padding:9px 0;font-weight:600}.menu__panel .btn{margin-top:8px;color:#1d1606}

/* Hero */
.hero{position:relative;overflow:hidden;color:#fff;background:${CURVES} right bottom/60% auto no-repeat,radial-gradient(1000px 500px at 85% 20%,#14503c 0%,transparent 60%),linear-gradient(160deg,var(--g800),var(--g950))}
.hero__in{display:grid;grid-template-columns:1fr 1.15fr;gap:48px;align-items:center;padding:56px 20px 64px}
.badge{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;background:rgba(226,181,88,.12);border:1px solid rgba(226,181,88,.35);color:var(--gold-l);font-size:.74rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin:0 0 18px}
.hero h1{max-width:12ch;margin-bottom:.45em}
.hero__lead{color:#d6e2dc;font-size:1.08rem;max-width:520px}
.hero__cta{display:flex;flex-wrap:wrap;gap:14px;margin:26px 0 24px}
.trust{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:10px 26px;font-size:.88rem;color:#d6e2dc}
.trust li{display:flex;align-items:center;gap:7px}.trust .i{color:var(--gold)}.trust li:first-child .i{color:#3ccf8e}

/* Product preview */
.mock{background:#0f3628;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:10px;box-shadow:0 30px 70px rgba(0,0,0,.45);font-size:12px;color:var(--text)}
.mock__bar{display:flex;gap:6px;padding:4px 6px 10px}.mock__bar span{width:9px;height:9px;border-radius:50%;background:#f0605a}.mock__bar span:nth-child(2){background:#f4bf4f}.mock__bar span:nth-child(3){background:#3cc35b}
.mock__body{display:grid;grid-template-columns:150px 1fr;border-radius:12px;overflow:hidden;background:#fff}
.mock__side{background:var(--g900);color:#cfdcd5;padding:14px 10px}
.mock__brand{display:flex;align-items:center;gap:7px;color:#fff;font-weight:800;font-size:12.5px;margin:0 0 16px}.mock__brand .brand__logo{width:24px;height:24px;font-size:10px;border-radius:6px}
.mock__nav{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:8px;margin:0 0 3px;font-weight:600}
.mock__nav.is-on{background:linear-gradient(180deg,var(--gold-l),var(--gold));color:#1d1606}
.mock__main{padding:14px 16px 12px;min-width:0}
.mock__head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.mock__head b{font-size:15px}
.mock__pill{display:inline-flex;align-items:center;gap:3px;border:1px solid var(--line);border-radius:7px;padding:3px 8px;font-size:11px}
.mock__stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
.mock__stats div{border:1px solid var(--line);border-radius:10px;padding:8px;display:grid;grid-template-columns:auto 1fr;column-gap:8px;align-items:center}
.mock__stats b{font-size:15px;line-height:1.1}.mock__stats small{grid-column:2;color:var(--muted);font-size:10.5px;line-height:1.2}
.mock__ic{grid-row:span 2;width:30px;height:30px;border-radius:50%;display:grid;place-items:center}.mock__ic .i{width:16px;height:16px}
.mock__ic--blue{background:#e6eeff;color:#3b6cf6}.mock__ic--green{background:#e3f6ec;color:#1d8a52}.mock__ic--violet{background:#efe8ff;color:#7a4ff0}
.mock__search{display:flex;gap:8px;margin-bottom:9px}.mock__search span{flex:1;display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:5px 10px;color:#333}.mock__search .i{width:14px;height:14px;color:var(--muted)}
.mock__search b{background:linear-gradient(180deg,var(--gold-l),var(--gold));border-radius:999px;padding:5px 16px;font-size:11.5px}
.mock__chips{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px}.mock__chips span{border:1px solid var(--line);border-radius:999px;padding:2px 9px;font-size:10.5px}
.mock__chips .is-on{background:#f6e7c2;border-color:#ecd59b;font-weight:700}.mock__city{margin-left:auto;display:inline-flex;align-items:center;gap:2px}
.mock__table{width:100%;border-collapse:collapse;font-size:10.5px}.mock__table th{text-align:left;font-weight:700;padding:6px 4px;border-bottom:1px solid var(--line)}
.mock__table td{padding:7px 4px;border-bottom:1px solid #f0f3f1;white-space:nowrap}.mock__table i{display:inline-block;width:10px;height:10px;border:1px solid #c9d2cd;border-radius:3px}
.mock__table em{color:#f4b400;font-style:normal}
.st{border-radius:999px;padding:2px 8px;font-weight:700;font-size:10px}.st--ok{background:#dff5e8;color:#1d8a52}.st--new{background:#e6eeff;color:#3b6cf6}

/* Feature strip */
.strip{background:var(--alt);border-bottom:1px solid var(--line)}
.strip__in{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding:26px 20px}
.strip__item{display:flex;gap:14px;align-items:center}.strip__item h2{font-size:1rem;margin:0 0 2px;letter-spacing:-.01em}.strip__item p{margin:0;font-size:.88rem;color:var(--muted);line-height:1.4}

/* Sections */
.section{padding:64px 0}.section--tight{padding:36px 0 64px}.section--alt{background:var(--alt)}
.section__head{text-align:center;max-width:760px;margin:0 auto 34px}.section__head p{color:var(--muted);margin:0}.section__head h2{margin-bottom:.35em}
.tag{display:inline-block;background:#f4e3b8;color:#5a4208;border-radius:999px;padding:3px 13px;font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin:0 0 12px}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:44px}
.step{position:relative;display:flex;gap:16px;background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:22px;box-shadow:0 4px 18px rgba(16,40,30,.05)}
.step:not(:last-child)::after{content:"»";position:absolute;right:-32px;top:50%;transform:translateY(-50%);color:var(--gold-d);font-size:1.7rem;font-weight:700}
.step__ic{width:60px;height:60px;border-radius:50%;background:#fbf1da;color:var(--gold-d);display:grid;place-items:center;flex:none}.step__ic .i{width:30px;height:30px}
.step__n{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--gold);color:#1d1606;font-size:.75rem;font-weight:800;margin-bottom:4px}
.step h3{font-size:1.3rem;margin:0 0 4px}.step p{margin:0;color:var(--muted);font-size:.93rem}
.fcards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.fcard{display:flex;gap:16px;background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:20px;box-shadow:0 4px 18px rgba(16,40,30,.04)}
.fcard h3,.fcard__h{font-size:1.05rem;margin:0 0 4px;font-weight:700}.fcard p{margin:0;color:var(--muted);font-size:.92rem}
.fcard__ic{width:48px;height:48px;border-radius:12px;background:#fbf1da;color:var(--gold-d);display:grid;place-items:center;flex:none}.fcard__ic .i{width:26px;height:26px}

/* Plans */
.plans{padding:0 0 8px}
.plans__panel{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:22px;align-items:center;color:#fff;border-radius:22px;padding:30px 36px;background:${CURVES} left bottom/50% auto no-repeat,linear-gradient(150deg,var(--g700),var(--g950))}
.plans__intro{display:flex;gap:14px;align-items:flex-start}.plans__intro h2{margin-bottom:.4em}.plans__intro p{color:#d6e2dc;margin:0}
.plans__icon{color:var(--gold);padding-top:6px}.plans__icon .i{width:34px;height:34px}
.plan{position:relative;border:1px solid rgba(226,181,88,.45);border-radius:16px;padding:18px 20px;background:rgba(0,0,0,.18)}
.plan--main{border-color:var(--gold)}
.plan__badge{position:absolute;top:-12px;right:14px;background:linear-gradient(180deg,var(--gold-l),var(--gold));color:#1d1606;border-radius:999px;padding:3px 11px;font-size:.72rem;font-weight:800}
.plan__name{margin:0;font-weight:700;font-size:.85rem;color:#dfe9e3}.plan h3{color:var(--gold);font-size:1.45rem;margin:2px 0 10px;font-weight:800}
.ticks{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:6px}.ticks li{display:flex;gap:9px;align-items:flex-start;font-size:.9rem}.ticks .i{color:var(--gold);width:17px;height:17px;margin-top:3px}
.section .ticks li{font-size:1rem}.section .ticks .i{color:var(--ok)}

/* FAQ */
.faqs{border:1px solid var(--line);border-radius:var(--r);overflow:hidden;background:#fff}
.faq{border-bottom:1px solid var(--line);padding:0 20px}.faq:last-child{border-bottom:0}
.faq summary{cursor:pointer;font-weight:700;padding:14px 28px 14px 0;list-style:none;position:relative}.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";position:absolute;right:0;top:9px;font-size:1.45rem;font-weight:400}.faq[open] summary::after{content:"−"}
.faq p{color:var(--muted);margin:-4px 0 14px;font-size:.95rem}

/* Call to action */
.cta{color:#fff;background:${CURVES} right center/40% auto no-repeat,linear-gradient(90deg,var(--g800),var(--g900))}
.cta__in{display:flex;align-items:center;gap:22px;padding:30px 20px}
.cta__icon{color:var(--gold)}.cta__icon .i{width:52px;height:52px;stroke-width:1.5}
.cta__text{flex:1}.cta__text h2{color:var(--gold);margin:0 0 4px;font-size:clamp(1.3rem,2.4vw,1.75rem)}.cta__text p{margin:0;color:#d6e2dc}

/* Page head (inner pages) */
.page-head{color:#fff;padding:60px 0 54px;background:${CURVES} right bottom/50% auto no-repeat,radial-gradient(800px 400px at 85% 10%,#14503c 0%,transparent 60%),linear-gradient(160deg,var(--g800),var(--g950))}
.page-head h1{margin-bottom:.3em}.page-head .hero__lead{margin:0}

/* Contact */
.contact{display:grid;grid-template-columns:1.5fr 1fr;gap:28px;align-items:start}
.box{background:#fff;border:1px solid var(--line);border-radius:18px;padding:26px;box-shadow:0 6px 24px rgba(16,40,30,.06)}
.box--dark{background:linear-gradient(160deg,var(--g700),var(--g950));color:#fff;border:0}.box--dark h2{font-size:1.25rem;color:var(--gold)}
.contact__list{list-style:none;margin:0;padding:0;display:grid;gap:18px}.contact__list li{display:flex;gap:14px;align-items:flex-start}
.contact__list b{display:block;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#b9cbc2}.contact__list a,.contact__list span{color:#fff;font-weight:600;font-size:1.02rem}
.box--dark .fcard__ic{background:rgba(226,181,88,.15);color:var(--gold)}
.form{display:grid;gap:14px}.form__row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.field{display:grid;gap:6px}.field span{font-size:.88rem;font-weight:700}
.field input,.field textarea{font:inherit;padding:11px 13px;border:1px solid #cdd6d1;border-radius:10px;width:100%;background:#fff;color:var(--text)}
.field input:focus,.field textarea:focus{outline:2px solid var(--gold);border-color:var(--gold-d)}
.form .btn{justify-self:start}
.hp{position:absolute;left:-9999px}
.notice{padding:12px 16px;border-radius:10px;margin:0 0 16px}.notice--ok{background:#e3f6ec;color:var(--ok)}.notice--err{background:#fdecea;color:var(--err)}
.prose h2{font-size:1.3rem;margin-top:1.6em}.prose p{color:#33443d}

/* Footer */
.foot{color:#cfdcd5;background:${CURVES} right bottom/45% auto no-repeat,var(--g950);padding:46px 0 22px;font-size:.92rem}
.foot__in{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:30px}
.foot__about p{margin:12px 0 0;max-width:380px}
.foot__contact{display:grid;gap:6px}.foot__contact a,.foot__contact span{display:flex;gap:8px;align-items:center;color:#cfdcd5}.foot__contact .i{width:16px;height:16px;color:var(--gold)}
.foot__h{font-size:.95rem;color:#fff;margin:4px 0 10px;font-weight:700;letter-spacing:0}
.foot__col a{display:block;color:#cfdcd5;padding:3px 0}.foot__col a:hover{color:var(--gold-l)}
.foot__social{display:flex;gap:16px}.foot__social a{color:#fff}.foot__social .i{width:22px;height:22px}
.foot__legal{border-top:1px solid rgba(255,255,255,.08);margin-top:30px;padding-top:16px;font-size:.84rem;color:#9fb3a9}

/* Responsive */
@media (max-width:1060px){.nav,.top__cta{display:none}.menu{display:block}.hero__in{grid-template-columns:1fr}.plans__panel{grid-template-columns:1fr 1fr}.plans__intro{grid-column:1/-1}}
@media (max-width:860px){.strip__in{grid-template-columns:1fr 1fr}.steps,.fcards{grid-template-columns:1fr}.step:not(:last-child)::after{content:"";display:none}.contact{grid-template-columns:1fr}.foot__in{grid-template-columns:1fr 1fr}.foot__about{grid-column:1/-1}}
@media (max-width:600px){.mock__body{grid-template-columns:1fr}.mock__side{display:none}.mock__table th:nth-child(3),.mock__table td:nth-child(3),.mock__table th:nth-child(5),.mock__table td:nth-child(5){display:none}.strip__in{grid-template-columns:1fr}.plans__panel{grid-template-columns:1fr;padding:24px 18px}.cta__in{flex-direction:column;text-align:center}.form__row{grid-template-columns:1fr}.section{padding:48px 0}}
`;
