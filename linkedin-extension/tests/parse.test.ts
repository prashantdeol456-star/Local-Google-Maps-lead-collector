// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { findContactInfoDialog, parseContactInfo, readProfile, readProfileLinks, textLines } from "../src/content/parse";

// Shaped like LinkedIn's profile page and Contact info overlay (labels and links as shown on
// screen; class names deliberately minimal because LinkedIn changes them).
const TOP_CARD = `
  <main>
    <section>
      <div><div><div>
        <h1>Nikhil Sharda</h1>
        <span aria-hidden="true">· 1st</span><span>· 1st</span>
      </div></div></div>
      <div class="text-body-medium">Founder at Fixtra | Writing about B2B sales</div>
      <span class="text-body-small inline">Lucknow, Uttar Pradesh, India</span>
      <a href="/in/nikhil-sharda/overlay/contact-info/">Contact info</a>
      <button aria-label="Current company: Fixtra. Click to skip to experience card">Fixtra</button>
    </section>
  </main>`;

const CONTACT_INFO = `
  <div role="dialog" class="artdeco-modal">
    <h2>Contact info</h2>
    <button aria-label="Dismiss"><span>Dismiss</span></button>
    <section>
      <h3>Nikhil's Profile</h3>
      <a href="https://www.linkedin.com/in/nikhil-sharda">linkedin.com/in/nikhil-sharda</a>
    </section>
    <section>
      <h3>Websites</h3>
      <ul>
        <li><a href="https://fixtra.in">fixtra.in</a> <span>(Company)</span></li>
        <li><a href="https://nikhilsharda.substack.com">nikhilsharda.substack.com</a> <span>(Blog)</span></li>
      </ul>
    </section>
    <section>
      <h3>Phone</h3>
      <ul><li><span>+91 98765 43210</span> <span>(Mobile)</span></li></ul>
    </section>
    <section>
      <h3>Email</h3>
      <a href="mailto:Nikhil@Fixtra.in">Nikhil@Fixtra.in</a>
    </section>
    <section>
      <h3>IM</h3>
      <ul><li><span>nikhil.sharda</span> <span>(Google Hangouts)</span></li></ul>
    </section>
    <section>
      <h3>Birthday</h3>
      <span>February 5</span>
    </section>
    <section>
      <h3>Connected</h3>
      <span>Oct 19, 2026</span>
    </section>
  </div>`;

beforeEach(() => {
  document.title = "(3) Nikhil Sharda | LinkedIn";
  document.body.innerHTML = TOP_CARD;
});

describe("Contact info", () => {
  it("reads every section by its label", () => {
    document.body.insertAdjacentHTML("beforeend", CONTACT_INFO);
    const dialog = findContactInfoDialog(document)!;
    expect(parseContactInfo(dialog)).toEqual({
      profileUrl: "https://www.linkedin.com/in/nikhil-sharda",
      emails: ["nikhil@fixtra.in"],
      phones: ["+91 98765 43210"],
      websites: [
        { url: "fixtra.in", label: "Company" },
        { url: "nikhilsharda.substack.com", label: "Blog" },
      ],
      ims: ["nikhil.sharda (Google Hangouts)"],
      birthday: "February 5",
      address: null,
      connectedSince: "Oct 19, 2026",
    });
  });

  it("works when label and value share a line, and with an address", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div role="dialog"><h2>Contact info</h2>
        <h3>Your Profile</h3><span>linkedin.com/in/aman-singh</span>
        <h3>Website</h3><span>amansingh.dev (Personal)</span>
        <h3>Address</h3><span>12 MG Road</span><span>Lucknow</span>
        <h3>Email</h3><span>aman@example.com</span>
        <h3>Connected since</h3><span>Jan 2, 2025</span></div>`,
    );
    const info = parseContactInfo(findContactInfoDialog(document)!);
    expect(info).toMatchObject({
      profileUrl: "https://www.linkedin.com/in/aman-singh",
      websites: [{ url: "amansingh.dev", label: "Personal" }],
      address: "12 MG Road, Lucknow",
      emails: ["aman@example.com"],
      connectedSince: "Jan 2, 2025",
    });
  });

  it("skips screen-reader duplicates", () => {
    document.body.innerHTML = `<div><span aria-hidden="true">Bala M</span><span class="visually-hidden">Bala M</span></div>`;
    expect(textLines(document.body)).toEqual(["Bala M"]);
  });
});

describe("profile page", () => {
  it("reads the top card; without the dialog it says Contact info was not read", () => {
    const r = readProfile(document, "https://www.linkedin.com/in/nikhil-sharda/");
    expect(r).toMatchObject({
      profileUrl: "https://www.linkedin.com/in/nikhil-sharda",
      contactInfoOpen: false,
      lead: { name: "Nikhil Sharda", headline: "Founder at Fixtra | Writing about B2B sales", company: "Fixtra", location: "Lucknow, Uttar Pradesh, India", emails: [] },
    });
  });

  it("combines top card and the open Contact info dialog", () => {
    document.body.insertAdjacentHTML("beforeend", CONTACT_INFO);
    const r = readProfile(document, "https://www.linkedin.com/in/nikhil-sharda/overlay/contact-info/");
    expect(r.contactInfoOpen).toBe(true);
    expect(r.lead).toMatchObject({ name: "Nikhil Sharda", emails: ["nikhil@fixtra.in"], birthday: "February 5" });
  });

  it("falls back to the page title and the headline for name and company", () => {
    document.body.innerHTML = `<main><section><h1></h1><div class="text-body-medium">HR Executive at Acme Labs</div></section></main>`;
    const r = readProfile(document, "https://www.linkedin.com/in/x");
    expect(r.lead).toMatchObject({ name: "Nikhil Sharda", company: "Acme Labs" });
  });
});

describe("2026 profile layout (no h1, obfuscated classes)", () => {
  it("finds the top card from the Contact info link and reads the open dialog", () => {
    document.title = "Asha Verma | LinkedIn";
    document.body.innerHTML = `<main>
      <div class="x1"><div class="x2">
        <a href="/in/asha-verma/"><div aria-label="Asha Verma"><h2 class="x3">Asha Verma</h2></div></a>
        <p>HR Manager | Talent Acquisition</p>
        <a href="/company/acme/"><svg aria-label="View company: Acme Labs"></svg><span>Acme Labs</span></a>
        <p>Lucknow, India</p><span>·</span>
        <a href="https://www.linkedin.com/in/asha-verma/overlay/contact-info/">Contact info</a>
        <span>500+ connections</span>
      </div></div></main>
      <dialog open><h2>Contact info</h2>
        <h3>Asha's profile</h3><a href="https://www.linkedin.com/in/asha-verma/">linkedin.com/in/asha-verma</a>
        <h3>Website</h3><a href="https://acme.in">acme.in</a><span>(Company)</span>
        <h3>Phone</h3><span>09876543210</span><span>(Mobile)</span>
        <h3>Address</h3><span>Delhi NCR</span>
        <h3>Email</h3><a href="mailto:asha@acme.in">asha@acme.in</a>
        <h3>Birthday</h3><span>October 17</span>
        <a href="https://www.linkedin.com/in/asha-verma/edit/forms/contact-info/new/">Edit contact info</a>
      </dialog>`;
    const r = readProfile(document, "https://www.linkedin.com/in/asha-verma/overlay/contact-info/");
    expect(r).toEqual({
      profileUrl: "https://www.linkedin.com/in/asha-verma",
      contactInfoOpen: true,
      lead: {
        name: "Asha Verma",
        headline: "HR Manager | Talent Acquisition",
        company: "Acme Labs",
        location: "Lucknow, India",
        emails: ["asha@acme.in"],
        phones: ["09876543210"],
        websites: [{ url: "acme.in", label: "Company" }],
        ims: [],
        experience: [],
        education: [],
        birthday: "October 17",
        address: "Delhi NCR",
        connectedSince: null,
      },
    });
  });
});

describe("Experience and Education", () => {
  const item = (...lines: string[]) => `<div><a href="/company/1/"></a>${lines.map((l) => `<p>${l}</p>`).join("")}</div>`;

  it("reads positions, grouped positions and education entries", () => {
    document.body.innerHTML = `<main>
      <div><div><h2>Experience</h2></div><div>
        ${item("Product Manager", "the360tech · Part-time", "Jul 2026 - Present · 4 mos", "Noida, Uttar Pradesh, India · Hybrid", "Working on product management.")}
        ${item("Technical Product Manager", "XtraCover · Full-time", "Oct 2023 - May 2024 · 8 mos", "Delhi, India · On-site", "Multiple Project Coordination, User Experience (UX) and +16 skills")}
        ${item("Capgemini", "Full-time · 3 yrs", "Senior Analyst", "Jan 2022 - Dec 2022 · 1 yr", "Noida, India", "Process Associate", "Jan 2020 - Dec 2021 · 2 yrs")}
        ${item("Freelancer", "Self-employed")}
      </div><span>Show all</span></div>
      <div><div><h2>Education</h2></div><div>
        ${item("IIM Lucknow", "MBA, Human Resources", "2019 - 2021", "Grade: A")}
        ${item("Lucknow University", "2014 - 2017")}
      </div></div></main>`;
    const { lead } = readProfile(document, "https://www.linkedin.com/in/x");
    expect(lead.experience).toEqual([
      { title: "Product Manager", company: "the360tech", employmentType: "Part-time", dates: "Jul 2026 - Present · 4 mos", location: "Noida, Uttar Pradesh, India · Hybrid" },
      { title: "Technical Product Manager", company: "XtraCover", employmentType: "Full-time", dates: "Oct 2023 - May 2024 · 8 mos", location: "Delhi, India · On-site" },
      { title: "Senior Analyst", company: "Capgemini", employmentType: "Full-time", dates: "Jan 2022 - Dec 2022 · 1 yr", location: "Noida, India" },
      { title: "Process Associate", company: "Capgemini", employmentType: "Full-time", dates: "Jan 2020 - Dec 2021 · 2 yrs", location: null },
      { title: "Freelancer", company: "Self-employed", employmentType: null, dates: null, location: null },
    ]);
    expect(lead.education).toEqual([
      { school: "IIM Lucknow", degree: "MBA, Human Resources", dates: "2019 - 2021" },
      { school: "Lucknow University", degree: null, dates: "2014 - 2017" },
    ]);
  });

  it("returns empty lists when the sections are missing", () => {
    const { lead } = readProfile(document, "https://www.linkedin.com/in/nikhil-sharda");
    expect(lead.experience).toEqual([]);
    expect(lead.education).toEqual([]);
  });
});

describe("profile links on a page", () => {
  it("lists each member profile once, with its name", () => {
    document.body.innerHTML = `<main><ul>
      <li><a href="https://www.linkedin.com/in/vaishnavi-yadav?miniProfileUrn=x"><span aria-hidden="true">Vaishnavi Yadav</span><span>View Vaishnavi Yadav’s profile</span></a>
          <a href="https://www.linkedin.com/in/vaishnavi-yadav">Vaishnavi Yadav</a></li>
      <li><a href="/in/bala-m/"><img alt=""></a><a href="/in/bala-m/">Bala M</a></li>
      <li><a href="https://www.linkedin.com/company/fixtra">Fixtra</a></li>
      <li><a href="/in/komal/"><span>Komal .</span><span>• 2nd</span><span>HR Manager</span></a>
          <p><a href="/in/aman-singh/">Aman Singh</a> &amp; <a href="/in/babli/">Babli Sagar</a> are mutual connections</p></li>
    </ul></main>`;
    expect(readProfileLinks(document)).toEqual([
      { profileUrl: "https://www.linkedin.com/in/vaishnavi-yadav", name: "Vaishnavi Yadav" },
      { profileUrl: "https://www.linkedin.com/in/bala-m", name: "Bala M" },
      { profileUrl: "https://www.linkedin.com/in/komal", name: "Komal ." },
    ]);
  });
});
