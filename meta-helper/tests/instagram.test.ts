// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { detectBlock, findComposer, findSendButton, readProfile, readSearchResults, sendFromProfile, type Timing } from "../src/content/instagram";

// Shaped like instagram.com as seen in Oct 2026: profile header with Follow / Message buttons
// (div role=button), and a chat pop-up labelled with the person's name holding a Lexical box.
const PROFILE = `
  <nav><a href="/explore/">Search</a></nav>
  <div><a href="/againnewdotcom/"><span>Profile</span></a></div>
  <main>
    <header>
      <div><h2>cakes_makes</h2></div>
      <div><span>CAKESMAKES | LUCKNOW BAKERY</span></div>
      <ul><li><span>1,203 posts</span></li><li><a href="#">21.7K followers</a></li><li><a href="#">310 following</a></li></ul>
      <div><span>Entrepreneur</span></div>
      <div><span>Custom cakes and desserts in Lucknow. DM to order!</span></div>
      <div><span>... more</span></div>
      <div><a href="https://l.instagram.com/?u=https%3A%2F%2Fcakesmakes.in%2F%3Futm_source%3Dig&e=x">cakesmakes.in</a></div>
      <button>Follow</button>
      <div role="button">Message</div>
      <div><span>CUSTOMER 5.0</span><span>1st BIRTHDAY</span></div>
    </header>
  </main>`;

const CHAT = `
  <div aria-label="CAKESMAKES | LUCKNOW BAKERY">
    <div><span>CAKESMAKES | LUCKNOW BAKERY</span></div>
    <div>
      <div contenteditable="true" role="textbox" aria-placeholder="Message..." data-lexical-editor="true"></div>
      <span class="actions"></span>
    </div>
  </div>`;

const FAST: Timing = { pageLoadMs: 300, findMs: 300, sendConfirmMs: 500, assistedMs: 1200, pollMs: 10 };
const URL_ = "https://www.instagram.com/cakes_makes/";
const job = (mode: "assisted" | "auto") => ({ body: "Hi! Do you take bulk orders?\nThanks", mode, contactName: "CAKESMAKES", profileUrl: URL_ });

/** Message opens the pop-up; typing shows a Send button (like Instagram); Send clears the box. */
function wireInstagram(opts: { failSend?: boolean } = {}) {
  [...document.querySelectorAll<HTMLElement>("header div[role='button']")].find((b) => b.textContent === "Message")!.addEventListener("click", () => {
    document.body.insertAdjacentHTML("beforeend", CHAT);
    const box = document.querySelector<HTMLElement>("[data-lexical-editor]")!;
    const actions = document.querySelector<HTMLElement>(".actions")!;
    box.addEventListener("input", () => {
      if (box.textContent?.trim() && !actions.querySelector("div")) {
        actions.innerHTML = `<div role="button">Send</div>`;
        actions.querySelector("div")!.addEventListener("click", () => {
          if (opts.failSend) document.body.insertAdjacentHTML("beforeend", `<div role="alert">Message wasn't sent. Tap to try again.</div>`);
          else box.replaceChildren();
        });
      }
    });
  });
}

beforeEach(() => {
  document.body.innerHTML = PROFILE;
});

describe("reading Instagram", () => {
  it("reads accounts from the search panel (name and followers from the second line)", () => {
    document.body.innerHTML = `
      <nav><a href="/explore/">Search</a></nav>
      <div>
        <a href="/cakes_makes/"><img alt=""></a>
        <a href="/cakes_makes/"><div>cakes_makes</div><div>CAKESMAKES | LUCKNOW BAKERY • 21.7K followers</div></a>
        <a href="/bliss_cakes_and_cookies/"><div>bliss_cakes_and_cookies</div><div>Bliss Cakes and Cookies – Artisan Home Bakery | Lucknow, India</div></a>
        <a href="/p/DVyXsZzj5Sr/">a post</a>
        <a href="/againnewdotcom/"><span>Profile</span></a>
      </div>`;
    expect(readSearchResults(document)).toEqual([
      { platform: "instagram", kind: "profile", url: "https://www.instagram.com/cakes_makes/", handle: "cakes_makes", name: "CAKESMAKES | LUCKNOW BAKERY", bio: null, category: null, followers: 21700, audienceText: "21.7K followers", website: null },
      { platform: "instagram", kind: "profile", url: "https://www.instagram.com/bliss_cakes_and_cookies/", handle: "bliss_cakes_and_cookies", name: "Bliss Cakes and Cookies – Artisan Home Bakery | Lucknow, India", bio: null, category: null, followers: null, audienceText: null, website: null },
    ]);
  });

  it("reads an open profile's public details", () => {
    expect(readProfile(document, "https://www.instagram.com/Cakes_Makes/?hl=en")).toEqual({
      platform: "instagram",
      kind: "profile",
      url: URL_,
      handle: "cakes_makes",
      name: "CAKESMAKES | LUCKNOW BAKERY",
      category: "Entrepreneur",
      bio: "Custom cakes and desserts in Lucknow. DM to order!",
      followers: 21700,
      audienceText: "21.7K followers",
      website: "https://cakesmakes.in/",
    });
  });

  it("recognises login pages and activity limits", () => {
    expect(detectBlock(document, "https://www.instagram.com/accounts/login/?next=/x/")).toMatch(/log in/);
    document.body.insertAdjacentHTML("beforeend", `<div role="dialog">Try Again Later. We restrict certain activity to protect our community.</div>`);
    expect(detectBlock(document, URL_)).toMatch(/limiting your activity/);
  });
});

describe("sending on Instagram", () => {
  it("finds the pop-up for this person and its Send button after typing", () => {
    document.body.insertAdjacentHTML("beforeend", CHAT);
    const c = findComposer(document, ["CAKESMAKES", "cakes_makes"])!;
    expect(c.box.getAttribute("aria-placeholder")).toBe("Message...");
    expect(findSendButton(c)).toBeNull();
  });

  it("auto mode: opens the chat, pastes and presses Send", async () => {
    wireInstagram();
    expect(await sendFromProfile(document, () => URL_, job("auto"), FAST)).toEqual({ status: "sent" });
  });

  it("auto mode: reports Instagram's send error", async () => {
    wireInstagram({ failSend: true });
    expect(await sendFromProfile(document, () => URL_, job("auto"), FAST)).toEqual({ status: "failed", reason: "Message wasn't sent. Tap to try again." });
  });

  it("assisted mode: pastes and waits for your Send", async () => {
    wireInstagram();
    const pending = sendFromProfile(document, () => URL_, job("assisted"), FAST);
    await new Promise((r) => setTimeout(r, 450));
    expect(document.querySelector("[data-lexical-editor]")!.textContent).toContain("bulk orders");
    [...document.querySelectorAll<HTMLElement>("div[role='button']")].find((b) => b.textContent === "Send")!.click();
    expect(await pending).toEqual({ status: "sent" });
  });

  it("skips profiles without a Message button and your own account", async () => {
    document.body.innerHTML = PROFILE.replace(`<div role="button">Message</div>`, "");
    expect(await sendFromProfile(document, () => URL_, job("auto"), FAST)).toMatchObject({ status: "skipped", reason: expect.stringMatching(/No Message button/) });
    document.body.innerHTML = PROFILE.replace(`<div role="button">Message</div>`, `<a href="/accounts/edit/">Edit profile</a>`);
    expect(await sendFromProfile(document, () => URL_, job("auto"), FAST)).toEqual({ status: "skipped", reason: "This is your own account" });
    document.body.innerHTML = `<main>Sorry, this page isn't available.</main>`;
    expect(await sendFromProfile(document, () => URL_, job("auto"), FAST)).toEqual({ status: "skipped", reason: "Profile not found on Instagram" });
  });
});
