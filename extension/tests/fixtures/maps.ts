// Minimal HTML mirroring the structure observed on google.com/maps (2026-10-05).
// Business names and ids are fictional.

export const PLACE_HREF_A =
  "https://www.google.com/maps/place/Example+University/data=!4m7!3m6!1s0x399bfd99491cd3df:0xef84c13754ef7e48!8m2!3d26.8635706!4d80.9361191!16zL20vMGRmenBw!19sChIJexampleAAAAAAAAAAAAAA?authuser=0&hl=en&rclk=1";
export const PLACE_HREF_B =
  "https://www.google.com/maps/place/Sample+College/data=!4m7!3m6!1s0x399be2496846a6ed:0x125a5ffab9061e23!8m2!3d26.8519904!4d81.0504293!16s%2Fg%2F11bvzqv95q!19sChIJsampleBBBBBBBBBBBBBBBB?authuser=0&hl=en";
export const PLACE_HREF_C_NO_IDS = "https://www.google.com/maps/place/No+Ids+Institute/@26.8,80.9,17z";

function card(name: string, href: string, extra = "") {
  return `
    <div class="Nv2PK">
      <a class="hfpxzc" aria-label="${name}" href="${href}"></a>
      <div>${name}</div>
      <div>4.4(7,780)</div>
      <div>University · ${extra}</div>
    </div>`;
}

export function resultsHtml(opts: { end?: "end" | "limited" } = {}) {
  const tail =
    opts.end === "end"
      ? `<div><span>You've reached the end of the list.</span></div>`
      : opts.end === "limited"
        ? `<div>You're seeing a limited view of Google Maps. See more</div>`
        : "";
  return `
    <div role="main" aria-label="Results for University in Lucknow">
      <h1>Results</h1>
      <div role="feed" aria-label="Results for University in Lucknow">
        ${card("Example University", PLACE_HREF_A)}
        ${card("Sample College", PLACE_HREF_B, "Tondan Marg")}
        ${card("Example University", PLACE_HREF_A)}
        ${card("No Ids Institute", PLACE_HREF_C_NO_IDS)}
        ${tail}
      </div>
    </div>`;
}

/** Detail panel for an opened place. Pass null to omit a row. */
export function detailHtml(d: {
  name: string;
  category?: string | null;
  rating?: string | null;
  reviews?: string | null;
  address?: string | null;
  phoneId?: string | null;
  phoneText?: string | null;
  website?: string | null;
}) {
  const row = (html: string | false | null | undefined) => (html ? html : "");
  return `
    <div role="main" aria-label="${d.name}">
      <div><h1>${d.name}<span></span></h1><h2><span>अन्य नाम</span></h2>
        ${row(
          d.rating !== null &&
            `<div><span><span aria-hidden="true">4.2</span><span role="img" aria-label="${d.rating ?? "4.2 stars "}"></span></span>
             <span><span><span role="img" aria-label="${d.reviews ?? "1,262 reviews"}">(${(d.reviews ?? "1,262 reviews").split(" ")[0]})</span></span></span></div>`,
        )}
        ${row(d.category !== null && `<span><button jsaction="pane.wfvdle12.category">${d.category ?? "University"}</button></span>`)}
      </div>
      ${row(d.address !== null && `<button data-item-id="address" aria-label="Address: ${d.address}"><div></div><div>${d.address}</div></button>`)}
      <button data-item-id="locatedin" aria-label="Located in: Some Campus">Located in: Some Campus</button>
      <a data-item-id="action:3" href="https://api.whatsapp.com/send?phone=910000000000">whatsapp.com</a>
      ${row(d.website !== null && `<a data-item-id="authority" href="${d.website ?? "http://www.example.edu.in/"}" aria-label="Website: example.edu.in">example.edu.in</a>`)}
      ${row(d.phoneId !== null && `<button data-item-id="${d.phoneId ?? "phone:tel:08957926677"}" aria-label="Phone: ${d.phoneText ?? "089579 26677"}">${d.phoneText ?? "089579 26677"}</button>`)}
      <button data-item-id="oloc" aria-label="Plus code: VVGC+H8 Lucknow, Uttar Pradesh">VVGC+H8 Lucknow, Uttar Pradesh</button>
    </div>`;
}
