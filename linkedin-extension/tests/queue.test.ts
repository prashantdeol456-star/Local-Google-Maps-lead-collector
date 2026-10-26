import { describe, expect, it } from "vitest";
import { addToQueue, markSaved, nextPending, parsePastedLinks, roomForTarget, setStatus } from "../src/storage/queue";
import { fromDraft, toDraft } from "../src/sidepanel/pages/HelperPage";

describe("profile list", () => {
  it("adds new profiles once, keeps the status of known ones", () => {
    let { queue, added } = addToQueue([], [{ profileUrl: "https://in.linkedin.com/in/A/" }, { profileUrl: "https://www.linkedin.com/in/b", name: "B" }, { profileUrl: "nope" }]);
    expect(added).toBe(2);
    queue = setStatus(queue, "https://www.linkedin.com/in/a", "saved");
    ({ queue, added } = addToQueue(queue, [{ profileUrl: "https://www.linkedin.com/in/a", name: "Asha" }]));
    expect(added).toBe(0);
    expect(queue[0]).toEqual({ profileUrl: "https://www.linkedin.com/in/a", name: "Asha", status: "saved" });
    expect(nextPending(queue)?.profileUrl).toBe("https://www.linkedin.com/in/b");
    expect(nextPending(markSaved(queue, ["https://www.linkedin.com/in/B/"]))).toBeNull();
  });

  it("reads pasted links", () => {
    expect(parsePastedLinks("https://www.linkedin.com/in/a\nlinkedin.com/in/b, https://example.com\n")).toEqual([
      { profileUrl: "https://www.linkedin.com/in/a" },
      { profileUrl: "https://www.linkedin.com/in/b" },
    ]);
  });
});

describe("profile form", () => {
  it("round-trips a reading through the editable form", () => {
    const draft = toDraft("https://www.linkedin.com/in/a", {
      name: "Asha",
      headline: "HR",
      emails: ["a@x.in", "b@x.in"],
      websites: [{ url: "fixtra.in", label: "Company" }, { url: "asha.dev", label: null }],
    });
    expect(draft.emails).toBe("a@x.in\nb@x.in");
    const lead = fromDraft({ ...draft, notes: "  " }, " HR Lucknow ");
    expect(lead).toMatchObject({
      profileUrl: "https://www.linkedin.com/in/a",
      name: "Asha",
      company: null,
      emails: ["a@x.in", "b@x.in"],
      websites: [{ url: "fixtra.in", label: "Company" }, { url: "asha.dev", label: null }],
      notes: null,
      tag: "HR Lucknow",
    });
  });
});

describe("LinkedIn URLs opened from the side panel", () => {
  it("builds the people search and the Contact info URL", async () => {
    const { contactInfoUrl, peopleSearchUrl } = await import("../src/sidepanel/services/tabs");
    expect(peopleSearchUrl(" HR manager Lucknow ")).toBe("https://www.linkedin.com/search/results/people/?keywords=HR%20manager%20Lucknow&origin=FACETED_SEARCH");
    expect(contactInfoUrl("https://www.linkedin.com/in/asha")).toBe("https://www.linkedin.com/in/asha/overlay/contact-info/");
  });

  it("recognises the Contact info dialog URL", async () => {
    const { isContactInfoUrl } = await import("../src/sidepanel/services/tabs");
    expect(isContactInfoUrl("https://www.linkedin.com/in/asha/overlay/contact-info/")).toBe(true);
    expect(isContactInfoUrl("https://www.linkedin.com/in/asha/overlay/contact-info")).toBe(true);
    expect(isContactInfoUrl("https://www.linkedin.com/in/asha/")).toBe(false);
    expect(isContactInfoUrl("https://www.linkedin.com/search/results/people/?keywords=overlay/contact-info")).toBe(false);
  });
});

describe("experience and education in the form", () => {
  it("round-trips through the one-line-per-entry text", async () => {
    const { experienceToLines, linesToExperience, educationToLines, linesToEducation } = await import("../src/sidepanel/pages/HelperPage");
    const experience = [
      { title: "PM", company: "Acme", employmentType: "Full-time", dates: "2024 - Present", location: "Noida, India" },
      { title: "Analyst", company: null, employmentType: null, dates: "2020 - 2022", location: null },
    ];
    expect(experienceToLines(experience)).toBe("PM | Acme | Full-time | 2024 - Present | Noida, India\nAnalyst |  |  | 2020 - 2022");
    expect(linesToExperience(experienceToLines(experience))).toEqual(experience);
    const education = [{ school: "IIM Lucknow", degree: "MBA", dates: null }];
    expect(linesToEducation(educationToLines(education))).toEqual(education);
  });
});

describe("profile count target", () => {
  const links = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ profileUrl: `https://www.linkedin.com/in/p${from + i}` }));

  it("adds only up to the target; skipped profiles do not count", () => {
    let { queue, added } = addToQueue([], links(10), roomForTarget([], 12));
    expect(added).toBe(10);
    ({ queue, added } = addToQueue(queue, links(10, 10), roomForTarget(queue, 12)));
    expect(added).toBe(2);
    expect(roomForTarget(queue, 12)).toBe(0);
    queue = setStatus(queue, "https://www.linkedin.com/in/p0", "skipped");
    expect(roomForTarget(queue, 12)).toBe(1);
    expect(roomForTarget(queue, null)).toBe(Infinity);
  });
});

describe("results pages", () => {
  it("recognises LinkedIn people-search URLs", async () => {
    const { isPeopleSearchUrl } = await import("../src/sidepanel/services/tabs");
    expect(isPeopleSearchUrl("https://www.linkedin.com/search/results/people/?keywords=odoo%20delhi&page=2")).toBe(true);
    expect(isPeopleSearchUrl("https://www.linkedin.com/search/results/companies/?keywords=odoo")).toBe(false);
    expect(isPeopleSearchUrl("https://www.linkedin.com/in/someone/")).toBe(false);
  });
});

describe("daily pace", () => {
  it("counts each profile once per local day and starts again the next day", async () => {
    const { recordProfile, usedToday, localDay, clampDailyLimit, isSecurityCheckUrl } = await import("../src/storage/queue");
    const day1 = new Date(2026, 9, 24, 10, 0);
    const day2 = new Date(2026, 9, 25, 9, 0);
    let usage = { date: localDay(day1), profiles: [] as string[] };
    usage = recordProfile(usage, "https://www.linkedin.com/in/a", day1);
    usage = recordProfile(usage, "https://www.linkedin.com/in/a", day1);
    usage = recordProfile(usage, "https://www.linkedin.com/in/b", day1);
    expect(usedToday(usage, day1)).toBe(2);
    expect(usedToday(usage, day2)).toBe(0);
    expect(recordProfile(usage, "https://www.linkedin.com/in/c", day2)).toEqual({ date: "2026-10-25", profiles: ["https://www.linkedin.com/in/c"] });
    expect(clampDailyLimit(500)).toBe(150);
    expect(clampDailyLimit(0)).toBe(80);
    expect(isSecurityCheckUrl("https://www.linkedin.com/checkpoint/challenge/abc")).toBe(true);
    expect(isSecurityCheckUrl("https://www.linkedin.com/in/someone/")).toBe(false);
  });
});
