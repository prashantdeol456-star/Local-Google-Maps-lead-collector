// The admin menu, in groups shown with a heading (also used by the guide test: every page needs
// a guide section). A group without any page the user may open is hidden.

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  soon?: boolean;
}

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Start",
    items: [
      { to: "/", label: "Dashboard", icon: "▦" },
      { to: "/guide", label: "Guide", icon: "?" },
    ],
  },
  {
    title: "Find leads",
    items: [
      { to: "/leads", label: "Google Maps Leads", icon: "☰" },
      { to: "/linkedin", label: "LinkedIn Leads", icon: "in" },
      { to: "/collections", label: "Collections", icon: "⌖" },
      { to: "/contacts", label: "Contacts (Sheets)", icon: "▤" },
      { to: "/social-leads", label: "Social Leads", icon: "◎" },
    ],
  },
  {
    title: "Send messages",
    items: [
      { to: "/quick-send", label: "Quick Send", icon: "⚡" },
      { to: "/email", label: "Email campaigns", icon: "✉" },
      { to: "/whatsapp", label: "WhatsApp campaigns", icon: "✆" },
      { to: "/templates", label: "Templates", icon: "❏" },
      { to: "/opt-outs", label: "Opt-outs", icon: "⊘" },
      { to: "/linkedin-outreach", label: "LinkedIn Outreach", icon: "➤" },
      { to: "/instagram-outreach", label: "Instagram Outreach", icon: "◉" },
      { to: "/campaign-logs", label: "Campaign Logs", icon: "≡" },
    ],
  },
  {
    title: "Chats",
    items: [
      { to: "/inbox", label: "AI Inbox", icon: "✦" },
      { to: "/social", label: "Social Accounts", icon: "◎" },
    ],
  },
  {
    title: "My account",
    items: [
      { to: "/sender", label: "My sender", icon: "➚" },
      { to: "/billing", label: "Billing", icon: "₹" },
      { to: "/extensions", label: "Extensions", icon: "⬇" },
    ],
  },
  {
    title: "Administration",
    items: [
      { to: "/users", label: "Users", icon: "☺" },
      { to: "/payments", label: "Payments", icon: "₹" },
      { to: "/contact-leads", label: "Contact Leads", icon: "☏" },
      { to: "/website", label: "Website", icon: "⌂" },
      { to: "/platform", label: "Integrations", icon: "⚙" },
      { to: "/integrations", label: "Webhooks & n8n", icon: "⇄" },
      { to: "/settings", label: "Settings", icon: "⚙" },
    ],
  },
];

/** All menu items, in menu order. */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
