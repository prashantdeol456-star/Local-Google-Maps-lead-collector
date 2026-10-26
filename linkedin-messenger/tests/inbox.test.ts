// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { listUnreadThreads, readOpenThread, threadIdOf, typeReplyAndWait } from "../src/content/inbox";
import type { Timing } from "../src/content/messenger";

// Shaped like linkedin.com/messaging: conversation list on the left, the open chat on the right.
const PAGE = `
  <main>
    <ul>
      <li class="msg-conversation-listitem">
        <a href="/messaging/thread/2-abc/"><h3 class="msg-conversation-listitem__participant-names">Priya Sharma</h3></a>
        <span class="msg-conversation-card__unread-count">1</span>
      </li>
      <li class="msg-conversation-listitem">
        <a href="/messaging/thread/2-read/"><h3 class="msg-conversation-listitem__participant-names">Rahul Verma</h3></a>
      </li>
    </ul>
    <div class="msg-thread">
      <h2 id="thread-detail-jump-target">Priya Sharma</h2>
      <a class="msg-thread__link-to-profile" href="https://www.linkedin.com/in/priya-sharma-example?x=1">Priya</a>
      <ul>
        <li class="msg-s-message-list__event">
          <span class="msg-s-message-group__name">You</span>
          <div class="msg-s-event-listitem" data-event-urn="urn:1"><p class="msg-s-event-listitem__body">Hi Priya, saw your post.</p></div>
        </li>
        <li class="msg-s-message-list__event">
          <span class="msg-s-message-group__name">Priya Sharma</span>
          <div class="msg-s-event-listitem msg-s-event-listitem--other" data-event-urn="urn:2"><p class="msg-s-event-listitem__body">Thanks! Can we talk this week?</p></div>
        </li>
      </ul>
      <form class="msg-form">
        <div class="msg-form__contenteditable" contenteditable="true" role="textbox" aria-label="Write a message…"></div>
        <button type="submit" class="msg-form__send-button">Send</button>
      </form>
    </div>
  </main>`;

const FAST: Timing = { pageLoadMs: 300, findMs: 300, sendConfirmMs: 300, assistedMs: 600, pollMs: 10 };

beforeEach(() => {
  document.body.innerHTML = PAGE;
});

describe("reading LinkedIn messages", () => {
  it("finds unread chats only", () => {
    expect(listUnreadThreads(document)).toEqual([{ url: expect.stringMatching(/\/messaging\/thread\/2-abc\/$/), name: "Priya Sharma" }]);
  });

  it("reads the open chat: who, profile, and messages in order with who sent them", () => {
    expect(threadIdOf("https://www.linkedin.com/messaging/thread/2-abc/?foo")).toBe("2-abc");
    expect(readOpenThread(document, "https://www.linkedin.com/messaging/thread/2-abc/")).toEqual({
      threadId: "2-abc",
      participantName: "Priya Sharma",
      profileUrl: "https://www.linkedin.com/in/priya-sharma-example",
      messages: [
        { key: "urn:1", fromMe: true, text: "Hi Priya, saw your post." },
        { key: "urn:2", fromMe: false, text: "Thanks! Can we talk this week?" },
      ],
    });
    expect(readOpenThread(document, "https://www.linkedin.com/messaging/")).toBeNull();
  });
});

describe("typing the AI reply", () => {
  it("types it, and reports the text you actually sent (after editing)", async () => {
    const box = document.querySelector<HTMLElement>("[contenteditable]")!;
    document.querySelector("button")!.addEventListener("click", (e) => {
      e.preventDefault();
      box.replaceChildren();
    });
    const pending = typeReplyAndWait(document, "Sure! Thursday 11am?", "Priya Sharma", FAST);
    await new Promise((r) => setTimeout(r, 50));
    expect(box.textContent).toContain("Sure! Thursday 11am?");
    box.textContent = "Sure! Thursday 11am works?"; // you edit it
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector<HTMLButtonElement>("button")!.click(); // you press Send
    expect(await pending).toEqual({ status: "sent", text: "Sure! Thursday 11am works?" });
  });

  it("never overwrites text you were typing, and times out without sending", async () => {
    const box = document.querySelector<HTMLElement>("[contenteditable]")!;
    box.textContent = "my own half-written note";
    expect(await typeReplyAndWait(document, "AI text", "Priya Sharma", FAST)).toMatchObject({ status: "skipped", reason: expect.stringMatching(/already has text/) });
    box.replaceChildren();
    expect(await typeReplyAndWait(document, "AI text", "Priya Sharma", FAST)).toMatchObject({ status: "skipped", reason: expect.stringMatching(/Not sent within/) });
  });
});
