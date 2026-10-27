// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  isVisible,
  connectionState,
  detectBlock,
  findComposer,
  findMessageButton,
  sendFromProfile,
  typeInto,
  type Timing,
} from "../src/content/messenger";

// Shaped like LinkedIn's profile page and chat pop-up: labels and roles as on screen, class
// names only where LinkedIn's own markup is the only hook.
const PROFILE = (actions: string) => `
  <nav id="global-nav">Home My Network Messaging</nav>
  <main>
    <section>
      <h1>Priya Sharma</h1>
      <div>HR Manager at Example Pvt Ltd</div>
      <div>${actions}</div>
    </section>
    <section>
      <h2>People also viewed</h2>
      <button aria-label="Message Rahul Verma">Message</button>
    </section>
  </main>`;

const CHAT = `
  <aside class="msg-overlay-container">
    <div class="msg-overlay-conversation-bubble">
      <header>Priya Sharma</header>
      <form class="msg-form">
        <div class="msg-form__contenteditable" contenteditable="true" role="textbox" aria-label="Write a message…"></div>
        <button type="submit" class="msg-form__send-button" disabled>Send</button>
      </form>
    </div>
  </aside>`;

const FAST: Timing = { pageLoadMs: 300, findMs: 300, sendConfirmMs: 500, assistedMs: 1200, pollMs: 10 };
const URL_ = "https://www.linkedin.com/in/priya-sharma/";
const job = (mode: "assisted" | "auto") => ({ body: "Hi Priya,\n\nNice to meet you.", mode, contactName: "Priya Sharma" });

/** Opening the chat like LinkedIn does: the Message button adds the pop-up; typing enables Send; sending clears the box. */
function wireLinkedIn(opts: { sendFails?: boolean } = {}) {
  document.querySelector<HTMLElement>("main section button[aria-label^='Message Priya']")?.addEventListener("click", () => {
    document.body.insertAdjacentHTML("beforeend", CHAT);
    const box = document.querySelector<HTMLElement>(".msg-form__contenteditable")!;
    const send = document.querySelector<HTMLButtonElement>(".msg-form__send-button")!;
    box.addEventListener("input", () => (send.disabled = !box.textContent?.trim()));
    send.addEventListener("click", (e) => {
      e.preventDefault();
      if (opts.sendFails) document.body.insertAdjacentHTML("beforeend", `<div role="alert">Your message couldn't send. Try again.</div>`);
      else box.replaceChildren();
    });
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("finding LinkedIn's controls", () => {
  it("picks the profile's own Message button, not one in 'People also viewed'", () => {
    document.body.innerHTML = PROFILE(`<button aria-label="Message Priya Sharma">Message</button><button>More</button>`);
    expect(findMessageButton(document, "Priya Sharma")?.getAttribute("aria-label")).toBe("Message Priya Sharma");
    expect(findMessageButton(document, "Neha Gupta")).toBeNull();
  });

  it("explains a missing Message button", () => {
    document.body.innerHTML = PROFILE(`<button aria-label="Invite Priya Sharma to connect">Connect</button>`);
    expect(findMessageButton(document, "Priya Sharma")).toBeNull();
    expect(connectionState(document)).toBe("not_connected");
    document.body.innerHTML = PROFILE(`<button aria-label="Pending, click to withdraw invitation sent to Priya Sharma">Pending</button>`);
    expect(connectionState(document)).toBe("pending");
  });

  it("finds the chat box for this person and detects InMail", () => {
    document.body.innerHTML = PROFILE("") + CHAT;
    const c = findComposer(document, "Priya Sharma")!;
    expect(c.box.getAttribute("aria-label")).toBe("Write a message…");
    expect(c.send?.textContent).toBe("Send");
    expect(c.isInMail).toBe(false);
    document.querySelector("form")!.insertAdjacentHTML("afterbegin", `<input name="subject" placeholder="Subject (required)">`);
    expect(findComposer(document, "Priya Sharma")!.isInMail).toBe(true);
  });

  it("types multi-line text into the editor", () => {
    document.body.innerHTML = CHAT;
    const box = document.querySelector<HTMLElement>("[contenteditable]")!;
    expect(typeInto(box, "Hi Priya,\n\nNice to meet you.")).toBe(true);
    expect(box.textContent).toContain("Nice to meet you.");
  });

  it("recognises logins, security checks and limits", () => {
    expect(detectBlock(document, "https://www.linkedin.com/checkpoint/challenge/x")).toMatch(/log in or pass a check/);
    document.body.innerHTML = `<main>Let's do a quick security check</main>`;
    expect(detectBlock(document, URL_)).toMatch(/security check/);
    document.body.innerHTML = PROFILE("") + `<div role="alert">You've reached the weekly invitation limit</div>`;
    expect(detectBlock(document, URL_)).toMatch(/limit/);
    document.body.innerHTML = PROFILE(`<button aria-label="Message Priya Sharma">Message</button>`);
    expect(detectBlock(document, URL_)).toBeNull();
  });
});

describe("sendFromProfile", () => {
  it("auto mode: opens the chat, types and presses Send", async () => {
    document.body.innerHTML = PROFILE(`<button aria-label="Message Priya Sharma">Message</button>`);
    wireLinkedIn();
    expect(await sendFromProfile(document, () => URL_, job("auto"), FAST)).toEqual({ status: "sent" });
  });

  it("auto mode: reports LinkedIn's send error", async () => {
    document.body.innerHTML = PROFILE(`<button aria-label="Message Priya Sharma">Message</button>`);
    wireLinkedIn({ sendFails: true });
    expect(await sendFromProfile(document, () => URL_, job("auto"), FAST)).toEqual({ status: "failed", reason: "Your message couldn't send. Try again." });
  });

  it("assisted mode: types the message and waits for the user's Send", async () => {
    document.body.innerHTML = PROFILE(`<button aria-label="Message Priya Sharma">Message</button>`);
    wireLinkedIn();
    const pending = sendFromProfile(document, () => URL_, job("assisted"), FAST);
    await new Promise((r) => setTimeout(r, 450));
    const box = document.querySelector<HTMLElement>("[contenteditable]")!;
    expect(box.textContent).toContain("Nice to meet you.");
    document.querySelector<HTMLButtonElement>(".msg-form__send-button")!.click(); // the user
    expect(await pending).toEqual({ status: "sent" });
  });

  it("assisted mode: never counts a message the user did not send", async () => {
    document.body.innerHTML = PROFILE(`<button aria-label="Message Priya Sharma">Message</button>`);
    wireLinkedIn();
    const pending = sendFromProfile(document, () => URL_, job("assisted"), FAST);
    await new Promise((r) => setTimeout(r, 450));
    document.querySelector<HTMLElement>("[contenteditable]")!.replaceChildren(); // cleared by hand, not sent
    expect(await pending).toEqual({ status: "skipped", reason: "Not sent within 0 minutes" });
  });

  it("assisted mode: Skip from the side panel aborts", async () => {
    document.body.innerHTML = PROFILE(`<button aria-label="Message Priya Sharma">Message</button>`);
    wireLinkedIn();
    const controller = new AbortController();
    const pending = sendFromProfile(document, () => URL_, job("assisted"), { ...FAST, assistedMs: 5000 }, controller.signal);
    await new Promise((r) => setTimeout(r, 100));
    controller.abort();
    expect(await pending).toEqual({ status: "skipped", reason: "Skipped by you" });
  });

  it("skips non-connections and InMail, and stops on a security check", async () => {
    document.body.innerHTML = PROFILE(`<button aria-label="Invite Priya Sharma to connect">Connect</button>`);
    expect(await sendFromProfile(document, () => URL_, job("auto"), FAST)).toEqual({ status: "skipped", reason: "Not a 1st-degree connection (no Message button)" });

    document.body.innerHTML = PROFILE(`<button aria-label="Message Priya Sharma">Message</button>`);
    document.querySelector("main button")!.addEventListener("click", () => {
      document.body.insertAdjacentHTML("beforeend", CHAT);
      document.querySelector("form")!.insertAdjacentHTML("afterbegin", `<input name="subject">`);
    });
    expect(await sendFromProfile(document, () => URL_, job("auto"), FAST)).toMatchObject({ status: "skipped", reason: expect.stringMatching(/InMail/) });

    document.body.innerHTML = `<main>Let's do a quick security check</main>`;
    expect(await sendFromProfile(document, () => URL_, job("auto"), FAST)).toMatchObject({ status: "blocked" });
  });
});

describe("LinkedIn's newer chat pop-up (inside a shadow root)", () => {
  /** Opens the "New message" pop-up inside a shadow root, like linkedin.com does now. */
  function wireShadowChat(opts: { dropsText?: boolean } = {}) {
    const host = document.createElement("div");
    host.id = "interop-outlet";
    document.body.append(host);
    const root = host.attachShadow({ mode: "open" });
    // An old, hidden editor in the normal page that must never be used.
    document.body.insertAdjacentHTML("beforeend", `<div hidden><div class="msg-form__contenteditable" contenteditable="true" role="textbox" id="stale"></div></div>`);
    document.querySelector<HTMLElement>("main section button[aria-label^='Message Priya']")!.addEventListener("click", () => {
      root.innerHTML = `
        <div class="msg-overlay-conversation-bubble">
          <header>New message <span>Priya Sharma ✕</span></header>
          <form class="msg-form">
            <div class="msg-form__contenteditable" contenteditable="true" role="textbox" aria-label="Write a message…"></div>
            <button type="submit" class="msg-form__send-button" disabled>Send</button>
          </form>
        </div>`;
      const box = root.querySelector<HTMLElement>("[contenteditable]")!;
      const send = root.querySelector<HTMLButtonElement>("button")!;
      box.addEventListener("input", () => {
        send.disabled = !box.textContent?.trim();
        if (opts.dropsText) setTimeout(() => box.replaceChildren(), 20); // an editor that throws programmatic text away
      });
      send.addEventListener("click", (e) => {
        e.preventDefault();
        box.replaceChildren();
      });
    });
    return root;
  }

  it("finds the box inside the pop-up, ignores the hidden one, and sends", async () => {
    document.body.innerHTML = PROFILE(`<button aria-label="Message Priya Sharma">Message</button>`);
    wireShadowChat();
    expect(await sendFromProfile(document, () => URL_, job("auto"), FAST)).toEqual({ status: "sent" });
    expect(document.getElementById("stale")!.textContent).toBe(""); // never typed into
  });

  it("reports clearly when LinkedIn's editor drops the typed text", async () => {
    document.body.innerHTML = PROFILE(`<button aria-label="Message Priya Sharma">Message</button>`);
    wireShadowChat({ dropsText: true });
    expect(await sendFromProfile(document, () => URL_, job("auto"), FAST)).toEqual({ status: "failed", reason: "LinkedIn cleared the typed message (its editor did not accept it)" });
  });

  it("explains what it saw when no usable box opens", async () => {
    document.body.innerHTML = PROFILE(`<button aria-label="Message Priya Sharma">Message</button>`) + `<div hidden><div contenteditable="true" role="textbox"></div></div>`;
    const res = await sendFromProfile(document, () => URL_, job("auto"), FAST);
    expect(res).toEqual({ status: "failed", reason: "The message box did not open (1 message box(es) on the page, 0 visible, 0 inside LinkedIn's chat pop-up)" });
  });
});

describe("elements from another frame", () => {
  it("counts LinkedIn's chat box as visible even though it is not this page's HTMLElement", () => {
    // LinkedIn creates its chat pop-up with another frame's document, so `el instanceof HTMLElement`
    // is false on linkedin.com. Recreate that by swapping this page's HTMLElement for a moment.
    const box = document.createElement("div");
    box.setAttribute("contenteditable", "true");
    document.body.append(box);
    const real = globalThis.HTMLElement;
    (globalThis as { HTMLElement: unknown }).HTMLElement = class {};
    try {
      expect(box instanceof HTMLElement).toBe(false);
      expect(isVisible(box)).toBe(true);
      box.setAttribute("hidden", "");
      expect(isVisible(box)).toBe(false);
    } finally {
      (globalThis as { HTMLElement: unknown }).HTMLElement = real;
    }
  });
});
